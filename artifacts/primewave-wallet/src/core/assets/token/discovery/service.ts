import {
  AccountStateError,
  normalizePublicEvmAddress,
} from '@/src/core/blockchain/account-state';
import {
  RpcProviderError,
  type RpcLog,
} from '@/src/core/blockchain/rpc';
import {
  decodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
} from 'viem';
import { AssetError } from '../../errors';
import type {
  ERC20Token,
  NetworkBoundTokenReadService,
  TokenAssetIdentity,
} from '../../models';
import { getAssetIdentityKey } from '../../registry';
import { ERC20TokenService } from '../service';
import { TokenRegistry } from '../registry';
import {
  InMemoryTokenPreferenceRepository,
} from './repository';
import type {
  FunctionalTokenProvenance,
  KnownTokenDiscoveryRequest,
  TokenCandidate,
  TokenDiscoveryLimits,
  TokenDiscoveryObservation,
  TokenDiscoveryResult,
  TokenDiscoveryServiceOptions,
  TokenMetadataSnapshot,
  TokenPreferenceRecord,
  TokenPreferenceRepository,
  TokenProvenance,
  TokenVisibility,
  TransferDiscoveryRequest,
  UserAddedTokenRequest,
} from './models';

const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  anonymous: false,
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const;

const TRANSFER_EVENT_TOPIC = encodeEventTopics({
  abi: [ERC20_TRANSFER_EVENT],
  eventName: 'Transfer',
})[0] as Hex;

const DEFAULT_LIMITS: TokenDiscoveryLimits = {
  maxBlockRange: 10_000n,
  maxResults: 100,
  maxMetadataLookups: 25,
  maxReasonLength: 160,
};

type DiscoveryAccount = {
  readonly accountId: string | null;
  readonly accountAddress: string | null;
};

function discoveryError(
  error: unknown,
  fallback: 'DISCOVERY_LOG_QUERY_FAILED' | 'DISCOVERY_METADATA_FAILED',
): AssetError {
  if (error instanceof AssetError) {
    switch (error.code) {
      case 'TOKEN_NETWORK_UNAVAILABLE':
        return new AssetError('DISCOVERY_NETWORK_UNAVAILABLE');
      case 'TOKEN_NETWORK_CHANGED':
        return new AssetError('DISCOVERY_NETWORK_CHANGED');
      case 'TOKEN_CHAIN_MISMATCH':
        return new AssetError('DISCOVERY_CHAIN_MISMATCH');
      case 'TOKEN_INVALID_ADDRESS':
        return new AssetError('DISCOVERY_INVALID_TOKEN');
      case 'TOKEN_NOT_A_CONTRACT':
        return new AssetError('DISCOVERY_NOT_A_CONTRACT');
      default:
        return new AssetError(fallback);
    }
  }
  if (error instanceof AccountStateError) {
    if (error.code === 'NETWORK_CHANGED') {
      return new AssetError('DISCOVERY_NETWORK_CHANGED');
    }
    return new AssetError('DISCOVERY_NETWORK_UNAVAILABLE');
  }
  if (error instanceof RpcProviderError) {
    if (
      error.code === 'CHAIN_ID_MISMATCH'
    ) {
      return new AssetError('DISCOVERY_CHAIN_MISMATCH');
    }
    if (
      error.code === 'NETWORK_UNAVAILABLE' ||
      error.code === 'TIMEOUT' ||
      error.code === 'ENDPOINT_UNAVAILABLE' ||
      error.code === 'CONFIGURATION_ERROR' ||
      error.code === 'PROVIDER_NOT_INITIALIZED'
    ) {
      return new AssetError('DISCOVERY_NETWORK_UNAVAILABLE');
    }
    return new AssetError(fallback);
  }
  return new AssetError(fallback);
}

function normalizeReason(
  reason: string | undefined,
  fallback: string,
  maxLength: number,
): string {
  const value = reason ?? fallback;
  if (
    value.length === 0 ||
    value.length > maxLength ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new AssetError('DISCOVERY_INVALID_TOKEN');
  }
  return value;
}

function metadataSnapshot(
  token: ERC20Token,
  observedAtMs: number,
): TokenMetadataSnapshot {
  return Object.freeze({
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    metadataStatus: token.metadataStatus,
    observedAtMs,
  });
}

function parseQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function topicAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) {
    return null;
  }
  try {
    return normalizePublicEvmAddress(`0x${value.slice(-40)}`);
  } catch {
    return null;
  }
}

function logIdentity(log: RpcLog, contractAddress: string): string {
  return JSON.stringify([
    contractAddress,
    log.transactionHash ?? null,
    log.logIndex ?? null,
    log.blockHash ?? null,
    log.topics ?? null,
    log.data ?? null,
  ]);
}

