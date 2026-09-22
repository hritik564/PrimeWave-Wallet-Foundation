import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AnalyticsRequestError } from "./errors";
import type {
  AnalyticsEnvironment,
  AnalyticsErrorRecord,
  AnalyticsEventRecord,
  AnalyticsIdentityScope,
  AnalyticsPerformanceRecord,
  AnalyticsPlatform,
} from "./types";

const category = (values: readonly [string, ...string[]]) =>
  z.enum(values);

const emptyProperties = z.object({}).strict();
const screenProperties = z
  .object({
    screenCategory: category([
      "home",
      "activity",
      "asset",
      "receive",
      "send",
      "transaction_review",
      "swap_review",
      "swap_execution",
      "dapp_connection",
      "dapp_sessions",
      "settings",
      "onboarding",
    ]),
  })
  .strict();
const transactionProperties = z
  .object({
    transactionTypeCategory: category([
      "native_transfer",
      "token_transfer",
      "contract_interaction",
    ]),
    networkCategory: category(["mainnet", "testnet", "development"]),
  })
  .strict();
const transactionCompletedProperties = transactionProperties
  .extend({
    outcomeCategory: category(["success", "failure", "unknown"]),
    durationBucket: category(["under_1s", "1_5s", "5_30s", "over_30s"]),
  })
  .strict();
const swapProperties = z
  .object({
    networkCategory: category(["mainnet", "testnet", "development"]),
    providerCategory: category(["aggregator", "router", "unconfigured"]),
  })
  .strict();
const swapCompletedProperties = swapProperties
  .extend({
    outcomeCategory: category(["success", "failure", "unknown"]),
    durationBucket: category(["under_1s", "1_5s", "5_30s", "over_30s"]),
  })
  .strict();
const dappProperties = z
  .object({
    dappCategory: category(["defi", "gaming", "marketplace", "utility", "other"]),
  })
  .strict();

const anonymousIdSchema = z
  .string()
  .trim()
  .min(28)
  .max(128)
  .regex(/^(installation|session)_[A-Za-z0-9_-]{22,96}$/);
const baseEvent = z.object({
  eventId: z
    .string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  eventVersion: z.literal(1),
  anonymousId: anonymousIdSchema,
  identityScope: z.enum(["installation", "session"]),
  timestamp: z.string().datetime({ offset: true }),
  appVersion: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._+-]+$/),
  platform: z.enum(["ios", "android", "web"]),
  environment: z.enum(["development", "testnet", "mainnet"]),
});

const eventSchemas = [
  baseEvent.extend({ eventName: z.literal("app_opened"), properties: emptyProperties }),
  baseEvent.extend({
    eventName: z.literal("onboarding_started"),
    properties: emptyProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("onboarding_completed"),
    properties: emptyProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("wallet_created_completed"),
    properties: emptyProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("wallet_import_completed"),
    properties: emptyProperties,
  }),
  baseEvent.extend({ eventName: z.literal("screen_viewed"), properties: screenProperties }),
  baseEvent.extend({
    eventName: z.literal("asset_search_used"),
    properties: z.object({}).strict(),
  }),
  baseEvent.extend({
    eventName: z.literal("receive_screen_opened"),
    properties: emptyProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("send_review_opened"),
    properties: transactionProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("transaction_reviewed"),
    properties: transactionProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("transaction_broadcast_started"),
    properties: transactionProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("transaction_completed"),
    properties: transactionCompletedProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("swap_review_opened"),
    properties: swapProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("swap_completed"),
    properties: swapCompletedProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("dapp_connection_started"),
    properties: dappProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("dapp_connection_completed"),
    properties: dappProperties,
  }),
  baseEvent.extend({
    eventName: z.literal("settings_opened"),
    properties: emptyProperties,
  }),
] as const;

export const analyticsEventSchema = z.discriminatedUnion("eventName", eventSchemas);
export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export interface AnalyticsErrorInput {
  readonly errorCategory: string;
  readonly errorCode: string;
  readonly area: string;
  readonly operation: string;
  readonly platform: AnalyticsPlatform;
  readonly appVersion: string;
  readonly environment: AnalyticsEnvironment;
  readonly durationBucket?: string | null;
  readonly timestamp?: string;
}

export interface AnalyticsPerformanceInput {
  readonly metricName: string;
  readonly valueBucket: string;
  readonly area: string;
  readonly operation: string;
  readonly platform: AnalyticsPlatform;
  readonly appVersion: string;
  readonly environment: AnalyticsEnvironment;
  readonly timestamp?: string;
}

const safeLabel = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);
const durationBucket = z
  .enum(["under_1s", "1_5s", "5_30s", "over_30s"])
  .nullable()
  .optional();
const telemetryBase = z.object({
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._+-]+$/),
  environment: z.enum(["development", "testnet", "mainnet"]),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

