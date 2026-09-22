import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  accountSyncStateTable,
  indexedBlocksTable,
  indexedTokenTransfersTable,
  indexedTransactionsTable,
  reconciliationRecordsTable,
} from "@workspace/db/schema";
import type { ServerConfig } from "../config";
import { SynchronizationError } from "./errors";
import type {
  AccountSyncState,
  AccountSyncStatus,
  ReconciliationRecord,
  ReconciliationState,
  SyncObservationPage,
  SyncScope,
  SynchronizationErrorCode,
  SynchronizationRepository,
} from "./types";
import type {
  IndexedTokenTransfer,
  IndexedTransaction,
} from "../indexing/types";

function stateFromRow(
  row: typeof accountSyncStateTable.$inferSelect,
): AccountSyncState {
  return {
    ...row,
    lastErrorCode: row.lastErrorCode as SynchronizationErrorCode | null,
  };
}

function reconciliationFromRow(
  row: typeof reconciliationRecordsTable.$inferSelect,
): ReconciliationRecord {
  return {
    ...row,
    identityType: row.identityType as ReconciliationRecord["identityType"],
    state: row.state as ReconciliationState,
    matchEvidence: row.matchEvidence as ReconciliationRecord["matchEvidence"],
  };
}

function observationScope(
  scope: SyncScope,
  startBlock: bigint,
  endBlock: bigint,
) {
  return and(
    eq(indexedTransactionsTable.networkId, scope.networkId),
    eq(indexedTransactionsTable.chainId, scope.chainId),
    or(
      eq(indexedTransactionsTable.from, scope.accountAddress),
      eq(indexedTransactionsTable.to, scope.accountAddress),
    ),
    gte(indexedTransactionsTable.blockNumber, startBlock),
    lte(indexedTransactionsTable.blockNumber, endBlock),
  );
}

function transferScope(
  scope: SyncScope,
  startBlock: bigint,
  endBlock: bigint,
) {
  return and(
    eq(indexedTokenTransfersTable.networkId, scope.networkId),
    eq(indexedTokenTransfersTable.chainId, scope.chainId),
    or(
      eq(indexedTokenTransfersTable.from, scope.accountAddress),
      eq(indexedTokenTransfersTable.to, scope.accountAddress),
    ),
    gte(indexedTokenTransfersTable.blockNumber, startBlock),
    lte(indexedTokenTransfersTable.blockNumber, endBlock),
  );
}

export class EmptySynchronizationRepository
  implements SynchronizationRepository
{
  async getState(): Promise<AccountSyncState | null> {
    return null;
  }

  async listStates(): Promise<readonly AccountSyncState[]> {
    return [];
  }

  async hasIndexedRange(): Promise<boolean> {
    return false;
  }

  async listAccountObservations(): Promise<SyncObservationPage> {
    return { transactions: [], transfers: [], hasMore: false };
  }

  async listReconciliation(): Promise<readonly ReconciliationRecord[]> {
    return [];
  }

  async getReconciliationByIdentity(): Promise<ReconciliationRecord | null> {
    return null;
  }

  async getReconciliationByLocalActivity(): Promise<ReconciliationRecord | null> {
    return null;
  }

  async findIndexedTransaction(): Promise<IndexedTransaction | null> {
    return null;
  }

  async persistSynchronization(): Promise<void> {
    throw new SynchronizationError(
      "PERSISTENCE_FAILURE",
      "Synchronization persistence is not configured.",
    );
  }

  async persistReconciliation(): Promise<void> {
    throw new SynchronizationError(
      "PERSISTENCE_FAILURE",
      "Synchronization persistence is not configured.",
    );
  }

  async replaceReconciliation(): Promise<void> {
    throw new SynchronizationError(
      "PERSISTENCE_FAILURE",
      "Synchronization persistence is not configured.",
    );
  }

  async markStatus(): Promise<void> {
    throw new SynchronizationError(
      "PERSISTENCE_FAILURE",
      "Synchronization persistence is not configured.",
    );
  }
}

