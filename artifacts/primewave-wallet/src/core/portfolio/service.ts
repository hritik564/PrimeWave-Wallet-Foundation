import {
  AssetError,
  AssetRegistry,
  NativeAssetBalanceService,
  ERC20TokenService,
  getAssetIdentityKey,
  type AssetIdentity,
  type ERC20Token,
  type NetworkBoundTokenReadService,
  type TokenBalance,
  type TokenAssetIdentity,
  type TokenCandidate,
} from '@/src/core/assets';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { PortfolioError } from './errors';
import { createAssetIcon } from './icon';
import type {
  Portfolio,
  PortfolioAccount,
  PortfolioAggregationServiceOptions,
  PortfolioAsset,
  PortfolioAssetBalance,
  PortfolioAssetSource,
  PortfolioAssetStatus,
  PortfolioNetwork,
  PortfolioNetworkReadService,
  PortfolioQuery,
  PortfolioSummary,
  PortfolioVisibility,
} from './models';

const DEFAULT_MAX_NETWORKS = 8;
const DEFAULT_MAX_ASSETS = 200;
const DEFAULT_MAX_TOKENS_PER_NETWORK = 100;

function mapPortfolioError(
  error: unknown,
  fallback: 'PORTFOLIO_BALANCE_UNAVAILABLE' | 'PORTFOLIO_METADATA_UNAVAILABLE',
): AssetError {
  if (error instanceof AssetError) {
    switch (error.code) {
      case 'TOKEN_NETWORK_CHANGED':
      case 'BALANCE_NETWORK_CHANGED':
        return new PortfolioError('PORTFOLIO_NETWORK_CHANGED');
      case 'TOKEN_CHAIN_MISMATCH':
      case 'BALANCE_CHAIN_MISMATCH':
        return new PortfolioError('PORTFOLIO_CHAIN_MISMATCH');
      case 'TOKEN_NETWORK_UNAVAILABLE':
      case 'BALANCE_NETWORK_UNAVAILABLE':
        return new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
      case 'TOKEN_METADATA_UNAVAILABLE':
      case 'TOKEN_METADATA_INVALID':
        return new PortfolioError('PORTFOLIO_METADATA_UNAVAILABLE');
      default:
        return new PortfolioError(fallback);
    }
  }
  return new PortfolioError(fallback);
}

function errorCode(error: unknown): AssetError['code'] | null {
  return error instanceof AssetError ? error.code : null;
}

function hasBalance(rawAmount: bigint | null): boolean | null {
  return rawAmount === null ? null : rawAmount > 0n;
}

function emptyBalance(): PortfolioAssetBalance {
  return Object.freeze({
    rawAmount: null,
    decimals: null,
    formattedAmount: null,
    hasBalance: null,
    blockNumber: null,
    blockHash: null,
    retrievedAtMs: null,
  });
}

function tokenSources(
  token: ERC20Token,
  candidate:
    | {
        readonly provenance: 'user_added' | 'discovered';
        readonly provenanceObservations: readonly {
          readonly provenance: 'user_added' | 'discovered';
        }[];
      }
    | undefined,
): {
  readonly sources: readonly PortfolioAssetSource[];
  readonly provenance: readonly ('user_added' | 'discovered' | 'registry')[];
} {
  if (!candidate) {
    return {
      sources: ['registry'],
      provenance: ['registry'],
    };
  }
  const provenance = Array.from(
    new Set([
      candidate.provenance,
      ...candidate.provenanceObservations.map(
        (observation) => observation.provenance,
      ),
    ]),
  ) as ('user_added' | 'discovered')[];
  return {
    sources: Object.freeze([...provenance]),
    provenance: Object.freeze([...provenance]),
  };
}

