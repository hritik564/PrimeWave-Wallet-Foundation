import { and, eq } from "drizzle-orm";
import {
  indexedBlocksTable,
  indexedLogsTable,
  indexedTokenTransfersTable,
  indexedTransactionsTable,
  indexerStateTable,
} from "@workspace/db/schema";
import type { ServerConfig } from "../config";
import { IndexingError } from "./errors";
import type {
  IndexedBlock,
  IndexedLog,
  IndexedRange,
  IndexedTokenTransfer,
  IndexedTransaction,
  IndexingErrorCode,
  IndexingRepository,
  IndexingStateRecord,
} from "./types";

function stateFromRow(
  row: typeof indexerStateTable.$inferSelect,
): IndexingStateRecord {
  return {
    ...row,
    lastErrorCode: row.lastErrorCode as IndexingErrorCode | null,
  };
}

function blockFromRow(
  row: typeof indexedBlocksTable.$inferSelect,
): IndexedBlock {
  return row;
}

export class EmptyIndexerRepository implements IndexingRepository {
  async getState(): Promise<IndexingStateRecord | null> {
    return null;
  }

  async listStates(): Promise<readonly IndexingStateRecord[]> {
    return [];
  }

  async getBlock(): Promise<IndexedBlock | null> {
    return null;
  }

  async persistRange(): Promise<void> {
    throw new IndexingError(
      "PERSISTENCE_FAILURE",
      "Indexer persistence is not configured.",
    );
  }

  async markStatus(): Promise<void> {
    throw new IndexingError(
      "PERSISTENCE_FAILURE",
      "Indexer persistence is not configured.",
    );
  }
}

export class PostgresIndexerRepository implements IndexingRepository {
  private async database() {
    return import("@workspace/db").then(({ db }) => db);
  }

