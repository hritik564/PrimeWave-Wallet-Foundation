import '@walletconnect/react-native-compat';

import { Core } from '@walletconnect/core';
import { WalletKit, type WalletKitTypes } from '@reown/walletkit';
import { getSdkError } from '@walletconnect/utils';
import type {
  SessionTypes,
  SignClientTypes,
} from '@walletconnect/types';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import {
  DAppError,
  type DAppAuthorizationBoundary,
  type DAppAuthorizationDecision,
  type DAppIdentity,
  type DAppSession,
  type DAppTransport,
  type DAppTransportEvent,
  type DAppTransportResponse,
  type DAppRequest,
  normalizeSigningRequest,
  normalizeTransactionRequest,
  type SigningSessionRequestInput,
  InMemoryDAppSessionRepository,
  type DAppSessionRepository,
} from '@/src/core/dapp';
import type { NetworkRegistry } from '@/src/core/networks';
import {
  WALLETCONNECT_PROVIDER_ID,
  buildApprovedNamespaces,
  mapWalletConnectProposal,
  readWalletConnectAccounts,
  type WalletConnectMappedProposal,
} from './mapping';

interface WalletConnectStorage {
  getKeys(): Promise<string[]>;
  getEntries<T = unknown>(): Promise<[string, T][]>;
  getItem<T = unknown>(key: string): Promise<T | undefined>;
  setItem<T = unknown>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class InMemoryWalletConnectStorage implements WalletConnectStorage {
  private readonly values = new Map<string, unknown>();

  getKeys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()]);
  }

  getEntries<T = unknown>(): Promise<[string, T][]> {
    return Promise.resolve(
      [...this.values.entries()] as [string, T][],
    );
  }

  getItem<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  setItem<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  removeItem(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

export type WalletConnectWalletMetadata = WalletKitTypes.Metadata;

export interface WalletConnectDAppTransportOptions {
  readonly projectId: string;
  readonly metadata: WalletConnectWalletMetadata;
  readonly registry: NetworkRegistry;
  readonly authorization?: DAppAuthorizationBoundary;
  readonly repository?: DAppSessionRepository;
  readonly now?: () => number;
}

interface SessionScope {
  readonly accountId: string;
  readonly networkId: string;
}

interface PendingProposal {
  readonly event: WalletKitTypes.EventArguments['session_proposal'];
  readonly mapped: WalletConnectMappedProposal;
}

interface PendingRequest {
  readonly event: WalletKitTypes.EventArguments['session_request'];
  readonly request: DAppRequest;
}

function providerError(
  code: DAppError['code'],
  message: string,
): DAppError {
  return new DAppError(code, message);
}

function safeErrorCode(error: unknown): string {
  return error instanceof DAppError ? error.code : 'PROVIDER_TRANSPORT_ERROR';
}

function sameIdentity(
  left: DAppIdentity,
  right: DAppIdentity,
): boolean {
  return (
    left.dappId === right.dappId &&
    left.name === right.name &&
    left.description === right.description &&
    left.url === right.url &&
    left.iconUrl === right.iconUrl &&
    left.origin === right.origin &&
    left.providerSessionId === right.providerSessionId &&
    left.metadataVersion === right.metadataVersion
  );
}

function providerRejectionReason(error: DAppError): ReturnType<typeof getSdkError> {
  switch (error.code) {
    case 'PROVIDER_UNSUPPORTED_CHAIN':
      return getSdkError('UNSUPPORTED_CHAINS');
    case 'PROVIDER_UNSUPPORTED_NAMESPACE':
      return getSdkError('UNSUPPORTED_NAMESPACE_KEY');
    case 'PROVIDER_UNSUPPORTED_REQUEST':
      return getSdkError('UNSUPPORTED_METHODS');
    case 'PROVIDER_SESSION_EXPIRED':
      return getSdkError('USER_REJECTED');
    default:
      return getSdkError('USER_REJECTED');
  }
}

function parseEip155Chain(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    !value.startsWith('eip155:') ||
    !/^[0-9]+$/.test(value.slice('eip155:'.length))
  ) {
    throw providerError(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The DApp request chain is not a supported EVM chain.',
    );
  }
  const chain = BigInt(value.slice('eip155:'.length));
  if (chain > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw providerError(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The DApp request chain is outside the supported range.',
    );
  }
  return chain;
}

