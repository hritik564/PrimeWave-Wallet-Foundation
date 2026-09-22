import { sql } from "drizzle-orm";
import {
  bigint as pgBigInt,
  check,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const accountSyncStatusEnum = pgEnum("account_sync_status", [
  "idle",
  "running",
  "completed",
  "failed",
  "conflict",
]);

export const reconciliationStateEnum = pgEnum("reconciliation_state", [
  "local_only",
  "indexed",
  "matched",
  "confirmed",
  "reverted",
  "unknown",
  "conflict",
  "unresolved",
]);

export const reconciliationIdentityTypeEnum = pgEnum(
  "reconciliation_identity_type",
  ["transaction", "erc20_transfer", "local_activity"],
);

export const reconciliationEvidenceEnum = pgEnum(
  "reconciliation_match_evidence",
  ["hash", "supporting_signals", "none", "conflict"],
);

export const accountSyncStateTable = pgTable(
  "account_sync_state",
  {
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    accountAddress: varchar("account_address", { length: 42 }).notNull(),
    lastSynchronizedBlock: pgBigInt("last_synchronized_block", {
      mode: "bigint",
    }),
    lastSynchronizedAt: timestamp("last_synchronized_at", {
      withTimezone: true,
    }),
    status: accountSyncStatusEnum("status").notNull(),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: varchar("last_error_message", { length: 512 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "account_sync_state_identity",
      columns: [table.networkId, table.chainId, table.accountAddress],
    }),
    check(
      "account_sync_state_block_nonnegative",
      sql`${table.lastSynchronizedBlock} is null or ${table.lastSynchronizedBlock} >= 0`,
    ),
  ],
);

export const reconciliationRecordsTable = pgTable(
  "reconciliation_records",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    accountAddress: varchar("account_address", { length: 42 }).notNull(),
    identity: varchar("identity", { length: 180 }).notNull(),
    identityType: reconciliationIdentityTypeEnum("identity_type").notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    logIndex: integer("log_index"),
    localActivityId: varchar("local_activity_id", { length: 128 }),
    state: reconciliationStateEnum("state").notNull(),
    matchEvidence: reconciliationEvidenceEnum("match_evidence").notNull(),
    blockNumber: pgBigInt("block_number", { mode: "bigint" }),
    blockHash: varchar("block_hash", { length: 66 }),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reconciliation_scope_identity_idx").on(
      table.networkId,
      table.chainId,
      table.accountAddress,
      table.identity,
    ),
    check(
      "reconciliation_log_index_nonnegative",
      sql`${table.logIndex} is null or ${table.logIndex} >= 0`,
    ),
    check(
      "reconciliation_block_nonnegative",
      sql`${table.blockNumber} is null or ${table.blockNumber} >= 0`,
    ),
  ],
);