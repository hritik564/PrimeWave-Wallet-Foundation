import {
  PortfolioReadModelError,
  type PortfolioAssetViewModel,
} from '@/src/core/portfolio';

export type AssetFilter = 'all' | 'visible' | 'hidden';

export const homeNavigationLabels = [
  'Home',
  'Assets',
  'Swap',
  'Activity',
  'Settings',
] as const;

export type HomePortfolioState =
  | 'loading'
  | 'available'
  | 'empty'
  | 'unavailable'
  | 'error';

export function shortPublicAddress(address: string): string {
  const normalized = address.trim();
  if (normalized.length === 0) return 'Unavailable';
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function safePortfolioMessage(error: unknown): string {
  if (error instanceof PortfolioReadModelError) {
    return error.message;
  }
  return 'Portfolio data is currently unavailable. Try refreshing again later.';
}

export function getPortfolioState(
  assetCount: number,
): Extract<HomePortfolioState, 'available' | 'empty'> {
  return assetCount === 0 ? 'empty' : 'available';
}

export function assetStateLabel(asset: PortfolioAssetViewModel): string {
  if (asset.availabilityState === 'stale') return 'STALE';
  if (asset.availabilityState === 'invalid') return 'INVALID';
  if (asset.availabilityState === 'unavailable') return 'UNAVAILABLE';
  if (asset.verificationStatus === 'verified') return 'VERIFIED';
  if (asset.balanceState === 'zero') return 'ZERO BALANCE';
  return 'AVAILABLE';
}

export function assetDisplayName(asset: PortfolioAssetViewModel): string {
  return (
    asset.name ??
    asset.symbol ??
    (asset.assetType === 'native' ? 'Native asset' : 'Token')
  );
}

export function assetDisplaySubtitle(asset: PortfolioAssetViewModel): string {
  if (asset.symbol && asset.name && asset.symbol !== asset.name) return asset.symbol;
  if (asset.assetType === 'native') return 'Native asset';
  return 'Fungible token';
}

export function assetMatchesSearch(
  asset: PortfolioAssetViewModel,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return true;
  return [
    asset.name,
    asset.symbol,
    asset.contractAddress,
    asset.identity.assetId,
  ]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterPortfolioAssets(
  assets: readonly PortfolioAssetViewModel[],
  filter: AssetFilter,
  query: string,
): readonly PortfolioAssetViewModel[] {
  return assets.filter((asset) => {
    const visibilityMatches =
      filter === 'all' ||
      (filter === 'visible' && asset.visibility === 'visible') ||
      (filter === 'hidden' && asset.visibility === 'hidden');
    return visibilityMatches && assetMatchesSearch(asset, query);
  });
}