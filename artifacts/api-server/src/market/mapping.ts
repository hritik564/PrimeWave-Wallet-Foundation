import { MarketError } from "./errors";
import { marketAssetKey } from "./validation";
import type { MarketAssetIdentity } from "./types";

export interface ProviderAssetMapping {
  readonly providerId: string;
  readonly asset: MarketAssetIdentity;
  readonly providerAssetId: string;
}

export interface ProviderAssetMappingRegistry {
  resolve(
    providerId: string,
    asset: MarketAssetIdentity,
  ): ProviderAssetMapping | null;
}

export class EmptyProviderAssetMappingRegistry
  implements ProviderAssetMappingRegistry
{
  resolve(): ProviderAssetMapping | null {
    return null;
  }
}

export class StaticProviderAssetMappingRegistry
  implements ProviderAssetMappingRegistry
{
  private readonly mappings = new Map<string, ProviderAssetMapping>();

  constructor(mappings: readonly ProviderAssetMapping[]) {
    const providerAssetIds = new Set<string>();
    for (const mapping of mappings) {
      if (
        !mapping.providerId ||
        !mapping.providerAssetId ||
        mapping.providerAssetId.length > 128
      ) {
        throw new MarketError(
          "CONFIGURATION_ERROR",
          "The market provider mapping is invalid.",
        );
      }
      const key = `${mapping.providerId}:${marketAssetKey(mapping.asset)}`;
      if (this.mappings.has(key) || providerAssetIds.has(`${mapping.providerId}:${mapping.providerAssetId}`)) {
        throw new MarketError(
          "CONFIGURATION_ERROR",
          "The market provider mapping contains a duplicate identity.",
        );
      }
      this.mappings.set(key, mapping);
      providerAssetIds.add(`${mapping.providerId}:${mapping.providerAssetId}`);
    }
  }

  resolve(
    providerId: string,
    asset: MarketAssetIdentity,
  ): ProviderAssetMapping | null {
    return this.mappings.get(`${providerId}:${marketAssetKey(asset)}`) ?? null;
  }
}