export class PortfolioAggregationService {
  private readonly now: () => number;
  private readonly tokenDiscoveryService:
    | PortfolioAggregationServiceOptions['tokenDiscoveryService']
    | undefined;
  private readonly maxNetworks: number;
  private readonly maxAssets: number;
  private readonly maxTokensPerNetwork: number;
  private readonly readServices = new Map<
    string,
    PortfolioNetworkReadService
  >();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly nativeBalanceService: NativeAssetBalanceService,
    private readonly tokenService: ERC20TokenService,
    readServices: readonly PortfolioNetworkReadService[],
    options: PortfolioAggregationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.tokenDiscoveryService = options.tokenDiscoveryService;
    this.maxNetworks = options.maxNetworks ?? DEFAULT_MAX_NETWORKS;
    this.maxAssets = options.maxAssets ?? DEFAULT_MAX_ASSETS;
    this.maxTokensPerNetwork =
      options.maxTokensPerNetwork ?? DEFAULT_MAX_TOKENS_PER_NETWORK;
    for (const readService of readServices) {
      const networkId = readService.accountState.getNetwork().id;
      if (this.readServices.has(networkId)) {
        throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
      }
      this.readServices.set(networkId, readService);
    }
  }

  async getPortfolio(query: PortfolioQuery): Promise<Portfolio> {
    const account = this.validateAccount(query);
    const networkIds = this.validateNetworks(query.networkIds);
    const includeHidden = query.includeHidden ?? true;
    const requestedTokenIdentities = this.resolveRequestedTokens(
      query.tokenIdentities,
      networkIds,
    );
    const portfolioNetworks: PortfolioNetwork[] = [];
    const portfolioAssets: PortfolioAsset[] = [];

    for (const networkId of networkIds) {
      const network = this.resolveNetwork(networkId);
      const networkConfig = this.assets
        .getNetworkRegistry()
        .getById(networkId);
      if (!networkConfig) {
        throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
      }
      const readService = this.readServices.get(networkId);
      if (!readService) {
        throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
      }
      await this.validateRemoteChain(readService);
      portfolioNetworks.push({
        networkId: networkConfig.id,
        chainId: networkConfig.chainId as number,
        displayName: networkConfig.displayName,
        nativeCurrencySymbol: networkConfig.nativeCurrency.symbol,
      });

      const nativeAsset = network;
      const nativeBalance = await this.readNativeBalance(
        networkId,
        account,
      );
      portfolioAssets.push(
        this.createNativePortfolioAsset(
          nativeAsset,
          account,
          nativeBalance,
        ),
      );

      const tokens = this.tokensForNetwork(
        networkId,
        requestedTokenIdentities,
      );
      if (tokens.length > this.maxTokensPerNetwork) {
        throw new PortfolioError('PORTFOLIO_RESULT_LIMIT');
      }
      for (const token of tokens) {
        const candidate = this.tokenDiscoveryService?.getCandidate(token);
        const visibility: PortfolioVisibility =
          candidate?.visibility ?? 'visible';
        if (!includeHidden && visibility === 'hidden') {
          continue;
        }
        portfolioAssets.push(
          await this.createTokenPortfolioAsset(
            token,
            candidate,
            account,
          ),
        );
        if (portfolioAssets.length > this.maxAssets) {
          throw new PortfolioError('PORTFOLIO_RESULT_LIMIT');
        }
      }
      readService.accountState.assertNetworkContext();
    }

    return Object.freeze({
      kind: 'portfolio',
      account,
      networks: Object.freeze(portfolioNetworks),
      assets: Object.freeze(portfolioAssets),
      summary: this.summarize(portfolioAssets, networkIds.length),
      refreshedAtMs: this.now(),
    });
  }

  private validateAccount(query: PortfolioQuery): PortfolioAccount {
    if (
      typeof query !== 'object' ||
      query === null ||
      typeof query.accountId !== 'string' ||
      query.accountId.trim().length === 0
    ) {
      throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
    }
    try {
      return Object.freeze({
        accountId: query.accountId,
        address: normalizePublicEvmAddress(query.accountAddress),
      });
    } catch {
      throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
    }
  }

  private validateNetworks(
    networkIds: readonly string[],
  ): readonly string[] {
    if (
      !Array.isArray(networkIds) ||
      networkIds.length === 0 ||
      networkIds.length > this.maxNetworks ||
      networkIds.some(
        (networkId) =>
          typeof networkId !== 'string' || networkId.trim().length === 0,
      )
    ) {
      throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
    }
    const unique = [...new Set(networkIds)];
    if (unique.length !== networkIds.length) {
      throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
    }
    return Object.freeze(unique);
  }

  private resolveNetwork(networkId: string) {
    try {
      return this.assets.resolveNativeAsset(networkId);
    } catch (error) {
      if (error instanceof AssetError) {
        if (error.code === 'ASSET_NETWORK_NOT_CONFIGURED') {
          throw new PortfolioError('PORTFOLIO_NETWORK_NOT_CONFIGURED');
        }
        if (error.code === 'ASSET_NETWORK_DISABLED') {
          throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
        }
      }
      throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
    }
  }

  private resolveRequestedTokens(
    identities: readonly AssetIdentity[] | undefined,
    networkIds: readonly string[],
  ): readonly TokenAssetIdentity[] | null {
    if (identities === undefined) return null;
    if (!Array.isArray(identities)) {
      throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
    }
    const resolved: TokenAssetIdentity[] = [];
    const keys = new Set<string>();
    for (const identity of identities) {
      if (
        !identity ||
        identity.assetType !== 'fungible_token' ||
        !networkIds.includes(identity.networkId)
      ) {
        throw new PortfolioError('PORTFOLIO_INVALID_REQUEST');
      }
      const token = this.tokenService
        .getTokenRegistry()
        .resolveIdentity(identity.networkId, identity.assetId);
      const key = getAssetIdentityKey(token);
      if (keys.has(key)) continue;
      keys.add(key);
      resolved.push(token);
    }
    return Object.freeze(resolved);
  }

  private tokensForNetwork(
    networkId: string,
    requested: readonly TokenAssetIdentity[] | null,
  ): readonly ERC20Token[] {
    const tokens = requested
      ? requested
          .map((identity) => this.tokenService.getTokenRegistry().get(identity))
          .filter((token): token is ERC20Token => token !== undefined)
      : this.tokenService
          .getTokenRegistry()
          .getAll()
          .filter((token) => token.networkId === networkId);
    return Object.freeze(
      tokens.filter((token) => token.networkId === networkId),
    );
  }

  private async validateRemoteChain(
    readService: NetworkBoundTokenReadService,
  ): Promise<void> {
    try {
      const network = readService.accountState.getNetwork();
      const chainId = await readService.provider.request(
        'eth_chainId',
        [],
      );
      if (BigInt(chainId) !== BigInt(network.chainId as number)) {
        throw new PortfolioError('PORTFOLIO_CHAIN_MISMATCH');
      }
      readService.accountState.assertNetworkContext();
    } catch (error) {
      if (error instanceof PortfolioError) throw error;
      throw mapPortfolioError(
        error,
        'PORTFOLIO_BALANCE_UNAVAILABLE',
      );
    }
  }

  private async readNativeBalance(
    networkId: string,
    account: PortfolioAccount,
  ) {
    try {
      return await this.nativeBalanceService.getBalance({
        networkId,
        accountId: account.accountId,
        address: account.address,
      });
    } catch (error) {
      if (
        error instanceof AssetError &&
        (error.code === 'BALANCE_NETWORK_CHANGED' ||
          error.code === 'BALANCE_CHAIN_MISMATCH')
      ) {
        throw mapPortfolioError(error, 'PORTFOLIO_BALANCE_UNAVAILABLE');
      }
      return error;
    }
  }

  private createNativePortfolioAsset(
    nativeAsset: ReturnType<AssetRegistry['resolveNativeAsset']>,
    account: PortfolioAccount,
    balanceOrError: Awaited<
      ReturnType<NativeAssetBalanceService['getBalance']>
    > | unknown,
  ): PortfolioAsset {
    const error = balanceOrError instanceof Error ? balanceOrError : null;
    const balance =
      error === null
        ? (balanceOrError as Awaited<
            ReturnType<NativeAssetBalanceService['getBalance']>
          >)
        : null;
    const status: PortfolioAssetStatus =
      balance === null ? 'balance_unavailable' : 'available';
    return Object.freeze({
      identity: nativeAsset,
      networkId: nativeAsset.networkId,
      accountId: account.accountId,
      asset: nativeAsset,
      name: nativeAsset.name,
      symbol: nativeAsset.symbol,
      decimals: nativeAsset.decimals,
      metadataStatus: 'complete',
      verificationStatus: null,
      discoveryState: null,
      sources: ['native'] as const,
      provenance: [] as const,
      visibility: 'visible',
      status,
      errorCode: errorCode(error),
      icon: createAssetIcon(
        nativeAsset,
        nativeAsset.name,
        nativeAsset.symbol,
        'native_currency',
      ),
      balance:
        balance === null
          ? emptyBalance()
          : Object.freeze({
              rawAmount: balance.rawBalance,
              decimals: balance.decimals,
              formattedAmount: balance.displayAmount,
              hasBalance: hasBalance(balance.rawBalance),
              blockNumber: balance.blockNumber,
              blockHash: balance.blockHash,
              retrievedAtMs: balance.retrievedAtMs,
            }),
    });
  }

  private async createTokenPortfolioAsset(
    token: ERC20Token,
    candidate: TokenCandidate | undefined,
    account: PortfolioAccount,
  ): Promise<PortfolioAsset> {
    const sources = tokenSources(token, candidate);
    let balance: TokenBalance | null = null;
    let failure: unknown = null;
    try {
      balance = await this.tokenService.getTokenBalance({
        networkId: token.networkId,
        contractAddress: token.contractAddress,
        accountId: account.accountId,
        accountAddress: account.address,
        token,
      });
    } catch (error) {
      if (
        error instanceof AssetError &&
        (error.code === 'TOKEN_NETWORK_CHANGED' ||
          error.code === 'TOKEN_CHAIN_MISMATCH')
      ) {
        throw mapPortfolioError(error, 'PORTFOLIO_BALANCE_UNAVAILABLE');
      }
      failure = error;
    }
    const metadataUnavailable =
      token.decimals === null ||
      token.metadataStatus === 'unavailable' ||
      token.metadataStatus === 'invalid';
    const status: PortfolioAssetStatus = metadataUnavailable
      ? 'metadata_unavailable'
      : balance === null
        ? 'balance_unavailable'
        : 'available';
    return Object.freeze({
      identity: token,
      networkId: token.networkId,
      accountId: account.accountId,
      asset: token,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      metadataStatus: token.metadataStatus,
      verificationStatus:
        candidate?.verificationStatus ?? token.verificationStatus,
      discoveryState: candidate?.discoveryState ?? null,
      sources: sources.sources,
      provenance: sources.provenance,
      visibility: candidate?.visibility ?? 'visible',
      status,
      errorCode: errorCode(failure),
      icon: createAssetIcon(token, token.name, token.symbol),
      balance:
        balance === null
          ? emptyBalance()
          : Object.freeze({
              rawAmount: balance.rawBalance,
              decimals: balance.decimals,
              formattedAmount: balance.displayAmount,
              hasBalance: hasBalance(balance.rawBalance),
              blockNumber: balance.blockNumber,
              blockHash: balance.blockHash,
              retrievedAtMs: balance.retrievedAtMs,
            }),
    });
  }

  private summarize(
    assets: readonly PortfolioAsset[],
    networkCount: number,
  ): PortfolioSummary {
    return Object.freeze({
      networksRepresented: networkCount,
      visibleAssetCount: assets.filter(
        (asset) => asset.visibility === 'visible',
      ).length,
      hiddenAssetCount: assets.filter(
        (asset) => asset.visibility === 'hidden',
      ).length,
      assetsWithBalances: assets.filter(
        (asset) => asset.balance.hasBalance === true,
      ).length,
      nativeAssetCount: assets.filter(
        (asset) => asset.identity.assetType === 'native',
      ).length,
      fungibleTokenCount: assets.filter(
        (asset) => asset.identity.assetType === 'fungible_token',
      ).length,
      unavailableAssetCount: assets.filter(
        (asset) => asset.status !== 'available',
      ).length,
    });
  }
}