const prohibitedAnalyticsFields = new Set([
  "privatekey",
  "mnemonic",
  "seed",
  "seedphrase",
  "walletpin",
  "pin",
  "securestore",
  "securevault",
  "vaultkey",
  "signingkey",
  "signature",
  "rawtransaction",
  "rawcalldata",
  "calldata",
  "walletaddress",
  "transactionhash",
  "pushtoken",
  "apikey",
  "authorization",
  "cookie",
  "ip",
]);

function normalizedFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function assertNoProhibitedAnalyticsFields(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertNoProhibitedAnalyticsFields(child, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (prohibitedAnalyticsFields.has(normalizedFieldName(key))) {
      throw new AnalyticsRequestError(
        "INVALID_EVENT",
        "Analytics data contains a prohibited field.",
      );
    }
    assertNoProhibitedAnalyticsFields(child, seen);
  }
}

function safeTimestamp(timestamp: string | undefined, now: Date): Date {
  const parsed = timestamp ? new Date(timestamp) : now;
  if (!Number.isFinite(parsed.getTime())) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics timestamp is invalid.");
  }
  const futureLimit = now.getTime() + 5 * 60 * 1_000;
  if (parsed.getTime() > futureLimit) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics timestamp is invalid.");
  }
  return parsed;
}

export function normalizeAnalyticsEvent(
  input: unknown,
  now = new Date(),
  retentionMs = 90 * 24 * 60 * 60 * 1_000,
): AnalyticsEventRecord {
  assertNoProhibitedAnalyticsFields(input);
  const parsed = analyticsEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics event is invalid.");
  }
  if (
    (parsed.data.identityScope === "installation" &&
      !parsed.data.anonymousId.startsWith("installation_")) ||
    (parsed.data.identityScope === "session" &&
      !parsed.data.anonymousId.startsWith("session_"))
  ) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics identity is invalid.");
  }
  const anonymousSuffix = parsed.data.anonymousId.slice(
    parsed.data.anonymousId.indexOf("_") + 1,
  );
  if (/^0x[a-f0-9]{40,64}$/i.test(anonymousSuffix)) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics identity is invalid.");
  }
  const occurredAt = safeTimestamp(parsed.data.timestamp, now);
  return {
    eventId: parsed.data.eventId,
    eventName: parsed.data.eventName,
    eventVersion: parsed.data.eventVersion,
    anonymousId: parsed.data.anonymousId,
    identityScope: parsed.data.identityScope,
    occurredAt,
    receivedAt: now,
    appVersion: parsed.data.appVersion,
    platform: parsed.data.platform,
    environment: parsed.data.environment,
    properties: parsed.data.properties as Readonly<Record<string, string>>,
    expiresAt: new Date(now.getTime() + retentionMs),
  };
}

export function normalizeAnalyticsError(
  input: AnalyticsErrorInput,
  now = new Date(),
  retentionMs = 30 * 24 * 60 * 60 * 1_000,
): AnalyticsErrorRecord {
  const parsed = z
    .object({
      errorCategory: safeLabel,
      errorCode: safeLabel,
      area: safeLabel,
      operation: safeLabel,
      ...telemetryBase.shape,
      durationBucket,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) {
    throw new AnalyticsRequestError("INVALID_EVENT", "Analytics error telemetry is invalid.");
  }
  return {
    telemetryId: randomUUID(),
    errorCategory: parsed.data.errorCategory,
    errorCode: parsed.data.errorCode,
    area: parsed.data.area,
    operation: parsed.data.operation,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion,
    environment: parsed.data.environment,
    durationBucket: parsed.data.durationBucket ?? null,
    occurredAt: safeTimestamp(parsed.data.timestamp, now),
    receivedAt: now,
    expiresAt: new Date(now.getTime() + retentionMs),
  };
}

export function normalizeAnalyticsPerformance(
  input: AnalyticsPerformanceInput,
  now = new Date(),
  retentionMs = 30 * 24 * 60 * 60 * 1_000,
): AnalyticsPerformanceRecord {
  const parsed = z
    .object({
      metricName: safeLabel,
      valueBucket: safeLabel,
      area: safeLabel,
      operation: safeLabel,
      ...telemetryBase.shape,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) {
    throw new AnalyticsRequestError(
      "INVALID_EVENT",
      "Analytics performance telemetry is invalid.",
    );
  }
  return {
    telemetryId: randomUUID(),
    metricName: parsed.data.metricName,
    valueBucket: parsed.data.valueBucket,
    area: parsed.data.area,
    operation: parsed.data.operation,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion,
    environment: parsed.data.environment,
    occurredAt: safeTimestamp(parsed.data.timestamp, now),
    receivedAt: now,
    expiresAt: new Date(now.getTime() + retentionMs),
  };
}

export function publicIdentityScope(
  identityScope: AnalyticsIdentityScope,
): AnalyticsIdentityScope {
  return identityScope;
}