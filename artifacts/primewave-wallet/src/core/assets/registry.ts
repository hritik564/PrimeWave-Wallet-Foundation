import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { AssetError } from './errors';
import {
  type AssetAvailability,
  type AssetAvailabilityStatus,
  type AssetIdentity,
  type AssetType,
  type NativeAsset,
} from './models';
import { validateAssetDecimals } from './amount';

export const NATIVE_ASSET_ID = 'native' as const;

export function createAssetIdentity(
  assetType: AssetType,
  networkId: string,
  assetId: string,
): AssetIdentity {
  if (
    (assetType !== 'native' &&
      assetType !== 'fungible_token' &&
      assetType !== 'nft') ||
    networkId.trim().length === 0 ||
    assetId.trim().length === 0
  ) {
    throw new AssetError('ASSET_INVALID_METADATA');
  }
  return Object.freeze({ assetType, networkId, assetId });
}

export function getAssetIdentityKey(identity: AssetIdentity): string {
  return JSON.stringify([
    identity.assetType,
    identity.networkId,
    identity.assetId,
  ]);
}

function statusForNetwork(
  network: EvmNetwork | undefined,
): AssetAvailabilityStatus {
  if (!network) {
    return 'unsupported';
  }
  if (!network.enabled) {
    return 'disabled';
  }
  if (
    network.configurationStatus !== 'configured' ||
    network.chainId === null
  ) {
    return 'unconfigured';
  }
  return 'available';
}

export class AssetRegistry {
  constructor(private readonly networkRegistry: NetworkRegistry) {}

  getNetworkRegistry(): NetworkRegistry {
    return this.networkRegistry;
  }

  getNativeAssetStatus(networkId: string): AssetAvailability {
    const network = this.networkRegistry.getById(networkId);
    const identity = createAssetIdentity(
      'native',
      networkId,
      NATIVE_ASSET_ID,
    );
    return Object.freeze({
      identity,
      networkId,
      chainId: network?.chainId ?? null,
      status: statusForNetwork(network),
    });
  }

  resolveNativeAsset(networkId: string): NativeAsset {
    const network = this.networkRegistry.getById(networkId);
    const status = statusForNetwork(network);
    if (status === 'unsupported') {
      throw new AssetError('ASSET_NOT_FOUND');
    }
    if (status === 'disabled') {
      throw new AssetError('ASSET_NETWORK_DISABLED');
    }
    if (status === 'unconfigured' || network?.chainId === null) {
      throw new AssetError('ASSET_NETWORK_NOT_CONFIGURED');
    }
    if (!network) {
      throw new AssetError('ASSET_NOT_FOUND');
    }
    validateAssetDecimals(network.nativeCurrency.decimals);
    return Object.freeze({
      assetType: 'native',
      networkId: network.id,
      assetId: NATIVE_ASSET_ID,
      chainId: network.chainId,
      name: network.nativeCurrency.name,
      symbol: network.nativeCurrency.symbol,
      decimals: network.nativeCurrency.decimals,
      nativeCurrencyIdentifier: NATIVE_ASSET_ID,
      enabled: true,
      status: 'available',
    });
  }

  resolveAsset(identity: AssetIdentity): NativeAsset {
    if (identity.assetType !== 'native') {
      throw new AssetError('ASSET_UNSUPPORTED');
    }
    if (identity.assetId !== NATIVE_ASSET_ID) {
      throw new AssetError('ASSET_NOT_FOUND');
    }
    return this.resolveNativeAsset(identity.networkId);
  }
}