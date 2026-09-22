import { MarketError, MarketProviderError } from "./errors";
import {
  EmptyProviderAssetMappingRegistry,
  type ProviderAssetMappingRegistry,
} from "./mapping";
import { UnconfiguredPriceProvider } from "./provider";
import {
  classifyFreshness,
  marketAssetKey,
  normalizeProviderPrice,
  normalizeProviderTimestamp,
  parseMarketAssetDescriptor,
} from "./validation";
import type {
  MarketAssetIdentity,
  MarketAvailabilityReason,
  MarketPriceConfig,
  MarketPriceObservation,
  MarketPricePage,
  PriceProvider,
  ProviderAssetRequest,
} from "./types";
import { createPublicNetworkCatalog } from "../metadata/catalog";
import type { ServerConfig } from "../config";

interface RawProviderPrice {
  readonly providerAssetId: string;
  readonly price: string;
  readonly observedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reasonForProviderError(error: MarketProviderError): {
  readonly availability: "unavailable" | "invalid";
  readonly reason: MarketAvailabilityReason;
} {
  switch (error.code) {
    case "CONFIGURATION_MISSING":
      return { availability: "unavailable", reason: "provider_unconfigured" };
    case "TIMEOUT":
      return { availability: "unavailable", reason: "provider_timeout" };
    case "RATE_LIMIT":
      return { availability: "unavailable", reason: "provider_rate_limit" };
    case "MALFORMED_RESPONSE":
      return {
        availability: "invalid",
        reason: "malformed_provider_response",
      };
    case "UNAVAILABLE":
      return { availability: "unavailable", reason: "provider_unavailable" };
  }
}

export class MarketPriceService {
  constructor(
    private readonly config: MarketPriceConfig,
    private readonly provider: PriceProvider = new UnconfiguredPriceProvider(),
    private readonly mappings: ProviderAssetMappingRegistry =
      new EmptyProviderAssetMappingRegistry(),
    private readonly networks = createPublicNetworkCatalog({
      sepoliaRpcConfigured: true,
    }),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getPrices(input: {
    readonly assetDescriptors: readonly string[];
    readonly quoteCurrency: string;
  }): Promise<MarketPricePage> {
    const nowMs = this.now();
    const receivedAt = new Date(nowMs).toISOString();
    if (input.assetDescriptors.length > this.config.maxAssets) {
      throw new MarketError(
        "RESPONSE_LIMIT",
        "The market asset list exceeds the limit.",
      );
    }
    const quoteCurrency = input.quoteCurrency.toUpperCase();
    if (
      !this.config.supportedQuoteCurrencies.includes(quoteCurrency) ||
      !this.provider.supportedQuoteCurrencies.includes(quoteCurrency)
    ) {
      throw new MarketError(
        "UNSUPPORTED_QUOTE_CURRENCY",
        "The requested quote currency is not supported.",
      );
    }

    const assets = this.parseAndDedupeAssets(input.assetDescriptors);
    const unavailableBase = (asset: MarketAssetIdentity): MarketPriceObservation => ({
      asset,
      quoteCurrency,
      price: null,
      source: this.provider.providerId,
      providerAssetId: null,
      observedAt: null,
      receivedAt,
      freshness: "unknown",
      availability: "unavailable",
      provenance: "unavailable",
      reason: !this.config.enabled
        ? "market_disabled"
        : this.provider instanceof UnconfiguredPriceProvider
          ? "provider_unconfigured"
          : "mapping_unavailable",
    });

    if (!this.config.enabled) {
      return {
        quoteCurrency,
        provider: this.provider.providerId,
        requested: input.assetDescriptors.length,
        count: assets.length,
        items: assets.map(unavailableBase),
      };
    }

    if (this.provider instanceof UnconfiguredPriceProvider) {
      return {
        quoteCurrency,
        provider: this.provider.providerId,
        requested: input.assetDescriptors.length,
        count: assets.length,
        items: assets.map(unavailableBase),
      };
    }

    const observations = new Map<string, MarketPriceObservation>();
    const mapped: ProviderAssetRequest[] = [];
    for (const asset of assets) {
      const mapping = this.mappings.resolve(this.provider.providerId, asset);
      if (!mapping) {
        observations.set(marketAssetKey(asset), unavailableBase(asset));
        continue;
      }
      mapped.push({ asset, providerAssetId: mapping.providerAssetId });
      observations.set(marketAssetKey(asset), {
        ...unavailableBase(asset),
        providerAssetId: mapping.providerAssetId,
        reason: "price_unavailable",
      });
    }

    const batchSize = Math.min(
      this.config.maxBatchSize,
      this.provider.maxBatchSize,
    );
    for (let index = 0; index < mapped.length; index += batchSize) {
      const batch = mapped.slice(index, index + batchSize);
      try {
        const rawResponses = await this.provider.fetchPrices({
          quoteCurrency,
          assets: batch,
        });
        this.applyProviderResponses(
          observations,
          batch,
          rawResponses,
          quoteCurrency,
          receivedAt,
          nowMs,
        );
      } catch (error) {
        const providerError =
          error instanceof MarketProviderError
            ? error
            : new MarketProviderError(
                "MALFORMED_RESPONSE",
                "The market provider response was invalid.",
              );
        const outcome = reasonForProviderError(providerError);
        for (const request of batch) {
          observations.set(marketAssetKey(request.asset), {
            ...observations.get(marketAssetKey(request.asset))!,
            availability: outcome.availability,
            provenance:
              outcome.availability === "invalid" ? "invalid" : "unavailable",
            reason: outcome.reason,
          });
        }
      }
    }

    return {
      quoteCurrency,
      provider: this.provider.providerId,
      requested: input.assetDescriptors.length,
      count: assets.length,
      items: assets.map((asset) => observations.get(marketAssetKey(asset))!),
    };
  }

  private parseAndDedupeAssets(
    descriptors: readonly string[],
  ): readonly MarketAssetIdentity[] {
    const assets: MarketAssetIdentity[] = [];
    const identities = new Set<string>();
    for (const descriptor of descriptors) {
      const asset = parseMarketAssetDescriptor(descriptor);
      if (!this.networks.some((network) => network.networkId === asset.networkId)) {
        throw new MarketError(
          "INVALID_ASSET",
          "The market asset network is not supported.",
        );
      }
      const key = marketAssetKey(asset);
      if (!identities.has(key)) {
        identities.add(key);
        assets.push(asset);
      }
    }
    return assets;
  }

  private applyProviderResponses(
    observations: Map<string, MarketPriceObservation>,
    batch: readonly ProviderAssetRequest[],
    rawResponses: readonly unknown[],
    quoteCurrency: string,
    receivedAt: string,
    nowMs: number,
  ): void {
    if (!Array.isArray(rawResponses)) {
      throw new MarketProviderError(
        "MALFORMED_RESPONSE",
        "The market provider response was invalid.",
      );
    }
    const requestsByProviderId = new Map(
      batch.map((request) => [request.providerAssetId, request]),
    );
    const seenProviderIds = new Set<string>();
    for (const raw of rawResponses) {
      if (!isRecord(raw)) {
        throw new MarketProviderError(
          "MALFORMED_RESPONSE",
          "The market provider response was invalid.",
        );
      }
      const providerAssetId = raw.providerAssetId;
      if (
        typeof providerAssetId !== "string" ||
        providerAssetId.length === 0 ||
        providerAssetId.length > 128 ||
        !requestsByProviderId.has(providerAssetId) ||
        seenProviderIds.has(providerAssetId)
      ) {
        throw new MarketProviderError(
          "MALFORMED_RESPONSE",
          "The market provider response was invalid.",
        );
      }
      seenProviderIds.add(providerAssetId);
      const request = requestsByProviderId.get(providerAssetId)!;
      try {
        const price = normalizeProviderPrice(
          raw.price,
          this.config.maxDecimalPlaces,
        );
        const observedAt = normalizeProviderTimestamp(
          raw.observedAt ?? null,
          nowMs,
          this.config.maxTimestampFutureSkewMs,
        );
        observations.set(marketAssetKey(request.asset), {
          asset: request.asset,
          quoteCurrency,
          price,
          source: this.provider.providerId,
          providerAssetId,
          observedAt,
          receivedAt,
          freshness: classifyFreshness(
            observedAt,
            nowMs,
            this.config.freshnessMaxAgeMs,
          ),
          availability: "available",
          provenance: "provider",
          reason: "none",
        });
      } catch (error) {
        const reason =
          error instanceof MarketError &&
          error.message.includes("timestamp")
            ? "invalid_timestamp"
            : "invalid_price";
        observations.set(marketAssetKey(request.asset), {
          ...observations.get(marketAssetKey(request.asset))!,
          availability: "invalid",
          provenance: "invalid",
          reason,
        });
      }
    }
  }
}

export function createMarketPriceService(
  config: ServerConfig,
  provider?: PriceProvider,
  mappings?: ProviderAssetMappingRegistry,
): MarketPriceService {
  return new MarketPriceService(
    config.market,
    provider,
    mappings,
    createPublicNetworkCatalog(config),
  );
}