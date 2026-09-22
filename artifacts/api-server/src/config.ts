import { z } from "zod";
import { createPublicNetworkCatalog } from "./metadata/catalog";
import type { IndexerConfig } from "./indexing/types";
import type { MarketPriceConfig } from "./market/types";
import type { NotificationConfig } from "./notifications/types";

export type ServerEnvironment = "development" | "test" | "production";

export interface ServerConfig {
  readonly environment: ServerEnvironment;
  readonly port: number;
  readonly apiPrefix: string;
  readonly apiVersion: string;
  readonly corsAllowedOrigins: readonly string[];
  readonly databaseUrl: string | null;
  readonly sepoliaRpcConfigured: boolean;
  readonly indexer: IndexerConfig;
  readonly market: MarketPriceConfig;
  readonly notifications: NotificationConfig;
  readonly requestBodyLimit: string;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMaxRequests: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const environmentSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseOrigins(value: string | undefined, environment: ServerEnvironment) {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes("*") && environment === "production") {
    throw new ConfigurationError(
      "CORS_ALLOWED_ORIGINS cannot use a wildcard in production.",
    );
  }

  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new ConfigurationError(
        "CORS_ALLOWED_ORIGINS contains an invalid origin.",
      );
    }
  }

  return Object.freeze(origins);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError("Boolean configuration value is invalid.");
}

function createMarketPriceConfig(
  environment: NodeJS.ProcessEnv,
): MarketPriceConfig {
  const maxBatchSize = parsePositiveInteger(
    environment.MARKET_PRICE_MAX_BATCH_SIZE,
    25,
    "MARKET_PRICE_MAX_BATCH_SIZE",
  );
  const maxAssets = parsePositiveInteger(
    environment.MARKET_PRICE_MAX_ASSETS,
    50,
    "MARKET_PRICE_MAX_ASSETS",
  );
  if (maxBatchSize > maxAssets) {
    throw new ConfigurationError(
      "MARKET_PRICE_MAX_BATCH_SIZE cannot exceed MARKET_PRICE_MAX_ASSETS.",
    );
  }
  const maxDecimalPlaces = parsePositiveInteger(
    environment.MARKET_PRICE_MAX_DECIMAL_PLACES,
    36,
    "MARKET_PRICE_MAX_DECIMAL_PLACES",
  );
  return {
    enabled: parseBoolean(environment.MARKET_PRICE_ENABLED, true),
    maxAssets,
    maxBatchSize,
    freshnessMaxAgeMs: parsePositiveInteger(
      environment.MARKET_PRICE_FRESHNESS_MAX_AGE_MS,
      300_000,
      "MARKET_PRICE_FRESHNESS_MAX_AGE_MS",
    ),
    maxTimestampFutureSkewMs: parsePositiveInteger(
      environment.MARKET_PRICE_MAX_FUTURE_SKEW_MS,
      300_000,
      "MARKET_PRICE_MAX_FUTURE_SKEW_MS",
    ),
    maxDecimalPlaces,
    supportedQuoteCurrencies: Object.freeze(["USD"]),
  };
}

function createNotificationConfig(
  environment: NodeJS.ProcessEnv,
): NotificationConfig {
  return {
    enabled: parseBoolean(environment.NOTIFICATIONS_ENABLED, true),
    maxDevicesPerScope: parsePositiveInteger(
      environment.NOTIFICATIONS_MAX_DEVICES_PER_SCOPE,
      10,
      "NOTIFICATIONS_MAX_DEVICES_PER_SCOPE",
    ),
    maxPendingDeliveries: parsePositiveInteger(
      environment.NOTIFICATIONS_MAX_PENDING_DELIVERIES,
      100,
      "NOTIFICATIONS_MAX_PENDING_DELIVERIES",
    ),
    maxAttempts: parsePositiveInteger(
      environment.NOTIFICATIONS_MAX_ATTEMPTS,
      3,
      "NOTIFICATIONS_MAX_ATTEMPTS",
    ),
    maxBackoffMs: parsePositiveInteger(
      environment.NOTIFICATIONS_MAX_BACKOFF_MS,
      300_000,
      "NOTIFICATIONS_MAX_BACKOFF_MS",
    ),
    deliveryRetentionMs: parsePositiveInteger(
      environment.NOTIFICATIONS_DELIVERY_RETENTION_MS,
      30 * 24 * 60 * 60 * 1_000,
      "NOTIFICATIONS_DELIVERY_RETENTION_MS",
    ),
  };
}

function parseIndexerRpcUrl(
  value: string | undefined,
  environment: ServerEnvironment,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigurationError("Indexer RPC URL is invalid.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ConfigurationError(
      "Indexer RPC URLs must not contain credentials, query parameters, or fragments.",
    );
  }
  const localDevelopment =
    environment === "development" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new ConfigurationError(
      "Indexer RPC URLs must use HTTPS outside local development.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function indexerEnvironmentKey(networkId: string): string {
  return `INDEXER_${networkId.replace(/-/g, "_").toUpperCase()}_RPC_URL`;
}