export class PostgresSynchronizationRepository
  implements SynchronizationRepository
{
  private async database() {
    return import("@workspace/db").then(({ db }) => db);
  }

  async getState(scope: SyncScope): Promise<AccountSyncState | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(accountSyncStateTable)
      .where(
        and(
          eq(accountSyncStateTable.networkId, scope.networkId),
          eq(accountSyncStateTable.chainId, scope.chainId),
          eq(accountSyncStateTable.accountAddress, scope.accountAddress),
        ),
      )
      .limit(1);
    return rows[0] ? stateFromRow(rows[0]) : null;
  }

  async listStates(scope: SyncScope): Promise<readonly AccountSyncState[]> {
    const state = await this.getState(scope);
    return state ? [state] : [];
  }

  async hasIndexedRange(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<boolean> {
    const db = await this.database();
    const expected = Number(endBlock - startBlock + 1n);
    const rows = await db
      .select({ blockNumber: indexedBlocksTable.blockNumber })
      .from(indexedBlocksTable)
      .where(
        and(
          eq(indexedBlocksTable.networkId, scope.networkId),
          eq(indexedBlocksTable.chainId, scope.chainId),
          gte(indexedBlocksTable.blockNumber, startBlock),
          lte(indexedBlocksTable.blockNumber, endBlock),
        ),
      )
      .limit(expected + 1);
    return rows.length === expected;
  }

  async listAccountObservations(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
    limit: number,
    offset: number,
  ): Promise<SyncObservationPage> {
    const db = await this.database();
    const [transactions, transfers] = await Promise.all([
      db
        .select()
        .from(indexedTransactionsTable)
        .where(observationScope(scope, startBlock, endBlock))
        .orderBy(
          desc(indexedTransactionsTable.blockNumber),
          desc(indexedTransactionsTable.transactionIndex),
        )
        .limit(limit + 1)
        .offset(offset),
      db
        .select()
        .from(indexedTokenTransfersTable)
        .where(transferScope(scope, startBlock, endBlock))
        .orderBy(
          desc(indexedTokenTransfersTable.blockNumber),
          desc(indexedTokenTransfersTable.logIndex),
        )
        .limit(limit + 1)
        .offset(offset),
    ]);
    return {
      transactions: transactions.slice(0, limit),
      transfers: transfers.slice(0, limit),
      hasMore: transactions.length > limit || transfers.length > limit,
    };
  }

  async listReconciliation(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<readonly ReconciliationRecord[]> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(reconciliationRecordsTable)
      .where(
        and(
          eq(reconciliationRecordsTable.networkId, scope.networkId),
          eq(reconciliationRecordsTable.chainId, scope.chainId),
          eq(reconciliationRecordsTable.accountAddress, scope.accountAddress),
          or(
            and(
              gte(reconciliationRecordsTable.blockNumber, startBlock),
              lte(reconciliationRecordsTable.blockNumber, endBlock),
            ),
            isNull(reconciliationRecordsTable.blockNumber),
          ),
        ),
      )
      .limit(2_000);
    return rows.map(reconciliationFromRow);
  }

  async getReconciliationByIdentity(
    scope: SyncScope,
    identity: string,
  ): Promise<ReconciliationRecord | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(reconciliationRecordsTable)
      .where(
        and(
          eq(reconciliationRecordsTable.networkId, scope.networkId),
          eq(reconciliationRecordsTable.chainId, scope.chainId),
          eq(reconciliationRecordsTable.accountAddress, scope.accountAddress),
          eq(reconciliationRecordsTable.identity, identity),
        ),
      )
      .limit(1);
    return rows[0] ? reconciliationFromRow(rows[0]) : null;
  }

  async getReconciliationByLocalActivity(
    scope: SyncScope,
    localActivityId: string,
  ): Promise<ReconciliationRecord | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(reconciliationRecordsTable)
      .where(
        and(
          eq(reconciliationRecordsTable.networkId, scope.networkId),
          eq(reconciliationRecordsTable.chainId, scope.chainId),
          eq(reconciliationRecordsTable.accountAddress, scope.accountAddress),
          eq(reconciliationRecordsTable.localActivityId, localActivityId),
        ),
      )
      .orderBy(desc(reconciliationRecordsTable.updatedAt))
      .limit(1);
    return rows[0] ? reconciliationFromRow(rows[0]) : null;
  }

  async findIndexedTransaction(
    scope: SyncScope,
    transactionHash: string,
  ): Promise<IndexedTransaction | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(indexedTransactionsTable)
      .where(
        and(
          eq(indexedTransactionsTable.networkId, scope.networkId),
          eq(indexedTransactionsTable.chainId, scope.chainId),
          eq(indexedTransactionsTable.transactionHash, transactionHash),
          or(
            eq(indexedTransactionsTable.from, scope.accountAddress),
            eq(indexedTransactionsTable.to, scope.accountAddress),
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async persistSynchronization(
    scope: SyncScope,
    endBlock: bigint,
    records: readonly ReconciliationRecord[],
  ): Promise<void> {
    const db = await this.database();
    const now = new Date();
    await db.transaction(async (tx) => {
      if (records.length > 0) {
        for (const record of records) {
          await tx
            .insert(reconciliationRecordsTable)
            .values({
              networkId: record.networkId,
              chainId: record.chainId,
              accountAddress: record.accountAddress,
              identity: record.identity,
              identityType: record.identityType,
              transactionHash: record.transactionHash,
              logIndex: record.logIndex,
              localActivityId: record.localActivityId,
              state: record.state,
              matchEvidence: record.matchEvidence,
              blockNumber: record.blockNumber,
              blockHash: record.blockHash,
              observedAt:
                record.observedAt instanceof Date ? record.observedAt : now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                reconciliationRecordsTable.networkId,
                reconciliationRecordsTable.chainId,
                reconciliationRecordsTable.accountAddress,
                reconciliationRecordsTable.identity,
              ],
              set: {
                state: sql`case
                  when ${reconciliationRecordsTable.state} = 'conflict'
                    then ${reconciliationRecordsTable.state}
                  when ${reconciliationRecordsTable.state} in ('confirmed', 'reverted')
                    and excluded.state not in ('confirmed', 'reverted')
                    then ${reconciliationRecordsTable.state}
                  else excluded.state
                end`,
                matchEvidence: record.matchEvidence,
                blockNumber: record.blockNumber,
                blockHash: record.blockHash,
                observedAt:
                  record.observedAt instanceof Date ? record.observedAt : now,
                updatedAt: now,
              },
            });
        }
      }
      await tx
        .insert(accountSyncStateTable)
        .values({
          networkId: scope.networkId,
          chainId: scope.chainId,
          accountAddress: scope.accountAddress,
          lastSynchronizedBlock: endBlock,
          lastSynchronizedAt: now,
          status: "completed",
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            accountSyncStateTable.networkId,
            accountSyncStateTable.chainId,
            accountSyncStateTable.accountAddress,
          ],
          set: {
            lastSynchronizedBlock: endBlock,
            lastSynchronizedAt: now,
            status: "completed",
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          },
        });
    });
  }

  async persistReconciliation(record: ReconciliationRecord): Promise<void> {
    const db = await this.database();
    const now = new Date();
    await db
      .insert(reconciliationRecordsTable)
      .values({
        ...record,
        observedAt:
          record.observedAt instanceof Date ? record.observedAt : now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          reconciliationRecordsTable.networkId,
          reconciliationRecordsTable.chainId,
          reconciliationRecordsTable.accountAddress,
          reconciliationRecordsTable.identity,
        ],
        set: {
          localActivityId: record.localActivityId,
          state: record.state,
          matchEvidence: record.matchEvidence,
          transactionHash: record.transactionHash,
          logIndex: record.logIndex,
          blockNumber: record.blockNumber,
          blockHash: record.blockHash,
          observedAt:
            record.observedAt instanceof Date ? record.observedAt : now,
          updatedAt: now,
        },
      });
  }

  async replaceReconciliation(
    scope: SyncScope,
    previousIdentity: string,
    record: ReconciliationRecord,
  ): Promise<void> {
    const db = await this.database();
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .delete(reconciliationRecordsTable)
        .where(
          and(
            eq(reconciliationRecordsTable.networkId, scope.networkId),
            eq(reconciliationRecordsTable.chainId, scope.chainId),
            eq(reconciliationRecordsTable.accountAddress, scope.accountAddress),
            eq(reconciliationRecordsTable.identity, previousIdentity),
          ),
        );
      await tx
        .insert(reconciliationRecordsTable)
        .values({
          ...record,
          observedAt:
            record.observedAt instanceof Date ? record.observedAt : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            reconciliationRecordsTable.networkId,
            reconciliationRecordsTable.chainId,
            reconciliationRecordsTable.accountAddress,
            reconciliationRecordsTable.identity,
          ],
          set: {
            localActivityId: record.localActivityId,
            state: record.state,
            matchEvidence: record.matchEvidence,
            transactionHash: record.transactionHash,
            logIndex: record.logIndex,
            blockNumber: record.blockNumber,
            blockHash: record.blockHash,
            observedAt:
              record.observedAt instanceof Date ? record.observedAt : now,
            updatedAt: now,
          },
        });
    });
  }

  async markStatus(
    scope: SyncScope,
    update: {
      readonly status: AccountSyncStatus;
      readonly lastSynchronizedBlock?: bigint | null;
      readonly lastSynchronizedAt?: Date | null;
      readonly lastErrorCode?: SynchronizationErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    const db = await this.database();
    const now = new Date();
    const current = await this.getState(scope);
    const values = {
      networkId: scope.networkId,
      chainId: scope.chainId,
      accountAddress: scope.accountAddress,
      lastSynchronizedBlock:
        update.lastSynchronizedBlock ?? current?.lastSynchronizedBlock ?? null,
      lastSynchronizedAt:
        update.lastSynchronizedAt ??
        (current?.lastSynchronizedAt instanceof Date
          ? current.lastSynchronizedAt
          : null),
      status: update.status,
      lastErrorCode:
        update.lastErrorCode === undefined
          ? current?.lastErrorCode ?? null
          : update.lastErrorCode,
      lastErrorMessage:
        update.lastErrorMessage === undefined
          ? current?.lastErrorMessage ?? null
          : update.lastErrorMessage,
      updatedAt: now,
    };
    await db
      .insert(accountSyncStateTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          accountSyncStateTable.networkId,
          accountSyncStateTable.chainId,
          accountSyncStateTable.accountAddress,
        ],
        set: values,
      });
  }
}

