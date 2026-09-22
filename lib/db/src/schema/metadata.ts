import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const networkEnvironmentEnum = pgEnum("network_environment", [
  "development",
  "testnet",
  "mainnet",
]);

export const networkConfigurationStatusEnum = pgEnum(
  "network_configuration_status",
  ["configured", "unavailable", "placeholder"],
);

export const metadataStatusEnum = pgEnum("metadata_status", [
  "available",
  "partial",
  "invalid",
  "unavailable",
]);

export const metadataProvenanceEnum = pgEnum("metadata_provenance", [
  "verified_provider",
  "user_provided",
  "registry",
  "unavailable",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
  "rejected",
]);

export const discoveryStatusEnum = pgEnum("discovery_status", [
  "not_discovered",
  "user_declared",
  "observed",
]);

export const visibilityStatusEnum = pgEnum("visibility_status", [
  "public",
  "hidden",
]);

export const trustStatusEnum = pgEnum("trust_status", [
  "unassessed",
  "review_required",
  "not_trusted",
]);

export const freshnessStatusEnum = pgEnum("freshness_status", [
  "fresh",
  "cached",
  "stale",
  "unavailable",
]);

export const publicNetworkMetadataTable = pgTable(
  "public_network_metadata",
  {
    networkId: varchar("network_id", { length: 64 }).primaryKey(),
    chainId: integer("chain_id"),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    nativeCurrencyName: varchar("native_currency_name", { length: 80 }).notNull(),
    nativeCurrencySymbol: varchar("native_currency_symbol", { length: 24 }).notNull(),
    nativeCurrencyDecimals: integer("native_currency_decimals").notNull(),
    explorerName: varchar("explorer_name", { length: 120 }).notNull(),
    explorerBaseUrl: varchar("explorer_base_url", { length: 512 }),
    explorerAddressUrlTemplate: varchar("explorer_address_url_template", {
      length: 512,
    }),
    explorerTransactionUrlTemplate: varchar("explorer_transaction_url_template", {
      length: 512,
    }),
    environment: networkEnvironmentEnum("environment").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    configurationStatus: networkConfigurationStatusEnum(
      "configuration_status",
    ).notNull(),
    configurationNote: varchar("configuration_note", { length: 512 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "public_network_metadata_native_decimals_range",
      sql`${table.nativeCurrencyDecimals} between 0 and 36`,
    ),
  ],
);

export const publicTokenMetadataTable = pgTable(
  "public_token_metadata",
  {
    id: serial("id").primaryKey(),
    networkId: varchar("network_id", { length: 64 }).notNull(),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    name: varchar("name", { length: 120 }),
    symbol: varchar("symbol", { length: 32 }),
    decimals: integer("decimals"),
    description: varchar("description", { length: 2_000 }),
    logoReference: varchar("logo_reference", { length: 512 }),
    logoProvenance: metadataProvenanceEnum("logo_provenance").notNull(),
    metadataStatus: metadataStatusEnum("metadata_status").notNull(),
    provenance: metadataProvenanceEnum("provenance").notNull(),
    provenanceReference: varchar("provenance_reference", { length: 512 }),
    verificationStatus: verificationStatusEnum(
      "verification_status",
    ).notNull(),
    discoveryStatus: discoveryStatusEnum("discovery_status").notNull(),
    visibility: visibilityStatusEnum("visibility").notNull(),
    trustStatus: trustStatusEnum("trust_status").notNull(),
    freshnessStatus: freshnessStatusEnum("freshness_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("public_token_metadata_identity_idx").on(
      table.networkId,
      table.contractAddress,
    ),
    check(
      "public_token_metadata_contract_address_format",
      sql`${table.contractAddress} ~ '^0x[0-9a-f]{40}$'`,
    ),
    check(
      "public_token_metadata_decimals_range",
      sql`${table.decimals} is null or ${table.decimals} between 0 and 255`,
    ),
  ],
);