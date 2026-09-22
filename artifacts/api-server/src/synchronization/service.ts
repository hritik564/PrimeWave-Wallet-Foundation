import { normalizeSynchronizationError, SynchronizationError } from "./errors";
import {
  assertBoundedSyncRange,
  normalizeSyncNetworkId,
  normalizeTransactionHash,
  validateSyncScope,
} from "./validation";
import type {
  AccountSyncState,
  LocalActivityContext,
  ReconciliationRecord,
  ReconciliationState,
  SyncScope,
  SynchronizedActivity,
  SynchronizedActivityPage,
  SynchronizedTokenTransfer,
  SynchronizedTransaction,
  SynchronizationConfig,
  SynchronizationRepository,
  SynchronizationRunResult,
  SynchronizationStatusSnapshot,
} from "./types";
import type {
  IndexedTokenTransfer,
  IndexedTransaction,
} from "../indexing/types";

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function transactionIdentity(networkId: string, transactionHash: string): string {
  return `${networkId}:${transactionHash}`;
}

function transferIdentity(
  networkId: string,
  transactionHash: string,
  logIndex: number,
): string {
  return `${networkId}:${transactionHash}:${logIndex}`;
}

function direction(
  accountAddress: string,
  from: string,
  to: string | null,
): "incoming" | "outgoing" | "self-transfer" | "unknown" {
  if (from === accountAddress && to === accountAddress) return "self-transfer";
  if (from === accountAddress) return "outgoing";
  if (to === accountAddress) return "incoming";
  return "unknown";
}

function stateForIndexedStatus(
  status: IndexedTransaction["status"] | null,
): ReconciliationState {
  if (status === "success") return "confirmed";
  if (status === "reverted") return "reverted";
  if (status === "unknown") return "unknown";
  return "indexed";
}

function recordForTransaction(
  scope: SyncScope,
  transaction: IndexedTransaction,
): ReconciliationRecord {
  return {
    networkId: scope.networkId,
    chainId: scope.chainId,
    accountAddress: scope.accountAddress,
    identity: transactionIdentity(scope.networkId, transaction.transactionHash),
    identityType: "transaction",
    transactionHash: transaction.transactionHash,
    logIndex: null,
    localActivityId: null,
    state: stateForIndexedStatus(transaction.status),
    matchEvidence: "none",
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
    observedAt: transaction.observedAt,
    updatedAt: new Date(),
  };
}

function recordForTransfer(
  scope: SyncScope,
  transfer: IndexedTokenTransfer,
  transaction: IndexedTransaction | null,
): ReconciliationRecord {
  return {
    networkId: scope.networkId,
    chainId: scope.chainId,
    accountAddress: scope.accountAddress,
    identity: transferIdentity(
      scope.networkId,
      transfer.transactionHash,
      transfer.logIndex,
    ),
    identityType: "erc20_transfer",
    transactionHash: transfer.transactionHash,
    logIndex: transfer.logIndex,
    localActivityId: null,
    state: stateForIndexedStatus(transaction?.status ?? null),
    matchEvidence: "none",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    observedAt: transfer.observedAt,
    updatedAt: new Date(),
  };
}

function recordMap(
  records: readonly ReconciliationRecord[],
): Map<string, ReconciliationRecord> {
  return new Map(records.map((record) => [record.identity, record]));
}

function itemState(
  identity: string,
  fallback: ReconciliationRecord,
  records: Map<string, ReconciliationRecord>,
): ReconciliationRecord {
  return records.get(identity) ?? fallback;
}

function toTransactionItem(
  scope: SyncScope,
  transaction: IndexedTransaction,
  reconciliation: ReconciliationRecord,
): SynchronizedTransaction {
  return {
    identity: reconciliation.identity,
    kind: "transaction",
    networkId: scope.networkId,
    chainId: scope.chainId,
    accountAddress: scope.accountAddress,
    transactionHash: transaction.transactionHash,
    blockNumber: transaction.blockNumber.toString(10),
    blockHash: transaction.blockHash,
    transactionIndex: transaction.transactionIndex,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    nonce: transaction.nonce,
    transactionType: transaction.transactionType,
    status: transaction.status,
    direction: direction(scope.accountAddress, transaction.from, transaction.to),
    blockTimestamp: transaction.timestamp.toString(10),
    reconciliationState: reconciliation.state,
    matchEvidence: reconciliation.matchEvidence,
    localActivityId: reconciliation.localActivityId,
  };
}

function toTransferItem(
  scope: SyncScope,
  transfer: IndexedTokenTransfer,
  reconciliation: ReconciliationRecord,
): SynchronizedTokenTransfer {
  return {
    identity: reconciliation.identity,
    kind: "erc20_transfer",
    networkId: scope.networkId,
    chainId: scope.chainId,
    accountAddress: scope.accountAddress,
    tokenContractAddress: transfer.tokenContractAddress,
    from: transfer.from,
    to: transfer.to,
    amountRaw: transfer.amountRaw,
    blockNumber: transfer.blockNumber.toString(10),
    blockHash: transfer.blockHash,
    transactionHash: transfer.transactionHash,
    logIndex: transfer.logIndex,
    direction: direction(scope.accountAddress, transfer.from, transfer.to),
    blockTimestamp: transfer.timestamp.toString(10),
    reconciliationState: reconciliation.state,
    matchEvidence: reconciliation.matchEvidence,
    localActivityId: reconciliation.localActivityId,
  };
}

