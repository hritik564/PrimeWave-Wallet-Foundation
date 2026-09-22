import { z } from "zod";

export type ServerEnvironment = "development" | "test" | "production";

export interface ServerConfig {
  readonly environment: ServerEnvironment;
  readonly port: number;
  readonly apiPrefix: string;
  readonly apiVersion: string;
  readonly corsAllowedOrigins: readonly string[];
  readonly databaseUrl: string | null;
  readonly sepoliaRpcConfigured: boolean;
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
    sepoliaRpcConfigured: Boolean(environment.SEPOLIA_RPC_URL?.trim()),
    requestBodyLimit: environment.REQUEST_BODY_LIMIT ?? "64kb",
    rateLimitWindowMs,
    rateLimitMaxRequests,
    logLevel: logLevel.data,
  });
}