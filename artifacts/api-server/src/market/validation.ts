import { z } from "zod";
import { MarketError } from "./errors";
import type { MarketAssetIdentity, MarketFreshness } from "./types";

const NETWORK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const QUOTE_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_ASSET_DESCRIPTOR_LENGTH = 160;

export const marketQuoteCurrencySchema = z
  .string()
  .trim()
  .regex(QUOTE_CURRENCY_PATTERN, "Quote currency is invalid.")
  .transform((value) => value.toUpperCase());

const assetListSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) {
      return value.flatMap((entry) =>
        typeof entry === "string" ? entry.split(",") : entry,
      );
    }
    if (typeof value === "string") return value.split(",");
    return value;
  },
  z
    .array(z.string().trim().min(1).max(MAX_ASSET_DESCRIPTOR_LENGTH))
    .min(1)
    .max(100),
);

export const marketPriceQuerySchema = z
  .object({
    assets: assetListSchema,
    quoteCurrency: marketQuoteCurrencySchema.default("USD"),
  })
  .strict();

function invalidAsset(message: string): never {
  throw new MarketError("INVALID_ASSET", message);
}

export function parseMarketAssetDescriptor(
  descriptor: string,
): MarketAssetIdentity {
  const parts = descriptor.trim().split(":");
  const kind = parts[0];
  const networkId = parts[1];

  if (
    !networkId ||
    !NETWORK_ID_PATTERN.test(networkId) ||
    (kind !== "native" && kind !== "erc20")
  ) {
    return invalidAsset("The market asset identity is invalid.");
  }

  if (kind === "native" && parts.length === 2) {
    return { kind: "native", networkId, assetId: "native" };
  }

  const contractAddress = parts[2];
  if (
    kind === "erc20" &&
    parts.length === 3 &&
    contractAddress &&
    EVM_ADDRESS_PATTERN.test(contractAddress)
  ) {
    return {
      kind: "erc20",
      networkId,
      contractAddress: contractAddress.toLowerCase(),
    };
  }

  return invalidAsset("The market asset identity is invalid.");
}

export function marketAssetKey(asset: MarketAssetIdentity): string {
  return asset.kind === "native"
    ? `${asset.networkId}:native`
    : `${asset.networkId}:erc20:${asset.contractAddress}`;
}

export function normalizeProviderPrice(
  value: unknown,
  maxDecimalPlaces: number,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    throw new MarketError(
      "PROVIDER_RESPONSE_INVALID",
      "The market provider returned an invalid price.",
    );
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new MarketError(
      "PROVIDER_RESPONSE_INVALID",
      "The market provider returned an invalid price.",
    );
  }
  const decimalPlaces = value.includes(".")
    ? value.length - value.indexOf(".") - 1
    : 0;
  if (decimalPlaces > maxDecimalPlaces) {
    throw new MarketError(
      "PROVIDER_RESPONSE_INVALID",
      "The market provider returned an over-precise price.",
    );
  }
  return value;
}

export function normalizeProviderTimestamp(
  value: unknown,
  nowMs: number,
  maxFutureSkewMs: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 80) {
    throw new MarketError(
      "PROVIDER_RESPONSE_INVALID",
      "The market provider returned an invalid timestamp.",
    );
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < Date.parse("2000-01-01T00:00:00.000Z") ||
    timestamp > nowMs + maxFutureSkewMs
  ) {
    throw new MarketError(
      "PROVIDER_RESPONSE_INVALID",
      "The market provider returned an invalid timestamp.",
    );
  }
  return new Date(timestamp).toISOString();
}

export function classifyFreshness(
  observedAt: string | null,
  nowMs: number,
  freshnessMaxAgeMs: number,
): MarketFreshness {
  if (observedAt === null) return "unknown";
  const age = nowMs - Date.parse(observedAt);
  return age <= freshnessMaxAgeMs ? "fresh" : "stale";
}