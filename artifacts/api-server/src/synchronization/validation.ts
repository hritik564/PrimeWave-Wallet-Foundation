import { normalizeAddress } from "../indexing/validation";
import { SynchronizationError } from "./errors";
import type { SyncScope } from "./types";

const NETWORK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-f]{64}$/i;

export function normalizeSyncNetworkId(value: unknown): string {
  if (typeof value !== "string" || !NETWORK_ID.test(value.trim())) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The network identity is invalid.",
    );
  }
  return value.trim();
}

export function normalizeSyncAddress(value: unknown): string {
  try {
    return normalizeAddress(value, "Account address");
  } catch {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The account address is invalid.",
    );
  }
}

export function parseDecimalBlock(value: unknown, label: string): bigint {
  if (
    typeof value !== "string" ||
    !DECIMAL_INTEGER.test(value) ||
    value.length > 80
  ) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      `${label} is invalid.`,
    );
  }
  try {
    return BigInt(value);
  } catch {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      `${label} is invalid.`,
    );
  }
}

export function parseDecimalChainId(value: unknown): number {
  const parsed = parseDecimalBlock(value, "Chain ID");
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The chain ID is too large.",
    );
  }
  return Number(parsed);
}

export function parsePageNumber(
  value: unknown,
  label: string,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = parseDecimalBlock(value, label);
  if (parsed > BigInt(maximum)) {
    throw new SynchronizationError(
      "RESPONSE_LIMIT",
      `${label} exceeds the limit.`,
    );
  }
  return Number(parsed);
}

export function normalizeTransactionHash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The transaction hash is invalid.",
    );
  }
  return value.toLowerCase();
}

export function validateSyncScope(
  scope: SyncScope,
  expectedChainId: number,
): SyncScope {
  if (
    normalizeSyncNetworkId(scope.networkId) !== scope.networkId ||
    scope.chainId !== expectedChainId
  ) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The network and chain identity do not match.",
    );
  }
  return Object.freeze({
    networkId: scope.networkId,
    chainId: scope.chainId,
    accountAddress: normalizeSyncAddress(scope.accountAddress),
  });
}

export function assertBoundedSyncRange(
  startBlock: bigint,
  endBlock: bigint,
  maxBlockRange: number,
): void {
  if (startBlock < 0n || endBlock < startBlock) {
    throw new SynchronizationError(
      "VALIDATION_FAILURE",
      "The synchronization range is invalid.",
    );
  }
  if (endBlock - startBlock + 1n > BigInt(maxBlockRange)) {
    throw new SynchronizationError(
      "RESPONSE_LIMIT",
      "The synchronization range exceeds the limit.",
    );
  }
}