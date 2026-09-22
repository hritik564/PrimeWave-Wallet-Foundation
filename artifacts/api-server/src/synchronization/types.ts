import type {
  IndexedTokenTransfer,
  IndexedTransaction,
  IndexerNetworkConfig,
  IndexingBounds,
} from "../indexing/types";

export type AccountSyncStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "conflict";

export type ReconciliationState =
  | "local_only"
  | "indexed"
  | "matched"
  | "confirmed"
  | "reverted"
  | "unknown"
  | "conflict"
  | "unresolved";

export type ReconciliationIdentityType =
  | "transaction"
  | "erc20_transfer"
  | "local_activity";

export type MatchEvidence =
  | "hash"
  | "supporting_signals"
  | "none"
  | "conflict";

export type SynchronizationErrorCode =
  | "CONFIGURATION_ERROR"
  | "VALIDATION_FAILURE"
  | "RESPONSE_LIMIT"
  | "INDEXING_GAP"
  | "PERSISTENCE_FAILURE"
  | "CONFLICT";

export interface SynchronizationBounds {
  readonly maxBlockRange: number;
  readonly maxPageSize: number;
  readonly maxOffset: number;
  readonly maxErrorLength: number;
}

export interface SynchronizationConfig {
  readonly enabled: boolean;
  readonly networks: readonly IndexerNetworkConfig[];
  readonly bounds: SynchronizationBounds;
}

export interface SyncScope {
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
}

export interface AccountSyncState {
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
  readonly lastSynchronizedBlock: bigint | null;
  readonly lastSynchronizedAt: Date | string | null;
  readonly status: AccountSyncStatus;
  readonly lastErrorCode: SynchronizationErrorCode | null;
  readonly lastErrorMessage: string | null;
  readonly updatedAt: Date | string;
}

export interface ReconciliationRecord {
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
  readonly identity: string;
  readonly identityType: ReconciliationIdentityType;
  readonly transactionHash: string | null;
  readonly logIndex: number | null;
  readonly localActivityId: string | null;
  readonly state: ReconciliationState;
  readonly matchEvidence: MatchEvidence;
  readonly blockNumber: bigint | null;
  readonly blockHash: string | null;
  readonly observedAt: Date | string | null;
  readonly updatedAt: Date | string;
}

export interface SyncObservationPage {
  readonly transactions: readonly IndexedTransaction[];
  readonly transfers: readonly IndexedTokenTransfer[];
  readonly hasMore: boolean;
}

export interface SynchronizationRepository {
  getState(scope: SyncScope): Promise<AccountSyncState | null>;
  listStates(scope: SyncScope): Promise<readonly AccountSyncState[]>;
  hasIndexedRange(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<boolean>;
  listAccountObservations(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
    limit: number,
    offset: number,
  ): Promise<SyncObservationPage>;
  listReconciliation(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<readonly ReconciliationRecord[]>;
  getReconciliationByIdentity(
    scope: SyncScope,
    identity: string,
  ): Promise<ReconciliationRecord | null>;
  getReconciliationByLocalActivity(
    scope: SyncScope,
    localActivityId: string,
  ): Promise<ReconciliationRecord | null>;
  findIndexedTransaction(
    scope: SyncScope,
    transactionHash: string,
  ): Promise<IndexedTransaction | null>;
  persistSynchronization(
    scope: SyncScope,
    endBlock: bigint,
    records: readonly ReconciliationRecord[],
  ): Promise<void>;
  persistReconciliation(record: ReconciliationRecord): Promise<void>;
  replaceReconciliation(
    scope: SyncScope,
    previousIdentity: string,
    record: ReconciliationRecord,
  ): Promise<void>;
  markStatus(
    scope: SyncScope,
    update: {
      readonly status: AccountSyncStatus;
      readonly lastSynchronizedBlock?: bigint | null;
      readonly lastSynchronizedAt?: Date | null;
      readonly lastErrorCode?: SynchronizationErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void>;
}

export interface SynchronizedTransaction {
  readonly identity: string;
  readonly kind: "transaction";
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
  readonly transactionHash: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionIndex: number;
  readonly from: string;
  readonly to: string | null;
  readonly value: string;
  readonly nonce: string;
  readonly transactionType: string | null;
  readonly status: IndexedTransaction["status"];
  readonly direction: "incoming" | "outgoing" | "self-transfer" | "unknown";
  readonly blockTimestamp: string;
  readonly reconciliationState: ReconciliationState;
  readonly matchEvidence: MatchEvidence;
  readonly localActivityId: string | null;
}

export interface SynchronizedTokenTransfer {
  readonly identity: string;
  readonly kind: "erc20_transfer";
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
  readonly tokenContractAddress: string;
  readonly from: string;
  readonly to: string;
  readonly amountRaw: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly direction: "incoming" | "outgoing" | "self-transfer" | "unknown";
  readonly blockTimestamp: string;
  readonly reconciliationState: ReconciliationState;
  readonly matchEvidence: MatchEvidence;
  readonly localActivityId: string | null;
}

export type SynchronizedActivity =
  | SynchronizedTransaction
  | SynchronizedTokenTransfer;

export interface SynchronizedActivityPage {
  readonly scope: SyncScope;
  readonly startBlock: string;
  readonly endBlock: string;
  readonly items: readonly SynchronizedActivity[];
  readonly totalReturned: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
}

export interface SynchronizationStatusSnapshot {
  readonly enabled: boolean;
  readonly scope: SyncScope;
  readonly configured: boolean;
  readonly status: AccountSyncStatus;
  readonly lastSynchronizedBlock: string | null;
  readonly lastSynchronizedAt: string | null;
  readonly lastErrorCode: SynchronizationErrorCode | null;
  readonly lastErrorMessage: string | null;
  readonly updatedAt: string | null;
}

export interface SynchronizationRunResult {
  readonly scope: SyncScope;
  readonly startBlock: string;
  readonly endBlock: string;
  readonly observations: number;
  readonly reconciliationRecords: number;
}

export interface LocalActivityContext {
  readonly scope: SyncScope;
  readonly localActivityId: string;
  readonly transactionHash?: string | null;
  readonly localStatus:
    | "draft"
    | "signed"
    | "broadcasting"
    | "broadcasted"
    | "confirming"
    | "confirmed"
    | "reverted"
    | "failed"
    | "unknown";
}

export type { IndexedTokenTransfer, IndexedTransaction, IndexerNetworkConfig, IndexingBounds };