function validExpiry(expirySeconds: number, now: number): number {
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds * 1_000 <= now) {
    throw providerError(
      'PROVIDER_SESSION_EXPIRED',
      'The provider session is expired.',
    );
  }
  return expirySeconds * 1_000;
}

function makePermissions(
  decision: Extract<DAppAuthorizationDecision, { decision: 'approved' }>,
  now: number,
) {
  return decision.approvedCapabilities.map((capability) => ({
    capability,
    accountId: decision.accountId,
    networkId: capability === 'network-access' ? decision.networkId : null,
    grantedAt: now,
    revokedAt: null,
  }));
}

export class WalletConnectDAppTransport implements DAppTransport {
  readonly providerId = WALLETCONNECT_PROVIDER_ID;

  private listener: ((event: DAppTransportEvent) => void) | null = null;
  private started = false;
  private readonly repository: DAppSessionRepository;
  private readonly sessionScopes = new Map<string, SessionScope>();
  private readonly pendingProposals = new Map<string, PendingProposal>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly handledRequestIds = new Set<string>();
  private readonly now: () => number;

  private readonly onSessionProposal = (
    proposal: WalletKitTypes.EventArguments['session_proposal'],
  ): void => {
    void this.handleSessionProposal(proposal);
  };

  private readonly onSessionRequest = (
    request: WalletKitTypes.EventArguments['session_request'],
  ): void => {
    void this.handleSessionRequest(request);
  };

  private readonly onSessionDelete = (
    event: WalletKitTypes.EventArguments['session_delete'],
  ): void => {
    void this.handleSessionDelete(event.topic);
  };

  private readonly onProposalExpire = (
    event: WalletKitTypes.EventArguments['proposal_expire'],
  ): void => {
    this.emitError('PROVIDER_SESSION_EXPIRED');
    void event;
  };

  private readonly onSessionRequestExpire = (
    event: WalletKitTypes.EventArguments['session_request_expire'],
  ): void => {
    const requestId = String(event.id);
    this.pendingRequests.delete(requestId);
    this.emitError('PROVIDER_SESSION_EXPIRED');
  };

  private readonly onSessionUpdate = (
    event: SignClientTypes.EventArguments['session_update'],
  ): void => {
    void this.handleSessionUpdate(event.topic);
  };

  private readonly onSessionExpire = (
    event: SignClientTypes.EventArguments['session_expire'],
  ): void => {
    void this.handleSessionClose(event.topic, 'expired', 'expired');
  };

  private constructor(
    private readonly walletKit: InstanceType<typeof WalletKit>,
    private readonly options: WalletConnectDAppTransportOptions,
  ) {
    this.repository =
      options.repository ?? new InMemoryDAppSessionRepository();
    this.now = options.now ?? Date.now;
  }

  static async create(
    options: WalletConnectDAppTransportOptions,
  ): Promise<WalletConnectDAppTransport> {
    if (
      typeof options.projectId !== 'string' ||
      options.projectId.trim().length === 0
    ) {
      throw new DAppError(
        'PROVIDER_UNAVAILABLE',
        'WalletConnect project configuration is unavailable.',
      );
    }

    const core = new Core({
      projectId: options.projectId,
      storage: new InMemoryWalletConnectStorage(),
    });
    const walletKit = await WalletKit.init({
      core,
      metadata: options.metadata,
    });
    return new WalletConnectDAppTransport(walletKit, options);
  }