function isTransferLog(log: RpcLog): boolean {
  return (
    typeof log.address === 'string' &&
    Array.isArray(log.topics) &&
    log.topics.length >= 3 &&
    log.topics[0] === TRANSFER_EVENT_TOPIC &&
    typeof log.data === 'string'
  );
}

export class TokenDiscoveryService {
  private readonly services = new Map<string, NetworkBoundTokenReadService>();
  private readonly candidates = new Map<string, TokenCandidate>();
  private readonly now: () => number;
  private readonly repository: TokenPreferenceRepository;
  private readonly limits: TokenDiscoveryLimits;
  private readonly registry: TokenRegistry;

  constructor(
    private readonly tokenService: ERC20TokenService,
    readServices: readonly NetworkBoundTokenReadService[],
    options: TokenDiscoveryServiceOptions = {},
  ) {
    this.registry = tokenService.getTokenRegistry();
    this.now = options.now ?? (() => Date.now());
    this.repository =
      options.repository ?? new InMemoryTokenPreferenceRepository();
    this.limits = {
      ...DEFAULT_LIMITS,
      ...options.limits,
    };
    for (const readService of readServices) {
      const network = readService.accountState.getNetwork();
      if (this.services.has(network.id)) {
        throw new AssetError('DISCOVERY_NETWORK_UNAVAILABLE');
      }
      this.services.set(network.id, readService);
    }
  }

  async addUserToken(
    request: UserAddedTokenRequest,
  ): Promise<TokenCandidate> {
    const token = await this.resolveToken(request);
    return this.upsertCandidate({
      token,
      provenance: 'user_added',
      account: { accountId: null, accountAddress: null },
      reason: normalizeReason(
        request.reason,
        'user_added',
        this.limits.maxReasonLength,
      ),
      visibility: request.visibility ?? 'visible',
    });
  }

  /**
   * Controlled discovery path for a caller that already has a bounded,
   * known contract candidate. It does not claim that the candidate was found
   * by a chain-wide scan.
   */
  async discoverKnownToken(
    request: KnownTokenDiscoveryRequest,
  ): Promise<TokenCandidate> {
    const account = this.normalizeOptionalAccount(
      request.accountId,
      request.accountAddress,
    );
    const token = await this.resolveToken(request);
    return this.upsertCandidate({
      token,
      provenance: 'discovered',
      account,
      reason: normalizeReason(
        request.reason,
        'known_contract',
        this.limits.maxReasonLength,
      ),
      visibility: request.visibility ?? 'visible',
    });
  }

  async discoverTransferEvents(
    request: TransferDiscoveryRequest,
  ): Promise<TokenDiscoveryResult> {
    const account = this.normalizeRequiredAccount(request);
    const readService = this.getReadService(request.networkId);
    const fromBlock = this.validateBlock(request.fromBlock);
    const toBlock = this.validateBlock(request.toBlock);
    if (toBlock < fromBlock) {
      throw new AssetError('DISCOVERY_RANGE_TOO_LARGE');
    }
    if (toBlock - fromBlock > this.limits.maxBlockRange) {
      throw new AssetError('DISCOVERY_RANGE_TOO_LARGE');
    }
    const maxResults = this.validateLimit(
      request.maxResults,
      this.limits.maxResults,
    );
    const maxMetadataLookups = this.validateLimit(
      request.maxMetadataLookups,
      this.limits.maxMetadataLookups,
    );
    await this.validateRemoteChain(readService);
    const fromTag = this.blockTag(fromBlock);
    const toTag = this.blockTag(toBlock);
    const accountTopic = encodeEventTopics({
      abi: [ERC20_TRANSFER_EVENT],
      eventName: 'Transfer',
      args: { from: account.accountAddress as Address },
    })[1] as Hex;
    const toAccountTopic = encodeEventTopics({
      abi: [ERC20_TRANSFER_EVENT],
      eventName: 'Transfer',
      args: { to: account.accountAddress as Address },
    })[2] as Hex;

    let logs: RpcLog[];
    try {
      readService.accountState.assertNetworkContext();
      const [outgoing, incoming] = await Promise.all([
        readService.provider.request('eth_getLogs', [
          {
            fromBlock: fromTag,
            toBlock: toTag,
            topics: [TRANSFER_EVENT_TOPIC, accountTopic, null],
          },
        ]),
        readService.provider.request('eth_getLogs', [
          {
            fromBlock: fromTag,
            toBlock: toTag,
            topics: [TRANSFER_EVENT_TOPIC, null, toAccountTopic],
          },
        ]),
      ]);
      logs = [...outgoing, ...incoming];
      readService.accountState.assertNetworkContext();
    } catch (error) {
      throw discoveryError(error, 'DISCOVERY_LOG_QUERY_FAILED');
    }

    if (logs.length > maxResults) {
      throw new AssetError('DISCOVERY_RESULT_LIMIT');
    }

    const uniqueLogs = new Map<string, RpcLog>();
    for (const log of logs) {
      if (!isTransferLog(log)) {
        continue;
      }
      let contractAddress: string;
      try {
        contractAddress = normalizePublicEvmAddress(log.address);
      } catch {
        continue;
      }
      uniqueLogs.set(logIdentity(log, contractAddress), {
        ...log,
        address: contractAddress,
      });
    }

    const contracts = new Map<string, RpcLog>();
    for (const log of uniqueLogs.values()) {
      contracts.set(log.address as string, log);
    }
    if (contracts.size > maxMetadataLookups) {
      throw new AssetError('DISCOVERY_RESULT_LIMIT');
    }

    const candidates: TokenCandidate[] = [];
    for (const contractAddress of contracts.keys()) {
      try {
        const token = await this.resolveToken({
          networkId: request.networkId,
          contractAddress,
        });
        candidates.push(
          await this.upsertCandidate({
            token,
            provenance: 'discovered',
            account,
            reason: 'transfer_event',
            visibility: 'visible',
          }),
        );
      } catch (error) {
        const normalized = discoveryError(
          error,
          'DISCOVERY_METADATA_FAILED',
        );
        if (normalized.code === 'DISCOVERY_NOT_A_CONTRACT') {
          continue;
        }
        throw normalized;
      }
    }

    return Object.freeze({
      networkId: request.networkId,
      accountId: account.accountId as string,
      accountAddress: account.accountAddress as string,
      fromBlock,
      toBlock,
      candidates: Object.freeze(candidates),
      logsObserved: uniqueLogs.size,
      metadataResolved: candidates.length,
      retrievedAtMs: this.now(),
    });
  }

