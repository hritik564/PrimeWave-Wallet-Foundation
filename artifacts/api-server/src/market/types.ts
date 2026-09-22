export type MarketAssetKind = "native" | "erc20";

export interface NativeMarketAsset {
  readonly kind: "native";
  readonly networkId: string;
  readonly assetId: "native";
}

export interface Erc20MarketAsset {
  readonly kind: "erc20";
  readonly networkId: string;
  readonly contractAddress: string;
}

export type MarketAssetIdentity = NativeMarketAsset | Erc20MarketAsset;

export type MarketQuoteCurrency = string;

export type MarketAvailability = "available" | "unavailable" | "invalid";
export type MarketFreshness = "fresh" | "stale" | "unknown";
export type MarketProvenance = "provider" | "unavailable" | "invalid";

export type MarketAvailabilityReason =
  | "none"
  | "market_disabled"
  | "mapping_unavailable"
  | "provider_unconfigured"
  | "provider_timeout"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "price_unavailable"
  | "malformed_provider_response"
  | "invalid_price"
  | "invalid_timestamp";

export interface MarketPriceObservation {
  readonly asset: MarketAssetIdentity;
  readonly quoteCurrency: MarketQuoteCurrency;
  readonly price: string | null;
  readonly source: string | null;
  readonly providerAssetId: string | null;
  readonly observedAt: string | null;
  readonly receivedAt: string;
  readonly freshness: MarketFreshness;
  readonly availability: MarketAvailability;
  readonly provenance: MarketProvenance;
  readonly reason: MarketAvailabilityReason;
}

export interface MarketPricePage {
  readonly quoteCurrency: MarketQuoteCurrency;
  readonly provider: string | null;
  readonly requested: number;
  readonly count: number;
  readonly items: readonly MarketPriceObservation[];
}

export interface MarketPriceConfig {
  readonly enabled: boolean;
  readonly maxAssets: number;
  readonly maxBatchSize: number;
  readonly freshnessMaxAgeMs: number;
  readonly maxTimestampFutureSkewMs: number;
  readonly maxDecimalPlaces: number;
  readonly supportedQuoteCurrencies: readonly MarketQuoteCurrency[];
}

export interface ProviderAssetRequest {
  readonly asset: MarketAssetIdentity;
  readonly providerAssetId: string;
}

export interface PriceProvider {
  readonly providerId: string;
  readonly supportedQuoteCurrencies: readonly MarketQuoteCurrency[];
  readonly maxBatchSize: number;
  fetchPrices(input: {
    readonly quoteCurrency: MarketQuoteCurrency;
    readonly assets: readonly ProviderAssetRequest[];
  }): Promise<readonly unknown[]>;
}