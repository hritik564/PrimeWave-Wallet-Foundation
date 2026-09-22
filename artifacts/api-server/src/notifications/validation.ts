import { z } from "zod";
import { parseMarketAssetDescriptor } from "../market/validation";
import { NotificationError } from "./errors";
import type {
  NotificationEventType,
  NotificationEnvironment,
  NotificationPlatform,
  NotificationScope,
} from "./types";

const NETWORK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]{0,79})$/;

export const notificationScopeSchema = z.object({
  networkId: z.string().trim().regex(NETWORK_ID_PATTERN),
  chainId: z.number().int().positive().max(2_147_483_647),
  accountAddress: z
    .string()
    .trim()
    .regex(EVM_ADDRESS_PATTERN)
    .transform((value) => value.toLowerCase()),
});

export const notificationDeviceBodySchema = notificationScopeSchema.extend({
  deviceIdentifier: z.string().trim().min(1).max(128),
  platform: z.enum(["ios", "android", "web"]),
  pushToken: z.string().trim().min(1).max(512),
  appVersion: z.string().trim().min(1).max(64),
  environment: z.enum(["development", "testnet", "mainnet"]),
});

export const notificationRegistrationParamsSchema = z.object({
  registrationId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/),
});

export const notificationPreferencesSchema = z.object({
  transactionConfirmations: z.boolean(),
  incomingTransactions: z.boolean(),
  transactionFailures: z.boolean(),
  swaps: z.boolean(),
  securityEvents: z.boolean(),
});

export const notificationEventSchema = notificationScopeSchema.extend({
  notificationEventId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  eventType: z.enum([
    "transaction_confirmed",
    "transaction_reverted",
    "incoming_transaction",
    "swap_completed",
    "security_event",
  ]),
  transactionHash: z.string().regex(HASH_PATTERN).nullable().optional(),
  logIndex: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  assetDescriptor: z.string().trim().max(256).nullable().optional(),
  amountRaw: z.string().regex(DECIMAL_INTEGER_PATTERN).nullable().optional(),
  counterpartyAddress: z
    .string()
    .regex(EVM_ADDRESS_PATTERN)
    .transform((value) => value.toLowerCase())
    .nullable()
    .optional(),
  eventTimestamp: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1).max(64),
  deduplicationKey: z.string().trim().min(1).max(256).optional(),
});

export type NotificationDeviceBody = z.infer<
  typeof notificationDeviceBodySchema
>;
export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesSchema
>;
export type NotificationEventInput = z.infer<typeof notificationEventSchema>;

export function normalizeNotificationScope(
  input: z.input<typeof notificationScopeSchema>,
): NotificationScope {
  const parsed = notificationScopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new NotificationError("INVALID_SCOPE", "The notification scope is invalid.");
  }
  return parsed.data;
}

export function normalizeNotificationEvent(
  input: NotificationEventInput,
) {
  const parsed = notificationEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new NotificationError("INVALID_EVENT", "The notification event is invalid.");
  }
  const event = parsed.data;
  let asset = null;
  if (event.assetDescriptor) {
    try {
      asset = parseMarketAssetDescriptor(event.assetDescriptor);
    } catch {
      throw new NotificationError(
        "INVALID_EVENT",
        "The notification asset identity is invalid.",
      );
    }
    if (asset.networkId !== event.networkId) {
      throw new NotificationError(
        "INVALID_EVENT",
        "The notification asset network does not match the event scope.",
      );
    }
  }

  const transactionHash = event.transactionHash ?? null;
  if (
    event.eventType !== "security_event" &&
    transactionHash === null
  ) {
    throw new NotificationError(
      "INVALID_EVENT",
      "Transaction notification events require a transaction hash.",
    );
  }
  if (event.eventType === "security_event" && event.deduplicationKey === undefined) {
    throw new NotificationError(
      "INVALID_EVENT",
      "Security events require an explicit deduplication key.",
    );
  }
  if (event.eventType !== "incoming_transaction" && event.logIndex !== undefined) {
    throw new NotificationError(
      "INVALID_EVENT",
      "Log indexes are only valid for incoming transaction events.",
    );
  }

  const deduplicationKey =
    transactionHash === null
      ? `${event.networkId}:${event.accountAddress}:${event.eventType}:${event.deduplicationKey}`
      : `${event.networkId}:${transactionHash.toLowerCase()}:${event.eventType}:${event.accountAddress}${
          event.logIndex === undefined || event.logIndex === null
            ? ""
            : `:${event.logIndex}`
        }`;

  return {
    ...event,
    accountAddress: event.accountAddress,
    transactionHash,
    logIndex: event.logIndex ?? null,
    asset,
    amountRaw: event.amountRaw ?? null,
    counterpartyAddress: event.counterpartyAddress ?? null,
    eventTimestamp: new Date(event.eventTimestamp),
    deduplicationKey,
  };
}

export function preferenceForEventType(
  eventType: NotificationEventType,
): keyof Omit<NotificationPreferencesInput, never> {
  switch (eventType) {
    case "transaction_confirmed":
      return "transactionConfirmations";
    case "incoming_transaction":
      return "incomingTransactions";
    case "transaction_reverted":
      return "transactionFailures";
    case "swap_completed":
      return "swaps";
    case "security_event":
      return "securityEvents";
  }
}

export function publicDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isNotificationPlatform(value: string): value is NotificationPlatform {
  return ["ios", "android", "web"].includes(value);
}

export function isNotificationEnvironment(
  value: string,
): value is NotificationEnvironment {
  return ["development", "testnet", "mainnet"].includes(value);
}