  async start(listener: (event: DAppTransportEvent) => void): Promise<void> {
    if (this.started) return;
    this.listener = listener;
    this.walletKit.on('session_proposal', this.onSessionProposal);
    this.walletKit.on('session_request', this.onSessionRequest);
    this.walletKit.on('session_delete', this.onSessionDelete);
    this.walletKit.on('proposal_expire', this.onProposalExpire);
    this.walletKit.on('session_request_expire', this.onSessionRequestExpire);
    this.walletKit.engine.signClient.events.on(
      'session_update',
      this.onSessionUpdate,
    );
    this.walletKit.engine.signClient.events.on(
      'session_expire',
      this.onSessionExpire,
    );
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.walletKit.off('session_proposal', this.onSessionProposal);
    this.walletKit.off('session_request', this.onSessionRequest);
    this.walletKit.off('session_delete', this.onSessionDelete);
    this.walletKit.off('proposal_expire', this.onProposalExpire);
    this.walletKit.off(
      'session_request_expire',
      this.onSessionRequestExpire,
    );
    this.walletKit.engine.signClient.events.off(
      'session_update',
      this.onSessionUpdate,
    );
    this.walletKit.engine.signClient.events.off(
      'session_expire',
      this.onSessionExpire,
    );
    this.listener = null;
    this.started = false;
  }

  async pair(uri: string): Promise<void> {
    if (
      typeof uri !== 'string' ||
      uri.length > 4_096 ||
      !uri.startsWith('wc:')
    ) {
      throw new DAppError(
        'PROVIDER_MALFORMED_PROPOSAL',
        'The WalletConnect pairing URI is invalid.',
      );
    }
    try {
      await this.walletKit.pair({ uri });
    } catch {
      throw new DAppError(
        'PROVIDER_TRANSPORT_ERROR',
        'The WalletConnect pairing could not be started.',
      );
    }
  }