export class InMemorySynchronizationRepository
  implements SynchronizationRepository
{
  private readonly states = new Map<string, AccountSyncState>();
  private readonly blocks = new Map<string, bigint>();
  private readonly transactions = new Map<string, IndexedTransaction>();
  private readonly transfers = new Map<string, IndexedTokenTransfer>();
  private readonly reconciliation = new Map<string, ReconciliationRecord>();

  addBlock(
    networkId: string,
    chainId: number,
    blockNumber: bigint,
  ): void {
    this.blocks.set(`${networkId}:${chainId}:${blockNumber}`, blockNumber);
  }

  addTransaction(transaction: IndexedTransaction): void {
    this.transactions.set(
      `${transaction.networkId}:${transaction.chainId}:${transaction.transactionHash}`,
      transaction,
    );
  }

  addTransfer(transfer: IndexedTokenTransfer): void {
    this.transfers.set(
      `${transfer.networkId}:${transfer.chainId}:${transfer.transactionHash}:${transfer.logIndex}`,
      transfer,
    );
  }

  async getState(scope: SyncScope): Promise<AccountSyncState | null> {
    return this.states.get(this.scopeKey(scope)) ?? null;
  }

  async listStates(scope: SyncScope): Promise<readonly AccountSyncState[]> {
    const state = await this.getState(scope);
    return state ? [state] : [];
  }

  async hasIndexedRange(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<boolean> {
    for (let block = startBlock; block <= endBlock; block += 1n) {
      if (!this.blocks.has(`${scope.networkId}:${scope.chainId}:${block}`)) {
        return false;
      }
    }
    return true;
  }

  async listAccountObservations(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
    limit: number,
    offset: number,
  ): Promise<SyncObservationPage> {
    const transactions = [...this.transactions.values()]
      .filter(
        (transaction) =>
          transaction.networkId === scope.networkId &&
          transaction.chainId === scope.chainId &&
          transaction.blockNumber >= startBlock &&
          transaction.blockNumber <= endBlock &&
          (transaction.from === scope.accountAddress ||
            transaction.to === scope.accountAddress),
      )
      .sort((left, right) => this.compareObservation(left, right));
    const transfers = [...this.transfers.values()]
      .filter(
        (transfer) =>
          transfer.networkId === scope.networkId &&
          transfer.chainId === scope.chainId &&
          transfer.blockNumber >= startBlock &&
          transfer.blockNumber <= endBlock &&
          (transfer.from === scope.accountAddress ||
            transfer.to === scope.accountAddress),
      )
      .sort((left, right) => this.compareObservation(left, right));
    return {
      transactions: transactions.slice(offset, offset + limit),
      transfers: transfers.slice(offset, offset + limit),
      hasMore:
        transactions.length > offset + limit ||
        transfers.length > offset + limit,
    };
  }

  async listReconciliation(
    scope: SyncScope,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<readonly ReconciliationRecord[]> {
    return [...this.reconciliation.values()].filter(
      (record) =>
        record.networkId === scope.networkId &&
        record.chainId === scope.chainId &&
        record.accountAddress === scope.accountAddress &&
        (record.blockNumber === null ||
          (record.blockNumber >= startBlock && record.blockNumber <= endBlock)),
    );
  }

  async getReconciliationByIdentity(
    scope: SyncScope,
    identity: string,
  ): Promise<ReconciliationRecord | null> {
    return (
      this.reconciliation.get(`${this.scopeKey(scope)}:${identity}`) ?? null
    );
  }

  async getReconciliationByLocalActivity(
    scope: SyncScope,
    localActivityId: string,
  ): Promise<ReconciliationRecord | null> {
    return (
      [...this.reconciliation.values()].find(
        (record) =>
          record.networkId === scope.networkId &&
          record.chainId === scope.chainId &&
          record.accountAddress === scope.accountAddress &&
          record.localActivityId === localActivityId,
      ) ?? null
    );
  }

  async findIndexedTransaction(
    scope: SyncScope,
    transactionHash: string,
  ): Promise<IndexedTransaction | null> {
    const transaction = this.transactions.get(
      `${scope.networkId}:${scope.chainId}:${transactionHash}`,
    );
    if (
      !transaction ||
      (transaction.from !== scope.accountAddress &&
        transaction.to !== scope.accountAddress)
    ) {
      return null;
    }
    return transaction;
  }

  async persistSynchronization(
    scope: SyncScope,
    endBlock: bigint,
    records: readonly ReconciliationRecord[],
  ): Promise<void> {
    for (const record of records) {
      const key = `${this.scopeKey(scope)}:${record.identity}`;
      const existing = this.reconciliation.get(key);
      this.reconciliation.set(
        key,
        existing ? mergeRecord(existing, record) : record,
      );
    }
    const now = new Date();
    this.states.set(this.scopeKey(scope), {
      networkId: scope.networkId,
      chainId: scope.chainId,
      accountAddress: scope.accountAddress,
      lastSynchronizedBlock: endBlock,
      lastSynchronizedAt: now,
      status: "completed",
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    });
  }

  async persistReconciliation(record: ReconciliationRecord): Promise<void> {
    const key = `${this.scopeKey(record)}:${record.identity}`;
    const existing = this.reconciliation.get(key);
    this.reconciliation.set(
      key,
      existing ? mergeRecord(existing, record) : record,
    );
  }

  async replaceReconciliation(
    scope: SyncScope,
    previousIdentity: string,
    record: ReconciliationRecord,
  ): Promise<void> {
    this.reconciliation.delete(`${this.scopeKey(scope)}:${previousIdentity}`);
    await this.persistReconciliation(record);
  }

  async markStatus(
    scope: SyncScope,
    update: {
      readonly status: AccountSyncStatus;
      readonly lastSynchronizedBlock?: bigint | null;
      readonly lastSynchronizedAt?: Date | null;
      readonly lastErrorCode?: SynchronizationErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    const current = await this.getState(scope);
    const now = new Date();
    this.states.set(this.scopeKey(scope), {
      networkId: scope.networkId,
      chainId: scope.chainId,
      accountAddress: scope.accountAddress,
      lastSynchronizedBlock:
        update.lastSynchronizedBlock ?? current?.lastSynchronizedBlock ?? null,
      lastSynchronizedAt:
        update.lastSynchronizedAt ?? current?.lastSynchronizedAt ?? null,
      status: update.status,
      lastErrorCode:
        update.lastErrorCode === undefined
          ? current?.lastErrorCode ?? null
          : update.lastErrorCode,
      lastErrorMessage:
        update.lastErrorMessage === undefined
          ? current?.lastErrorMessage ?? null
          : update.lastErrorMessage,
      updatedAt: now,
    });
  }

  private scopeKey(scope: SyncScope): string {
    return `${scope.networkId}:${scope.chainId}:${scope.accountAddress}`;
  }

  private compareObservation(
    left: { blockNumber: bigint; transactionIndex?: number; logIndex?: number },
    right: { blockNumber: bigint; transactionIndex?: number; logIndex?: number },
  ): number {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber > right.blockNumber ? -1 : 1;
    }
    const leftIndex = left.logIndex ?? left.transactionIndex ?? 0;
    const rightIndex = right.logIndex ?? right.transactionIndex ?? 0;
    return rightIndex - leftIndex;
  }
}

function mergeRecord(
  existing: ReconciliationRecord,
  incoming: ReconciliationRecord,
): ReconciliationRecord {
  const preserveTerminal =
    (existing.state === "confirmed" || existing.state === "reverted") &&
    incoming.state !== "confirmed" &&
    incoming.state !== "reverted";
  const state =
    existing.state === "conflict"
      ? "conflict"
      : preserveTerminal
        ? existing.state
        : incoming.state;
  return {
    ...existing,
    ...incoming,
    state,
    localActivityId: incoming.localActivityId ?? existing.localActivityId,
    updatedAt: incoming.updatedAt,
  };
}

export function createSynchronizationRepository(
  config: ServerConfig,
): SynchronizationRepository {
  return config.databaseUrl
    ? new PostgresSynchronizationRepository()
    : new EmptySynchronizationRepository();
}