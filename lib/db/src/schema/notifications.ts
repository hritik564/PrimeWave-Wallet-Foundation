import { sql } from "drizzle-orm";
import {
  boolean,
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

export const notificationPlatformEnum = pgEnum("notification_platform", [
  "ios",
  "android",
  "web",
]);

export const notificationEnvironmentEnum = pgEnum(
  "notification_environment",
  ["development", "testnet", "mainnet"],
);

export const notificationEventTypeEnum = pgEnum("notification_event_type", [
  "transaction_confirmed",
  "transaction_reverted",
  "incoming_transaction",
  "swap_completed",
  "security_event",
]);

export const notificationDeliveryStateEnum = pgEnum(
  "notification_delivery_state",
  ["pending", "sending", "sent", "delivered", "failed", "disabled", "expired"],
);

export const notificationDevicesTable = pgTable(
  "notification_devices",
  {
    registrationId: varchar("registration_id", { length: 128 }).primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    accountAddress: varchar("account_address", { length: 42 }).notNull(),
    deviceIdentifier: varchar("device_identifier", { length: 128 }).notNull(),
    platform: notificationPlatformEnum("platform").notNull(),
    pushToken: varchar("push_token", { length: 512 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    environment: notificationEnvironmentEnum("environment").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_devices_scope_identifier_idx").on(
      table.networkId,
      table.chainId,
      table.accountAddress,
      table.deviceIdentifier,
    ),
    check(
      "notification_devices_chain_id_positive",
      sql`${table.chainId} > 0`,
    ),
  ],
);

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    accountAddress: varchar("account_address", { length: 42 }).notNull(),
    transactionConfirmations: boolean("transaction_confirmations")
      .notNull()
      .default(false),
    incomingTransactions: boolean("incoming_transactions")
      .notNull()
      .default(false),
    transactionFailures: boolean("transaction_failures")
      .notNull()
      .default(false),
    swaps: boolean("swaps").notNull().default(false),
    securityEvents: boolean("security_events").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_preferences_scope_idx").on(
      table.networkId,
      table.chainId,
      table.accountAddress,
    ),
    check(
      "notification_preferences_chain_id_positive",
      sql`${table.chainId} > 0`,
    ),
  ],
);

export const notificationEventsTable = pgTable(
  "notification_events",
  {
    notificationEventId: varchar("notification_event_id", {
      length: 128,
    }).primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    accountAddress: varchar("account_address", { length: 42 }).notNull(),
    eventType: notificationEventTypeEnum("event_type").notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    logIndex: integer("log_index"),
    assetDescriptor: varchar("asset_descriptor", { length: 256 }),
    amountRaw: varchar("amount_raw", { length: 80 }),
    counterpartyAddress: varchar("counterparty_address", { length: 42 }),
    eventTimestamp: timestamp("event_timestamp", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    deduplicationKey: varchar("deduplication_key", { length: 256 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_events_scope_deduplication_idx").on(
      table.networkId,
      table.chainId,
      table.accountAddress,
      table.deduplicationKey,
    ),
    check(
      "notification_events_chain_id_positive",
      sql`${table.chainId} > 0`,
    ),
    check(
      "notification_events_log_index_nonnegative",
      sql`${table.logIndex} is null or ${table.logIndex} >= 0`,
    ),
  ],
);

export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),
    notificationEventId: varchar("notification_event_id", {
      length: 128,
    }).notNull(),
    registrationId: varchar("registration_id", { length: 128 }).notNull(),
    state: notificationDeliveryStateEnum("state").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerId: varchar("provider_id", { length: 64 }),
    providerMessageId: varchar("provider_message_id", { length: 256 }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: varchar("last_error_message", { length: 512 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_event_registration_idx").on(
      table.notificationEventId,
      table.registrationId,
    ),
    check(
      "notification_deliveries_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);