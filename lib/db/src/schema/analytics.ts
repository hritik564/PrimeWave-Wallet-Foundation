import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  index,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    eventId: varchar("event_id", { length: 128 }).primaryKey(),
    eventName: varchar("event_name", { length: 64 }).notNull(),
    eventVersion: integer("event_version").notNull(),
    anonymousId: varchar("anonymous_id", { length: 128 }).notNull(),
    identityScope: varchar("identity_scope", { length: 16 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    environment: varchar("environment", { length: 16 }).notNull(),
    properties: jsonb("properties").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("analytics_events_expiry_idx").on(table.expiresAt),
    check(
      "analytics_events_version_positive",
      sql`${table.eventVersion} > 0`,
    ),
    check(
      "analytics_events_properties_size",
      sql`octet_length(${table.properties}::text) <= 16384`,
    ),
  ],
);

export const analyticsErrorsTable = pgTable(
  "analytics_errors",
  {
    telemetryId: varchar("telemetry_id", { length: 128 }).primaryKey(),
    errorCategory: varchar("error_category", { length: 64 }).notNull(),
    errorCode: varchar("error_code", { length: 64 }).notNull(),
    area: varchar("area", { length: 64 }).notNull(),
    operation: varchar("operation", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    environment: varchar("environment", { length: 16 }).notNull(),
    durationBucket: varchar("duration_bucket", { length: 32 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("analytics_errors_expiry_idx").on(table.expiresAt)],
);

export const analyticsPerformanceTable = pgTable(
  "analytics_performance",
  {
    telemetryId: varchar("telemetry_id", { length: 128 }).primaryKey(),
    metricName: varchar("metric_name", { length: 64 }).notNull(),
    valueBucket: varchar("value_bucket", { length: 32 }).notNull(),
    area: varchar("area", { length: 64 }).notNull(),
    operation: varchar("operation", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    environment: varchar("environment", { length: 16 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("analytics_performance_expiry_idx").on(table.expiresAt),
  ],
);