function sortItems(left: SynchronizedActivity, right: SynchronizedActivity): number {
  const blockDifference =
    BigInt(right.blockNumber) - BigInt(left.blockNumber);
  if (blockDifference !== 0n) return blockDifference > 0n ? 1 : -1;
  if (left.kind !== right.kind) return left.kind === "transaction" ? -1 : 1;
  if (left.kind === "transaction" && right.kind === "transaction") {
    return right.transactionIndex - left.transactionIndex;
  }
  if (left.kind === "erc20_transfer" && right.kind === "erc20_transfer") {
    return right.logIndex - left.logIndex;
  }
  return left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0;
}

export class SynchronizationService {
  constructor(
    private readonly config: SynchronizationConfig,
    private readonly repository: SynchronizationRepository,
  ) {}

  async getStatus(scopeInput: SyncScope): Promise<SynchronizationStatusSnapshot> {
    const network = this.requireNetwork(scopeInput.networkId);
    const scope = validateSyncScope(scopeInput, network.chainId);
    let state: AccountSyncState | null = null;
    let persistenceUnavailable = false;
    try {
      state = await this.repository.getState(scope);
    } catch {
      persistenceUnavailable = true;
    }
    return {
      enabled: this.config.enabled,
      scope,
      configured: network.enabled,
      status: persistenceUnavailable ? "failed" : state?.status ?? "idle",
      lastSynchronizedBlock:
        state?.lastSynchronizedBlock?.toString(10) ?? null,
      lastSynchronizedAt: isoDate(state?.lastSynchronizedAt ?? null),
      lastErrorCode:
        state?.lastErrorCode ??
        (persistenceUnavailable ? "PERSISTENCE_FAILURE" : null),
      lastErrorMessage:
        state?.lastErrorMessage ??
        (persistenceUnavailable
          ? "Synchronization persistence is unavailable."
          : null),
      updatedAt: isoDate(state?.updatedAt ?? null),
    };
  }

  async getActivity(
    scopeInput: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
    limit: number,
    offset: number,
  ): Promise<SynchronizedActivityPage> {
    const scope = this.prepareRange(
      scopeInput,
      startBlock,
      endBlock,
      limit,
      offset,
    );
    if (!(await this.repository.hasIndexedRange(scope, startBlock, endBlock))) {
      throw new SynchronizationError(
        "INDEXING_GAP",
        "The requested range is not fully indexed.",
      );
    }
    const [observations, storedRecords] = await Promise.all([
      this.repository.listAccountObservations(
        scope,
        startBlock,
        endBlock,
        limit + offset + 1,
        0,
      ),
      this.repository.listReconciliation(scope, startBlock, endBlock),
    ]);
    const records = recordMap(storedRecords);
    const items = [
      ...observations.transactions.map((transaction) => {
        const fallback = recordForTransaction(scope, transaction);
        return toTransactionItem(
          scope,
          transaction,
          itemState(fallback.identity, fallback, records),
        );
      }),
      ...observations.transfers.map((transfer) => {
        const parent = observations.transactions.find(
          (transaction) =>
            transaction.transactionHash === transfer.transactionHash,
        );
        const fallback = recordForTransfer(scope, transfer, parent ?? null);
        return toTransferItem(
          scope,
          transfer,
          itemState(fallback.identity, fallback, records),
        );
      }),
    ].sort(sortItems);
    const pagedItems = items.slice(offset, offset + limit);
    return {
      scope,
      startBlock: startBlock.toString(10),
      endBlock: endBlock.toString(10),
      items: Object.freeze(pagedItems),
      totalReturned: pagedItems.length,
      offset,
      limit,
      nextOffset:
        observations.hasMore || items.length > offset + limit
          ? offset + limit
          : null,
    };
  }

