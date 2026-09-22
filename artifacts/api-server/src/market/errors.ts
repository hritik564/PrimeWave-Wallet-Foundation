export type MarketErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_ASSET"
  | "UNSUPPORTED_QUOTE_CURRENCY"
  | "RESPONSE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RESPONSE_INVALID";

export class MarketError extends Error {
  constructor(
    public readonly code: MarketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketError";
  }
}

export type MarketProviderErrorCode =
  | "CONFIGURATION_MISSING"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "MALFORMED_RESPONSE";

export class MarketProviderError extends Error {
  constructor(
    public readonly code: MarketProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketProviderError";
  }
}