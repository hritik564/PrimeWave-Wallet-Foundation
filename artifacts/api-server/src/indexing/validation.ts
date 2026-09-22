import { IndexingError } from "./errors";

const HEX_QUANTITY = /^0x[0-9a-f]+$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DATA = /^0x(?:[0-9a-f]{2})*$/i;

export function parseHexBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
}

export function parseSafeHexNumber(value: unknown, label: string): number {
  const parsed = parseHexBigInt(value, label);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is too large.`);
  }
  return Number(parsed);
}

export function normalizeHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
  return value.toLowerCase();
}

export function normalizeAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
  return value.toLowerCase();
}

export function normalizeData(
  value: unknown,
  label: string,
  maxBytes: number,
): string {
  if (typeof value !== "string" || !DATA.test(value)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
  if ((value.length - 2) / 2 > maxBytes) {
    throw new IndexingError("RESPONSE_LIMIT", `${label} exceeds the limit.`);
  }
  return value.toLowerCase();
}

export function normalizeTopics(
  value: unknown,
  maxTopics: number,
  maxDataBytes: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxTopics) {
    throw new IndexingError("RESPONSE_LIMIT", "The log topic count is limited.");
  }
  return value.map((topic, index) =>
    normalizeData(topic, `Log topic ${index}`, maxDataBytes),
  );
}

export function assertBoundedRange(
  startBlock: bigint,
  endBlock: bigint,
  maxRange: number,
): void {
  if (startBlock < 0n || endBlock < startBlock) {
    throw new IndexingError("VALIDATION_FAILURE", "The block range is invalid.");
  }
  if (endBlock - startBlock + 1n > BigInt(maxRange)) {
    throw new IndexingError("RESPONSE_LIMIT", "The block range exceeds the limit.");
  }
}

export function toBoundedDecimal(value: bigint, label: string): string {
  if (value < 0n) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is negative.`);
  }
  return value.toString(10);
}