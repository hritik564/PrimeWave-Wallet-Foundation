import type { SynchronizationErrorCode } from "./types";

export class SynchronizationError extends Error {
  constructor(
    public readonly code: SynchronizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SynchronizationError";
  }
}

export function normalizeSynchronizationError(
  error: unknown,
  maxLength: number,
): SynchronizationError {
  if (error instanceof SynchronizationError) {
    return new SynchronizationError(
      error.code,
      error.message.slice(0, maxLength),
    );
  }
  return new SynchronizationError(
    "PERSISTENCE_FAILURE",
    "Synchronization persistence is unavailable.",
  );
}