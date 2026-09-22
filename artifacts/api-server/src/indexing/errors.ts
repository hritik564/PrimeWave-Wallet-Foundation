import type { IndexingErrorCode } from "./types";

export class IndexingError extends Error {
  constructor(
    public readonly code: IndexingErrorCode,
    message: string,
    public readonly causeCode: string | null = null,
  ) {
    super(message);
    this.name = "IndexingError";
  }
}

export function normalizeIndexingError(
  error: unknown,
  maxLength: number,
): IndexingError {
  if (error instanceof IndexingError) {
    return new IndexingError(
      error.code,
      error.message.slice(0, maxLength),
      error.causeCode,
    );
  }
  return new IndexingError(
    "PERSISTENCE_FAILURE",
    "The indexing operation failed.",
    error instanceof Error ? error.name.slice(0, 64) : null,
  );
}