export type AnalyticsErrorCode =
  | "DISABLED"
  | "INVALID_EVENT"
  | "PAYLOAD_TOO_LARGE"
  | "BATCH_LIMIT"
  | "ADMISSION_LIMIT"
  | "PERSISTENCE_FAILURE";

export class AnalyticsRequestError extends Error {
  constructor(
    public readonly code: AnalyticsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsRequestError";
  }
}