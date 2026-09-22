import { sql } from "drizzle-orm";
import {
  bigint as pgBigInt,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const indexingStatusEnum = pgEnum("indexing_status", [
  "disabled",
  "idle",
  "running",
  "completed",
  "failed",
  "reorg_detected",
]);

export const indexedTransactionStatusEnum = pgEnum(
  "indexed_transaction_status",
  ["success", "reverted", "unknown"],
);

export const indexerStateTable = pgTable("indexer_state", {
  networkId: varchar("network_id", { length: 64 }).primaryKey(),
  chainId: integer("chain_id").notNull(),
  lastSuccessfulBlock: pgBigInt("last_successful_block", {
    mode: "bigint",
  }),
  latestObservedBlock: pgBigInt("latest_observed_block", {
    mode: "bigint",
  }),
  status: indexingStatusEnum("status").notNull(),
  lastSuccessfulRun: timestamp("last_successful_run", {
    withTimezone: true,
  }),
  lastErrorCode: varchar("last_error_code", { length: 64 }),
  lastErrorMessage: varchar("last_error_message", { length: 512 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const indexedBlocksTable = pgTable(
  "indexed_blocks",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    blockNumber: pgBigInt("block_number", { mode: "bigint" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    parentHash: varchar("parent_hash", { length: 66 }).notNull(),
    timestamp: pgBigInt("timestamp", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("indexed_blocks_identity_idx").on(
      table.networkId,
      table.blockNumber,
    ),
    uniqueIndex("indexed_blocks_hash_idx").on(
      table.networkId,
      table.blockHash,
    ),
    check(
      "indexed_blocks_number_nonnegative",
      sql`${table.blockNumber} >= 0`,
    ),
  ],
);

export const indexedTransactionsTable = pgTable(
  "indexed_transactions",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    blockNumber: pgBigInt("block_number", { mode: "bigint" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    from: varchar("from_address", { length: 42 }).notNull(),
    to: varchar("to_address", { length: 42 }),
    value: varchar("value", { length: 80 }).notNull(),
    gas: varchar("gas", { length: 80 }).notNull(),
    gasPrice: varchar("gas_price", { length: 80 }),
    maxFeePerGas: varchar("max_fee_per_gas", { length: 80 }),
    maxPriorityFeePerGas: varchar("max_priority_fee_per_gas", {
      length: 80,
    }),
    nonce: varchar("nonce", { length: 80 }).notNull(),
    input: varchar("input", { length: 262_146 }).notNull(),
    transactionType: varchar("transaction_type", { length: 32 }),
    timestamp: pgBigInt("timestamp", { mode: "bigint" }).notNull(),
    status: indexedTransactionStatusEnum("status").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("indexed_transactions_identity_idx").on(
      table.networkId,
      table.transactionHash,
    ),
    check(
      "indexed_transactions_index_nonnegative",
      sql`${table.transactionIndex} >= 0`,
    ),
  ],
);

export const indexedLogsTable = pgTable(
  "indexed_logs",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    blockNumber: pgBigInt("block_number", { mode: "bigint" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    topics: jsonb("topics").$type<readonly string[]>().notNull(),
    data: varchar("data", { length: 262_146 }).notNull(),
    timestamp: pgBigInt("timestamp", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("indexed_logs_identity_idx").on(
      table.networkId,
      table.transactionHash,
      table.logIndex,
    ),
    check(
      "indexed_logs_index_nonnegative",
      sql`${table.logIndex} >= 0 and ${table.transactionIndex} >= 0`,
    ),
  ],
);

export const indexedTokenTransfersTable = pgTable(
  "indexed_token_transfers",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    tokenContractAddress: varchar("token_contract_address", {
      length: 42,
    }).notNull(),
    from: varchar("from_address", { length: 42 }).notNull(),
    to: varchar("to_address", { length: 42 }).notNull(),
    amountRaw: varchar("amount_raw", { length: 80 }).notNull(),
    blockNumber: pgBigInt("block_number", { mode: "bigint" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    timestamp: pgBigInt("timestamp", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("indexed_token_transfers_identity_idx").on(
      table.networkId,
      table.transactionHash,
      table.logIndex,
    ),
    check(
      "indexed_token_transfers_log_index_nonnegative",
      sql`${table.logIndex} >= 0`,
    ),
  ],
);