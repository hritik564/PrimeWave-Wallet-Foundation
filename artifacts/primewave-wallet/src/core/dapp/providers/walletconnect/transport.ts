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

function providerError(
  code: DAppError['code'],
  message: string,
): DAppError {
  return new DAppError(code, message);
}

function safeErrorCode(error: unknown): string {
  return error instanceof DAppError ? error.code : 'PROVIDER_TRANSPORT_ERROR';
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

  private readonly onSessionRequestExpire = (): void => {
    this.emitError('PROVIDER_UNSUPPORTED_REQUEST');
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

  async sendResponse(_response: DAppTransportResponse): Promise<void> {
    throw new DAppError(
      'PROVIDER_UNSUPPORTED_REQUEST',
      'DApp request execution is not available in this wallet phase.',
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
      await this.rejectProposal(event.id, normalized);
      this.emitError(normalized.code);
      return;
    }

    this.emit({ type: 'proposal', proposal: mapped.proposal });
    if (!this.options.authorization) {
      // A proposal is intentionally left pending until an explicit UI boundary
      // authorizes it. This path never creates a successful fake session.
      return;
    }

    try {
      const decision = await this.options.authorization.authorize(
        mapped.proposal,
      );
      if (decision.decision === 'rejected') {
        await this.walletKit.rejectSession({
          id: event.id,
          reason: getSdkError('USER_REJECTED'),
        });
        return;
      }

      const namespaces = buildApprovedNamespaces(
        mapped,
        decision,
        this.options.registry,
      );
      const providerSession = await this.walletKit.approveSession({
        id: event.id,
        namespaces,
      });
      const session = this.createCoreSession(
        providerSession,
        mapped.proposal.identity,
        decision,
      );
      const stored = this.repository.create(session);
      this.sessionScopes.set(providerSession.topic, {
        accountId: stored.accountId,
        networkId: stored.networkId,
      });
      this.emit({ type: 'session', event: 'approved', session: stored });
    } catch (error) {
      const normalized =
        error instanceof DAppError
          ? error
          : providerError(
              'PROVIDER_TRANSPORT_ERROR',
              'The WalletConnect session could not be approved.',
            );
      await this.rejectProposal(event.id, normalized);
      this.emitError(normalized.code);
    }
  }

  private async handleSessionRequest(
    event: WalletKitTypes.EventArguments['session_request'],
  ): Promise<void> {
    try {
      await this.walletKit.respondSessionRequest({
        topic: event.topic,
        response: {
          id: event.id,
          jsonrpc: '2.0',
          error: getSdkError('UNSUPPORTED_METHODS'),
        },
      });
    } catch {
      this.emitError('PROVIDER_TRANSPORT_ERROR');
      return;
    }
    this.emitError('PROVIDER_UNSUPPORTED_REQUEST');
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

  private async rejectProposal(
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

  private emit(event: DAppTransportEvent): void {
    this.listener?.(event);
  }

  private emitError(errorCode: string): void {
    this.emit({ type: 'error', errorCode });
  }
}