  getCandidate(identity: TokenAssetIdentity): TokenCandidate | undefined {
    return this.candidates.get(getAssetIdentityKey(identity));
  }

  getCandidates(): readonly TokenCandidate[] {
    return Object.freeze([...this.candidates.values()]);
  }

  async setVisibility(
    identity: TokenAssetIdentity,
    visibility: TokenVisibility,
  ): Promise<TokenCandidate> {
    const existing = this.requireCandidate(identity);
    return this.upsertCandidate({
      token: existing.token,
      provenance: existing.provenance,
      account: { accountId: null, accountAddress: null },
      reason: 'visibility_changed',
      visibility,
      skipObservation: true,
    });
  }

  async removeLocalPreference(identity: TokenAssetIdentity): Promise<void> {
    const candidate = this.requireCandidate(identity);
    try {
      await this.repository.delete(candidate.assetIdentity);
    } catch {
      throw new AssetError('DISCOVERY_PERSISTENCE_FAILED');
    }
    this.candidates.delete(getAssetIdentityKey(candidate.assetIdentity));
  }

  private async resolveToken(request: {
    readonly networkId: string;
    readonly contractAddress: unknown;
  }): Promise<ERC20Token> {
    try {
      const token = await this.getTokenService().getTokenMetadata(request);
      return this.registry.upsert(token);
    } catch (error) {
      throw discoveryError(error, 'DISCOVERY_METADATA_FAILED');
    }
  }

  private getTokenService(): ERC20TokenService {
    return this.tokenService;
  }