  async getState(networkId: string): Promise<IndexingStateRecord | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(indexerStateTable)
      .where(eq(indexerStateTable.networkId, networkId))
      .limit(1);
    return rows[0] ? stateFromRow(rows[0]) : null;
  }

  async listStates(): Promise<readonly IndexingStateRecord[]> {
    const db = await this.database();
    const rows = await db.select().from(indexerStateTable);
    return rows.map(stateFromRow);
  }

  async getBlock(
    networkId: string,
    blockNumber: bigint,
  ): Promise<IndexedBlock | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(indexedBlocksTable)
      .where(
        and(
          eq(indexedBlocksTable.networkId, networkId),
          eq(indexedBlocksTable.blockNumber, blockNumber),
        ),
      )
      .limit(1);
    return rows[0] ? blockFromRow(rows[0]) : null;
  }

  async persistRange(
    range: IndexedRange,
    latestObservedBlock: bigint,
  ): Promise<void> {
    const db = await this.database();
    const now = new Date();
    await db.transaction(async (tx) => {
      if (range.blocks.length > 0) {
        await tx
          .insert(indexedBlocksTable)
          .values([...range.blocks])
          .onConflictDoNothing({
            target: [indexedBlocksTable.networkId, indexedBlocksTable.blockNumber],
          });
      }
      if (range.transactions.length > 0) {
        await tx
          .insert(indexedTransactionsTable)
          .values([...range.transactions])
          .onConflictDoNothing({
            target: [
              indexedTransactionsTable.networkId,
              indexedTransactionsTable.transactionHash,
            ],
          });
      }
      if (range.logs.length > 0) {
        await tx
          .insert(indexedLogsTable)
          .values([...range.logs])
          .onConflictDoNothing({
            target: [
              indexedLogsTable.networkId,
              indexedLogsTable.transactionHash,
              indexedLogsTable.logIndex,
            ],
          });
      }
      if (range.transfers.length > 0) {
        await tx
          .insert(indexedTokenTransfersTable)
          .values([...range.transfers])
          .onConflictDoNothing({
            target: [
              indexedTokenTransfersTable.networkId,
              indexedTokenTransfersTable.transactionHash,
              indexedTokenTransfersTable.logIndex,
            ],
          });
      }
      await tx
        .insert(indexerStateTable)
        .values({
          networkId: range.networkId,
          chainId: range.chainId,
          lastSuccessfulBlock: range.endBlock,
          latestObservedBlock,
          status: "completed",
          lastSuccessfulRun: now,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: indexerStateTable.networkId,
          set: {
            chainId: range.chainId,
            lastSuccessfulBlock: range.endBlock,
            latestObservedBlock,
            status: "completed",
            lastSuccessfulRun: now,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          },
        });
    });
  }

  async markStatus(
    networkId: string,
    update: {
      readonly chainId: number;
      readonly status: IndexingStateRecord["status"];
      readonly latestObservedBlock?: bigint | null;
      readonly lastSuccessfulBlock?: bigint | null;
      readonly lastSuccessfulRun?: Date | null;
      readonly lastErrorCode?: IndexingErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    const db = await this.database();
    const now = new Date();
    const current = await this.getState(networkId);
    const lastSuccessfulRun =
      update.lastSuccessfulRun ??
      (current?.lastSuccessfulRun instanceof Date
        ? current.lastSuccessfulRun
        : null);
    const values = {
      networkId,
      chainId: update.chainId,
      lastSuccessfulBlock:
        update.lastSuccessfulBlock ?? current?.lastSuccessfulBlock ?? null,
      latestObservedBlock:
        update.latestObservedBlock ?? current?.latestObservedBlock ?? null,
      status: update.status,
      lastSuccessfulRun,
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
      .insert(indexerStateTable)
      .values(values)
      .onConflictDoUpdate({
        target: indexerStateTable.networkId,
        set: {
          chainId: values.chainId,
          lastSuccessfulBlock: values.lastSuccessfulBlock,
          latestObservedBlock: values.latestObservedBlock,
          status: values.status,
          lastSuccessfulRun: values.lastSuccessfulRun,
          lastErrorCode: values.lastErrorCode,
          lastErrorMessage: values.lastErrorMessage,
          updatedAt: now,
        },
      });
  }
}

export class InMemoryIndexerRepository implements IndexingRepository {
  private readonly states = new Map<string, IndexingStateRecord>();
  private readonly blocks = new Map<string, IndexedBlock>();
  private readonly transactions = new Map<string, IndexedTransaction>();
  private readonly logs = new Map<string, IndexedLog>();
  private readonly transfers = new Map<string, IndexedTokenTransfer>();

  async getState(networkId: string): Promise<IndexingStateRecord | null> {
    return this.states.get(networkId) ?? null;
  }

  async listStates(): Promise<readonly IndexingStateRecord[]> {
    return [...this.states.values()];
  }

  async getBlock(
    networkId: string,
    blockNumber: bigint,
  ): Promise<IndexedBlock | null> {
    return this.blocks.get(`${networkId}:${blockNumber}`) ?? null;
  }

  async persistRange(
    range: IndexedRange,
    latestObservedBlock: bigint,
  ): Promise<void> {
    for (const block of range.blocks) {
      const key = `${block.networkId}:${block.blockNumber}`;
      const existing = this.blocks.get(key);
      if (existing && existing.blockHash !== block.blockHash) {
        throw new IndexingError(
          "REORG_DETECTED",
          "A stored block identity differs from the observed block.",
        );
      }
      this.blocks.set(key, existing ?? block);
    }
    for (const transaction of range.transactions) {
      this.transactions.set(
        `${transaction.networkId}:${transaction.transactionHash}`,
        transaction,
      );
    }
    for (const log of range.logs) {
      this.logs.set(
        `${log.networkId}:${log.transactionHash}:${log.logIndex}`,
        log,
      );
    }
    for (const transfer of range.transfers) {
      this.transfers.set(
        `${transfer.networkId}:${transfer.transactionHash}:${transfer.logIndex}`,
        transfer,
      );
    }
    const now = new Date();
    this.states.set(range.networkId, {
      networkId: range.networkId,
      chainId: range.chainId,
      lastSuccessfulBlock: range.endBlock,
      latestObservedBlock,
      status: "completed",
      lastSuccessfulRun: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    });
  }

  async markStatus(
    networkId: string,
    update: {
      readonly chainId: number;
      readonly status: IndexingStateRecord["status"];
      readonly latestObservedBlock?: bigint | null;
      readonly lastSuccessfulBlock?: bigint | null;
      readonly lastSuccessfulRun?: Date | null;
      readonly lastErrorCode?: IndexingErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    const current = this.states.get(networkId);
    const now = new Date();
    this.states.set(networkId, {
      networkId,
      chainId: update.chainId,
      lastSuccessfulBlock:
        update.lastSuccessfulBlock ?? current?.lastSuccessfulBlock ?? null,
      latestObservedBlock:
        update.latestObservedBlock ?? current?.latestObservedBlock ?? null,
      status: update.status,
      lastSuccessfulRun:
        update.lastSuccessfulRun ?? current?.lastSuccessfulRun ?? null,
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
}

export function createIndexerRepository(config: ServerConfig): IndexingRepository {
  return config.databaseUrl
    ? new PostgresIndexerRepository()
    : new EmptyIndexerRepository();
}