function createIndexerConfig(
  environment: ServerEnvironment,
  env: NodeJS.ProcessEnv,
  sepoliaRpcConfigured: boolean,
): IndexerConfig {
  const catalog = createPublicNetworkCatalog({ sepoliaRpcConfigured });
  const enabled = parseBoolean(env.INDEXER_ENABLED, true);
  const networks = catalog
    .filter(
      (network): network is typeof network & { chainId: number } =>
        network.chainId !== null,
    )
    .map((network) => {
      const configuredValue =
        env[indexerEnvironmentKey(network.networkId)] ??
        (network.networkId === "ethereum-sepolia"
          ? env.SEPOLIA_RPC_URL
          : undefined);
      const rpcUrl = parseIndexerRpcUrl(configuredValue, environment);
      return {
        networkId: network.networkId,
        chainId: network.chainId,
        environment: network.environment,
        enabled: enabled && rpcUrl !== null,
        rpcUrl,
      };
    });
  return {
    enabled,
    rpcTimeoutMs: parsePositiveInteger(
      env.INDEXER_RPC_TIMEOUT_MS,
      10_000,
      "INDEXER_RPC_TIMEOUT_MS",
    ),
    networks,
    bounds: {
      maxBlockRange: parsePositiveInteger(
        env.INDEXER_MAX_BLOCK_RANGE,
        100,
        "INDEXER_MAX_BLOCK_RANGE",
      ),
      maxLogRange: parsePositiveInteger(
        env.INDEXER_MAX_LOG_RANGE,
        100,
        "INDEXER_MAX_LOG_RANGE",
      ),
      maxLogsPerRequest: parsePositiveInteger(
        env.INDEXER_MAX_LOGS_PER_REQUEST,
        1_000,
        "INDEXER_MAX_LOGS_PER_REQUEST",
      ),
      maxTransactionsPerBlock: parsePositiveInteger(
        env.INDEXER_MAX_TRANSACTIONS_PER_BLOCK,
        100,
        "INDEXER_MAX_TRANSACTIONS_PER_BLOCK",
      ),
      maxCalldataBytes: parsePositiveInteger(
        env.INDEXER_MAX_CALLDATA_BYTES,
        131_072,
        "INDEXER_MAX_CALLDATA_BYTES",
      ),
      maxTopicsPerLog: parsePositiveInteger(
        env.INDEXER_MAX_TOPICS_PER_LOG,
        4,
        "INDEXER_MAX_TOPICS_PER_LOG",
      ),
      maxErrorLength: parsePositiveInteger(
        env.INDEXER_MAX_ERROR_LENGTH,
        512,
        "INDEXER_MAX_ERROR_LENGTH",
      ),
    },
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const parsedEnvironment = environmentSchema.safeParse(
    environment.NODE_ENV ?? "development",
  );
  if (!parsedEnvironment.success) {
    throw new ConfigurationError(
      "NODE_ENV must be development, test, or production.",
    );
  }
  const currentEnvironment = parsedEnvironment.data;
  const logLevel = logLevelSchema.safeParse(environment.LOG_LEVEL ?? "info");
  if (!logLevel.success) {
    throw new ConfigurationError("LOG_LEVEL is invalid.");
  }

  const databaseUrl = environment.DATABASE_URL?.trim() || null;
  if (currentEnvironment === "production" && !databaseUrl) {
    throw new ConfigurationError(
      "DATABASE_URL is required in production configuration.",
    );
  }
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new ConfigurationError("DATABASE_URL must be a PostgreSQL URL.");
    }
  }

  const port = parsePositiveInteger(environment.PORT, 5000, "PORT");
  const rateLimitWindowMs = parsePositiveInteger(
    environment.RATE_LIMIT_WINDOW_MS,
    60_000,
    "RATE_LIMIT_WINDOW_MS",
  );
  const rateLimitMaxRequests = parsePositiveInteger(
    environment.RATE_LIMIT_MAX_REQUESTS,
    120,
    "RATE_LIMIT_MAX_REQUESTS",
  );

  const sepoliaRpcConfigured = Boolean(environment.SEPOLIA_RPC_URL?.trim());
  return Object.freeze({
    environment: currentEnvironment,
    port,
    apiPrefix: "/api/v1",
    apiVersion: "v1",
    corsAllowedOrigins: parseOrigins(
      environment.CORS_ALLOWED_ORIGINS,
      currentEnvironment,
    ),
    databaseUrl,
    sepoliaRpcConfigured,
    indexer: createIndexerConfig(
      currentEnvironment,
      environment,
      sepoliaRpcConfigured,
    ),
    market: createMarketPriceConfig(environment),
    notifications: createNotificationConfig(environment),
    requestBodyLimit: environment.REQUEST_BODY_LIMIT ?? "64kb",
    rateLimitWindowMs,
    rateLimitMaxRequests,
    logLevel: logLevel.data,
  });
}