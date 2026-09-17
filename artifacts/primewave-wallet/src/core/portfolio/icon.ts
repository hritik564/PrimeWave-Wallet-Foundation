import { keccak256, stringToBytes } from 'viem';
import type { AssetIdentity } from '@/src/core/assets';
import { getAssetIdentityKey } from '@/src/core/assets';
import type {
  AssetIcon,
  AssetIconFallbackType,
} from './models';

function initialsFor(
  symbol: string | null,
  name: string | null,
  networkId: string,
): string {
  const source = (symbol ?? name ?? networkId)
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  return source.slice(0, 2).padEnd(2, '?');
}

export function createAssetIcon(
  identity: AssetIdentity,
  displayName: string | null,
  symbol: string | null,
  fallbackType: AssetIconFallbackType = 'asset_initials',
): AssetIcon {
  const fallback = Object.freeze({
    type: fallbackType,
    initials: initialsFor(symbol, displayName, identity.networkId),
    deterministicId: keccak256(
      stringToBytes(getAssetIdentityKey(identity)),
    ),
  });
  return Object.freeze({
    source: 'none',
    status: 'unavailable',
    reference: null,
    dimensions: null,
    provenance: 'none',
    fallback,
  });
}