  private async upsertCandidate(input: {
    readonly token: ERC20Token;
    readonly provenance: FunctionalTokenProvenance;
    readonly account: DiscoveryAccount;
    readonly reason: string;
    readonly visibility: TokenVisibility;
    readonly skipObservation?: boolean;
  }): Promise<TokenCandidate> {
    const identity = input.token as TokenAssetIdentity;
    const key = getAssetIdentityKey(identity);
    const existing = this.candidates.get(key);
    const now = this.now();
    const snapshot = metadataSnapshot(input.token, now);
    const observation: TokenDiscoveryObservation = Object.freeze({
      assetIdentity: identity,
      networkId: identity.networkId,
      accountId: input.account.accountId,
      accountAddress: input.account.accountAddress,
      provenance: input.provenance,
      discoveredAtMs: now,
      reason: input.reason,
      metadataSnapshot: snapshot,
    });
    const observations = existing
      ? [...existing.provenanceObservations]
      : [];
    if (
      !input.skipObservation &&
      !observations.some(
        (candidate) =>
          candidate.provenance === observation.provenance &&
          candidate.accountId === observation.accountId &&
          candidate.accountAddress === observation.accountAddress &&
          candidate.reason === observation.reason,
      )
    ) {
      observations.push(observation);
    }
    const persisted = await this.repository.get(identity);
    const provenance = Array.from(
      new Set<TokenProvenance>([
        ...(persisted?.provenance ?? []),
        ...(existing?.provenanceObservations.map(
          (item) => item.provenance,
        ) ?? []),
        input.provenance,
      ]),
    );
    const candidate = Object.freeze({
      token: input.token,
      assetIdentity: identity,
      provenance:
        provenance.includes('user_added') ? 'user_added' : 'discovered',
      provenanceObservations: Object.freeze(observations),
      discoveryState:
        input.visibility === 'hidden'
          ? 'hidden'
          : input.token.metadataStatus === 'unavailable'
            ? 'unavailable'
            : input.provenance === 'user_added' ||
                existing?.discoveryState === 'manually_added'
              ? 'manually_added'
              : 'discovered',
      verificationStatus: input.token.verificationStatus,
      metadataSnapshot: snapshot,
      visibility: input.visibility,
      createdAtMs: existing?.createdAtMs ?? persisted?.createdAtMs ?? now,
      updatedAtMs: now,
    } satisfies TokenCandidate);
    this.candidates.set(key, candidate);
    try {
      await this.repository.save({
        assetIdentity: identity,
        visibility: candidate.visibility,
        provenance,
        metadataSnapshot: snapshot,
        createdAtMs: candidate.createdAtMs,
        updatedAtMs: candidate.updatedAtMs,
      });
    } catch {
      this.candidates.delete(key);
      throw new AssetError('DISCOVERY_PERSISTENCE_FAILED');
    }
    return candidate;
  }

  private requireCandidate(identity: TokenAssetIdentity): TokenCandidate {
    const candidate = this.getCandidate(identity);
    if (!candidate) {
      throw new AssetError('DISCOVERY_INVALID_TOKEN');
    }
    return candidate;
  }

  private normalizeOptionalAccount(
    accountId: string | undefined,
    accountAddress: unknown,
  ): DiscoveryAccount {
    if (accountId === undefined && accountAddress === undefined) {
      return { accountId: null, accountAddress: null };
    }
    if (
      typeof accountId !== 'string' ||
      accountId.trim().length === 0
    ) {
      throw new AssetError('DISCOVERY_INVALID_ACCOUNT');
    }
    try {
      return {
        accountId,
        accountAddress: normalizePublicEvmAddress(accountAddress),
      };
    } catch {
      throw new AssetError('DISCOVERY_INVALID_ACCOUNT');
    }
  }

  private normalizeRequiredAccount(
    request: TransferDiscoveryRequest,
  ): { readonly accountId: string; readonly accountAddress: string } {
    if (
      typeof request.accountId !== 'string' ||
      request.accountId.trim().length === 0
    ) {
      throw new AssetError('DISCOVERY_INVALID_ACCOUNT');
    }
    try {
      return {
        accountId: request.accountId,
        accountAddress: normalizePublicEvmAddress(request.accountAddress),
      };
    } catch {
      throw new AssetError('DISCOVERY_INVALID_ACCOUNT');
    }
  }

  private getReadService(networkId: string): NetworkBoundTokenReadService {
    const service = this.services.get(networkId);
    if (!service) {
      throw new AssetError('DISCOVERY_NETWORK_UNAVAILABLE');
    }
    const network = service.accountState.getNetwork();
    if (network.id !== networkId || network.chainId === null) {
      throw new AssetError('DISCOVERY_CHAIN_MISMATCH');
    }
    return service;
  }

  private async validateRemoteChain(
    readService: NetworkBoundTokenReadService,
  ): Promise<void> {
    try {
      const network = readService.accountState.getNetwork();
      const remoteChainId = await readService.provider.request(
        'eth_chainId',
        [],
      );
      if (BigInt(remoteChainId) !== BigInt(network.chainId as number)) {
        throw new AssetError('DISCOVERY_CHAIN_MISMATCH');
      }
      readService.accountState.assertNetworkContext();
    } catch (error) {
      if (error instanceof AssetError) {
        throw error;
      }
      throw discoveryError(error, 'DISCOVERY_LOG_QUERY_FAILED');
    }
  }

  private validateBlock(value: bigint): bigint {
    if (typeof value !== 'bigint' || value < 0n) {
      throw new AssetError('DISCOVERY_RANGE_TOO_LARGE');
    }
    return value;
  }

  private validateLimit(value: number | undefined, maximum: number): number {
    const resolved = value ?? maximum;
    if (
      !Number.isSafeInteger(resolved) ||
      resolved <= 0 ||
      resolved > maximum
    ) {
      throw new AssetError('DISCOVERY_RESULT_LIMIT');
    }
    return resolved;
  }

  private blockTag(value: bigint): `0x${string}` {
    return `0x${value.toString(16)}`;
  }
}