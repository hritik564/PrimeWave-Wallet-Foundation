export type NotificationErrorCode =
  | "INVALID_SCOPE"
  | "INVALID_DEVICE"
  | "DEVICE_LIMIT"
  | "DEVICE_NOT_FOUND"
  | "INVALID_PREFERENCES"
  | "INVALID_EVENT"
  | "RESPONSE_LIMIT"
  | "PERSISTENCE_FAILURE"
  | "QUEUE_LIMIT";

export class NotificationError extends Error {
  constructor(
    public readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export type NotificationProviderErrorCode =
  | "CONFIGURATION_MISSING"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_TOKEN"
  | "DISABLED_REGISTRATION"
  | "MALFORMED_REQUEST"
  | "UNAVAILABLE";

export class NotificationProviderError extends Error {
  constructor(
    public readonly code: NotificationProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}