  async synchronizeRange(
    scopeInput: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<SynchronizationRunResult> {
    const scope = this.prepareRange(scopeInput, startBlock, endBlock, 1, 0);
    try {
      if (!(await this.repository.hasIndexedRange(scope, startBlock, endBlock))) {
        throw new SynchronizationError(
          "INDEXING_GAP",
          "The requested range is not fully indexed.",
        );
      }
      await this.repository.markStatus(scope, {
        status: "running",
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      const observations = await this.repository.listAccountObservations(
        scope,
        startBlock,
        endBlock,
        this.config.bounds.maxPageSize,
        0,
      );
      if (observations.hasMore) {
        throw new SynchronizationError(
          "RESPONSE_LIMIT",
          "The synchronized range contains too many observations.",
        );
      }
      const byHash = new Map(
        observations.transactions.map((transaction) => [
          transaction.transactionHash,
          transaction,
        ]),
      );
      const records = [
        ...observations.transactions.map((transaction) =>
          recordForTransaction(scope, transaction),
        ),
        ...observations.transfers.map((transfer) =>
          recordForTransfer(
            scope,
            transfer,
            byHash.get(transfer.transactionHash) ?? null,
          ),
        ),
      ];
      await this.repository.persistSynchronization(scope, endBlock, records);
      return {
        scope,
        startBlock: startBlock.toString(10),
        endBlock: endBlock.toString(10),
        observations: observations.transactions.length + observations.transfers.length,
        reconciliationRecords: records.length,
      };
    } catch (error) {
      const normalized = normalizeSynchronizationError(
        error,
        this.config.bounds.maxErrorLength,
      );
      try {
        await this.repository.markStatus(scope, {
          status: normalized.code === "CONFLICT" ? "conflict" : "failed",
          lastErrorCode: normalized.code,
          lastErrorMessage: normalized.message,
        });
      } catch {
        // Preserve the bounded synchronization error.
      }
      throw normalized;
    }
  }

  async reconcileLocalActivity(
    input: LocalActivityContext,
  ): Promise<ReconciliationRecord> {
    const network = this.requireNetwork(input.scope.networkId);
    const scope = validateSyncScope(input.scope, network.chainId);
    if (
      typeof input.localActivityId !== "string" ||
      input.localActivityId.trim().length === 0 ||
      input.localActivityId.length > 128
    ) {
      throw new SynchronizationError(
        "VALIDATION_FAILURE",
        "The local activity identity is invalid.",
      );
    }
    const localActivityId = input.localActivityId.trim();
    const existingLocal = await this.repository.getReconciliationByLocalActivity(
      scope,
      localActivityId,
    );
    const transactionHash = input.transactionHash
      ? normalizeTransactionHash(input.transactionHash)
      : null;
    if (
      existingLocal &&
      existingLocal.transactionHash !== null &&
      existingLocal.transactionHash !== transactionHash
    ) {
      const conflict: ReconciliationRecord = {
        ...existingLocal,
        identity: `conflict:${scope.networkId}:${localActivityId}:${transactionHash ?? "none"}`,
        transactionHash,
        localActivityId,
        state: "conflict",
        matchEvidence: "conflict",
        updatedAt: new Date(),
      };
      await this.repository.persistReconciliation(conflict);
      return conflict;
    }
    if (!transactionHash) {
      const localOnly: ReconciliationRecord = {
        networkId: scope.networkId,
        chainId: scope.chainId,
        accountAddress: scope.accountAddress,
        identity: `local:${scope.networkId}:${scope.accountAddress}:${localActivityId}`,
        identityType: "local_activity",
        transactionHash: null,
        logIndex: null,
        localActivityId,
        state: "local_only",
        matchEvidence: "none",
        blockNumber: null,
        blockHash: null,
        observedAt: new Date(),
        updatedAt: new Date(),
      };
      await this.repository.persistReconciliation(localOnly);
      return localOnly;
    }
    const transaction = await this.repository.findIndexedTransaction(
      scope,
      transactionHash,
    );
    const state: ReconciliationState = transaction
      ? transaction.status === "success"
        ? "confirmed"
        : transaction.status === "reverted"
          ? "reverted"
          : "matched"
      : "unresolved";
    const record: ReconciliationRecord = {
      networkId: scope.networkId,
      chainId: scope.chainId,
      accountAddress: scope.accountAddress,
      identity: transactionIdentity(scope.networkId, transactionHash),
      identityType: "transaction",
      transactionHash,
      logIndex: null,
      localActivityId,
      state,
      matchEvidence: "hash",
      blockNumber: transaction?.blockNumber ?? null,
      blockHash: transaction?.blockHash ?? null,
      observedAt: transaction?.observedAt ?? new Date(),
      updatedAt: new Date(),
    };
    if (existingLocal && existingLocal.transactionHash === null) {
      await this.repository.replaceReconciliation(
        scope,
        existingLocal.identity,
        record,
      );
    } else {
      await this.repository.persistReconciliation(record);
    }
    return record;
  }

  private prepareRange(
    scopeInput: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
    limit: number,
    offset: number,
  ): SyncScope {
    const network = this.requireNetwork(scopeInput.networkId);
    const scope = validateSyncScope(scopeInput, network.chainId);
    assertBoundedSyncRange(
      startBlock,
      endBlock,
      this.config.bounds.maxBlockRange,
    );
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.config.bounds.maxPageSize ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.config.bounds.maxOffset
    ) {
      throw new SynchronizationError(
        "RESPONSE_LIMIT",
        "The synchronization page is outside the limit.",
      );
    }
    return scope;
  }

  private requireNetwork(networkIdInput: string): {
    readonly networkId: string;
    readonly chainId: number;
    readonly enabled: boolean;
  } {
    const networkId = normalizeSyncNetworkId(networkIdInput);
    const network = this.config.networks.find(
      (candidate) => candidate.networkId === networkId,
    );
    if (!network || !this.config.enabled || !network.enabled) {
      throw new SynchronizationError(
        "CONFIGURATION_ERROR",
        "The synchronization network is not configured.",
      );
    }
    return network;
  }
}