export type DAppCapability =
  | 'account-access'
  | 'network-access'
  | 'message-signing'
  | 'transaction-signing';

export const DAPP_CAPABILITIES: readonly DAppCapability[] = [
  'account-access',
  'network-access',
  'message-signing',
  'transaction-signing',
];

export type DAppSessionStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'disconnected'
  | 'revoked';

export interface DAppIdentity {
  readonly dappId: string;
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly iconUrl: string | null;
  readonly origin: string | null;
  readonly providerSessionId: string | null;
  readonly metadataVersion: string;
}

export interface DAppPermission {
  readonly capability: DAppCapability;
  readonly accountId: string;
  readonly networkId: string | null;
  readonly grantedAt: number;
  readonly revokedAt: number | null;
}

export interface DAppSession {
  readonly sessionId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly approvedCapabilities: readonly DAppCapability[];
  readonly permissions: readonly DAppPermission[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly expiresAt: number | null;
  readonly status: DAppSessionStatus;
}

export type DAppRequestType =
  | 'connect'
  | 'disconnect'
  | 'account-access'
  | 'network-information'
  | 'message-signing'
  | 'typed-data-signing'
  | 'transaction'
  | 'chain-request';

export type DAppRequestStatus =
  | 'created'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'expired';

export interface DAppRequestContext {
  readonly requestId: string;
  readonly sessionId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly requestType: DAppRequestType;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly status: DAppRequestStatus;
}