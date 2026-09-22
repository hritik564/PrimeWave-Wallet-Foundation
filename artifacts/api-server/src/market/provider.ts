import { MarketProviderError } from "./errors";
import type {
  PriceProvider,
  ProviderAssetRequest,
  MarketQuoteCurrency,
} from "./types";

export class UnconfiguredPriceProvider implements PriceProvider {
  readonly providerId = "unconfigured";
  readonly supportedQuoteCurrencies: readonly MarketQuoteCurrency[] = ["USD"];
  readonly maxBatchSize = 1;

  async fetchPrices(_input: {
    readonly quoteCurrency: MarketQuoteCurrency;
    readonly assets: readonly ProviderAssetRequest[];
  }): Promise<readonly unknown[]> {
    throw new MarketProviderError(
      "CONFIGURATION_MISSING",
      "No approved market-data provider is configured.",
    );
  }
}

export class DeterministicMockPriceProvider implements PriceProvider {
  readonly providerId = "deterministic-mock";
  readonly supportedQuoteCurrencies: readonly MarketQuoteCurrency[] = ["USD"];

  constructor(
    private readonly responses: ReadonlyMap<string, unknown>,
    readonly maxBatchSize = 25,
  ) {}

  async fetchPrices(input: {
    readonly quoteCurrency: MarketQuoteCurrency;
    readonly assets: readonly ProviderAssetRequest[];
  }): Promise<readonly unknown[]> {
    return input.assets
      .map((asset) => this.responses.get(asset.providerAssetId))
      .filter((response): response is unknown => response !== undefined);
  }
}