  async sendResponse(response: DAppTransportResponse): Promise<void> {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      throw new DAppError('INVALID_REQUEST', 'The DApp request is no longer available.');
    }
    const id = Number(response.requestId);
    if (!Number.isSafeInteger(id)) {
      throw new DAppError('INVALID_REQUEST', 'The DApp request ID is invalid.');
    }
    try {
      if (response.status === 'completed' && typeof response.result === 'string') {
        await this.walletKit.respondSessionRequest({
          topic: pending.event.topic,
          response: { id, jsonrpc: '2.0', result: response.result },
        });
      } else {
        const error =
          response.errorCode === 'EXECUTION_FAILED'
            ? { code: -32000, message: 'The wallet could not execute the transaction.' }
            : response.errorCode === 'STALE_REQUEST'
              ? { code: -32000, message: 'The transaction request is stale.' }
              : response.errorCode === 'UNKNOWN_RESULT'
                ? { code: -32000, message: 'The transaction result is unknown.' }
                : getSdkError('USER_REJECTED');
        await this.walletKit.respondSessionRequest({
          topic: pending.event.topic,
          response: {
            id,
            jsonrpc: '2.0',
            error,
          },
        });
      }
      this.pendingRequests.delete(response.requestId);
      this.handledRequestIds.add(response.requestId);
    } catch {
      throw new DAppError(
        'PROVIDER_TRANSPORT_ERROR',
        'The DApp request response could not be delivered.',
      );
    }
  }

  async approveProposal(proposalId: string): Promise<DAppSession> {
    const pending = this.pendingProposals.get(proposalId);
    if (!pending) {
      throw new DAppError(
        'PROVIDER_MALFORMED_PROPOSAL',
        'The DApp connection request is no longer available.',
      );
    }
    if (!this.options.authorization) {
      throw new DAppError(
        'PROVIDER_UNAVAILABLE',
        'DApp connection authorization is unavailable.',
      );
    }

    const remapped = mapWalletConnectProposal(
      pending.event.params,
      this.options.registry,
      this.now(),
    );
    if (
      remapped.proposal.proposalId !== pending.mapped.proposal.proposalId ||
      !sameIdentity(
        remapped.proposal.identity,
        pending.mapped.proposal.identity,
      ) ||
      remapped.proposal.requestedNetworkIds.join(',') !==
        pending.mapped.proposal.requestedNetworkIds.join(',') ||
      remapped.proposal.requestedChainIds.join(',') !==
        pending.mapped.proposal.requestedChainIds.join(',') ||
      remapped.proposal.requestedCapabilities.join(',') !==
        pending.mapped.proposal.requestedCapabilities.join(',')
    ) {
      throw new DAppError(
        'PROVIDER_MALFORMED_PROPOSAL',
        'The DApp connection request changed while it was open.',
      );
    }

    const decision = await this.options.authorization.authorize(
      remapped.proposal,
    );
    if (decision.decision === 'rejected') {
      throw new DAppError(
        'PROVIDER_UNSUPPORTED_REQUEST',
        decision.reason ?? 'The DApp connection request was rejected.',
      );
    }

    try {
      const namespaces = buildApprovedNamespaces(
        remapped,
        decision,
        this.options.registry,
      );
      const providerSession = await this.walletKit.approveSession({
        id: pending.event.id,
        namespaces,
      });
      const session = this.createCoreSession(
        providerSession,
        remapped.proposal.identity,
        decision,
      );
      const stored = this.repository.create(session);
      this.sessionScopes.set(providerSession.topic, {
        accountId: stored.accountId,
        networkId: stored.networkId,
      });
      this.pendingProposals.delete(proposalId);
      this.emit({ type: 'session', event: 'approved', session: stored });
      return stored;
    } catch (error) {
      const normalized =
        error instanceof DAppError
          ? error
          : providerError(
              'PROVIDER_TRANSPORT_ERROR',
              'The WalletConnect session could not be approved.',
            );
      await this.rejectPendingProposal(pending, normalized);
      throw normalized;
    }
  }

  async rejectProposal(proposalId: string): Promise<void> {
    const pending = this.pendingProposals.get(proposalId);
    if (!pending) {
      throw new DAppError(
        'PROVIDER_MALFORMED_PROPOSAL',
        'The DApp connection request is no longer available.',
      );
    }
    await this.rejectPendingProposal(
      pending,
      providerError(
        'PROVIDER_UNSUPPORTED_REQUEST',
        'The DApp connection request was rejected.',
      ),
    );
  }

  async disconnect(sessionId: string): Promise<void> {
    const scope = this.sessionScopes.get(sessionId);
    if (!scope) {
      throw new DAppError('SESSION_NOT_FOUND', 'DApp session was not found.');
    }
    try {
      await this.walletKit.disconnectSession({
        topic: sessionId,
        reason: getSdkError('USER_DISCONNECTED'),
      });
      const session = this.repository.update(sessionId, scope, {
        status: 'disconnected',
        lastActivityAt: this.now(),
      });
      this.emit({ type: 'session', event: 'disconnected', session });
      this.sessionScopes.delete(sessionId);
    } catch {
      throw new DAppError(
        'PROVIDER_TRANSPORT_ERROR',
        'The WalletConnect session could not be disconnected.',
      );
    }
  }

  private async handleSessionProposal(
    event: WalletKitTypes.EventArguments['session_proposal'],
  ): Promise<void> {
    let mapped: WalletConnectMappedProposal;
    try {
      mapped = mapWalletConnectProposal(
        event.params,
        this.options.registry,
        this.now(),
      );
    } catch (error) {
      const normalized =
        error instanceof DAppError
          ? error
          : providerError(
              'PROVIDER_MALFORMED_PROPOSAL',
              'The WalletConnect proposal could not be validated.',
            );
      await this.rejectProviderProposal(event.id, normalized);
      this.emitError(normalized.code);
      return;
    }

    this.pendingProposals.set(mapped.proposal.proposalId, { event, mapped });
    this.emit({ type: 'proposal', proposal: mapped.proposal });
  }

  private async handleSessionRequest(
    event: WalletKitTypes.EventArguments['session_request'],
  ): Promise<void> {
    const scope = this.sessionScopes.get(event.topic);
    if (!scope) {
      await this.rejectSessionRequest(event, getSdkError('UNAUTHORIZED_METHOD'));
      this.emitError('SESSION_NOT_FOUND');
      return;
    }
    const requestId = String(event.id);
    if (this.handledRequestIds.has(requestId) || this.pendingRequests.has(requestId)) {
      await this.rejectSessionRequest(event, {
        code: -32000,
        message: 'The DApp request has already been handled.',
      });
      this.emitError('DUPLICATE_REQUEST');
      return;
    }
    let session: DAppSession | null = null;
    try {
      session = this.repository.get(event.topic, scope);
      if (
        !session ||
        session.status !== 'active' ||
        (session.expiresAt !== null && session.expiresAt <= this.now())
      ) {
        throw new DAppError(
          'PROVIDER_SESSION_EXPIRED',
          'The DApp session is no longer active.',
        );
      }
      const chain = parseEip155Chain(event.params.chainId);
      const network = this.options.registry.getByChainId(Number(chain));
      if (
        !network ||
        !network.enabled ||
        network.configurationStatus !== 'configured' ||
        network.chainId === null ||
        !session.approvedChainIds.includes(chain) ||
        !session.approvedNetworkIds.includes(network.id) ||
        !session.approvedCapabilities.includes('transaction-signing')
      ) {
        throw new DAppError('NETWORK_MISMATCH', 'The request network is not approved.');
      }
      const input: SigningSessionRequestInput = {
        requestId: String(event.id),
        sessionId: event.topic,
        identity: session.identity,
        accountId: session.accountId,
        walletAddress: session.walletAddress,
        networkId: network.id,
        chainId: chain,
        method: event.params.request.method,
        params: event.params.request.params,
        createdAt: this.now(),
        expiresAt: event.params.request.expiryTimestamp
          ? event.params.request.expiryTimestamp * 1_000
          : session.expiresAt,
      };
      const request =
        event.params.request.method === 'eth_sendTransaction'
          ? normalizeTransactionRequest({
              requestId: requestId,
              sessionId: event.topic,
              identity: session.identity,
              accountId: session.accountId,
              walletAddress: session.walletAddress,
              networkId: network.id,
              chainId: chain,
              createdAt: this.now(),
              expiresAt: input.expiresAt,
              params: event.params.request.params,
            })
          : normalizeSigningRequest(input);
      this.pendingRequests.set(requestId, { event, request });
      this.emit({ type: 'request', request });
      return;
    } catch (error) {
      const normalized =
        error instanceof DAppError
          ? error
          : providerError(
              'PROVIDER_UNSUPPORTED_REQUEST',
              'The DApp request could not be validated.',
            );
      await this.rejectSessionRequest(event, providerRejectionReason(normalized));
      this.emitError(normalized.code);
    }
  }

  private async rejectSessionRequest(
    event: WalletKitTypes.EventArguments['session_request'],
    reason: ReturnType<typeof getSdkError>,
  ): Promise<void> {
    try {
      await this.walletKit.respondSessionRequest({
        topic: event.topic,
        response: { id: event.id, jsonrpc: '2.0', error: reason },
      });
    } catch {
      this.emitError('PROVIDER_TRANSPORT_ERROR');
    }
  }

  private async handleSessionDelete(topic: string): Promise<void> {
    await this.handleSessionClose(topic, 'disconnected', 'disconnected');
  }

  private async handleSessionClose(
    topic: string,
    status: 'disconnected' | 'expired' | 'revoked',
    event: 'disconnected' | 'expired' | 'revoked',
  ): Promise<void> {
    const scope = this.sessionScopes.get(topic);
    if (!scope) return;
    try {
      const session = this.repository.update(topic, scope, {
        status,
        lastActivityAt: this.now(),
      });
      this.emit({ type: 'session', event, session });
    } catch {
      this.emitError(
        event === 'expired'
          ? 'PROVIDER_SESSION_EXPIRED'
          : 'PROVIDER_SESSION_DELETED',
      );
    } finally {
      this.sessionScopes.delete(topic);
    }
  }

  private async handleSessionUpdate(topic: string): Promise<void> {
    const scope = this.sessionScopes.get(topic);
    const providerSession = this.walletKit.getActiveSessions()[topic];
    if (!scope || !providerSession) return;

    try {
      const current = this.repository.get(topic, scope);
      if (!current) return;
      const accounts = readWalletConnectAccounts(
        providerSession,
        this.options.registry,
      );
      const expectedAddress = normalizePublicEvmAddress(current.walletAddress);
      const primary = accounts.find(
        (account) => account.networkId === current.networkId,
      );
      if (
        !primary ||
        accounts.some((account) => account.address !== expectedAddress)
      ) {
        await this.walletKit.disconnectSession({
          topic,
          reason: getSdkError('USER_REJECTED'),
        });
        await this.handleSessionClose(topic, 'revoked', 'revoked');
        return;
      }
      const updated = this.repository.update(topic, scope, {
        approvedNetworkIds: [...new Set(
          accounts.map((account) => account.networkId),
        )],
        approvedChainIds: [...new Set(
          accounts.map((account) => account.chainId),
        )],
        expiresAt: validExpiry(providerSession.expiry, this.now()),
        lastActivityAt: this.now(),
      });
      this.emit({ type: 'session', event: 'updated', session: updated });
    } catch (error) {
      this.emitError(safeErrorCode(error));
    }
  }

  private createCoreSession(
    providerSession: SessionTypes.Struct,
    identity: DAppIdentity,
    decision: Extract<DAppAuthorizationDecision, { decision: 'approved' }>,
  ): DAppSession {
    const accounts = readWalletConnectAccounts(
      providerSession,
      this.options.registry,
    );
    if (accounts.length === 0) {
      throw providerError(
        'PROVIDER_MALFORMED_PROPOSAL',
        'The WalletConnect session contains no approved account.',
      );
    }
    const expectedAddress = normalizePublicEvmAddress(decision.walletAddress);
    if (
      accounts.some((account) => account.address !== expectedAddress) ||
      !accounts.some((account) => account.networkId === decision.networkId)
    ) {
      throw providerError(
        'ACCOUNT_MISMATCH',
        'The provider session account does not match the authorized wallet.',
      );
    }
    const primary = accounts.find(
      (account) => account.networkId === decision.networkId,
    );
    if (!primary) {
      throw providerError(
        'NETWORK_MISMATCH',
        'The provider session does not contain the authorized network.',
      );
    }
    const now = this.now();
    return {
      sessionId: providerSession.topic,
      identity: Object.freeze({
        ...identity,
        providerSessionId: providerSession.topic,
      }),
      accountId: decision.accountId,
      walletAddress: expectedAddress,
      networkId: primary.networkId,
      chainId: primary.chainId,
      approvedNetworkIds: Object.freeze(
        [...new Set(accounts.map((account) => account.networkId))],
      ),
      approvedChainIds: Object.freeze(
        [...new Set(accounts.map((account) => account.chainId))],
      ),
      approvedCapabilities: Object.freeze([...decision.approvedCapabilities]),
      permissions: Object.freeze(makePermissions(decision, now)),
      createdAt: now,
      lastActivityAt: now,
      expiresAt: validExpiry(providerSession.expiry, now),
      status: 'active',
    };
  }

  private async rejectProviderProposal(
    id: number,
    error: DAppError,
  ): Promise<void> {
    try {
      await this.walletKit.rejectSession({
        id,
        reason: providerRejectionReason(error),
      });
    } catch {
      this.emitError('PROVIDER_TRANSPORT_ERROR');
    }
  }

  private async rejectPendingProposal(
    pending: PendingProposal,
    error: DAppError,
  ): Promise<void> {
    try {
      await this.walletKit.rejectSession({
        id: pending.event.id,
        reason: providerRejectionReason(error),
      });
      this.pendingProposals.delete(pending.mapped.proposal.proposalId);
    } catch {
      this.emitError('PROVIDER_TRANSPORT_ERROR');
      throw new DAppError(
        'PROVIDER_TRANSPORT_ERROR',
        'The DApp connection request could not be rejected.',
      );
    }
  }

  private emit(event: DAppTransportEvent): void {
    this.listener?.(event);
  }

  private emitError(errorCode: string): void {
    this.emit({ type: 'error', errorCode });
  }
}
