import {
  PortfolioReadModelError,
  type PortfolioAssetViewModel,
  type PortfolioReadModel,
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

export interface HomeBalancePresentation {
  readonly value: string;
  readonly detail: string;
  readonly supporting: string;
  readonly available: boolean;
  readonly zero: boolean;
}

export function getHomeBalancePresentation(
  state: HomePortfolioState,
  model: PortfolioReadModel | null,
): HomeBalancePresentation {
  if (state === 'loading') {
    return {
      value: '—',
      detail: 'Loading portfolio',
      supporting: 'Reading public balances',
      available: false,
      zero: false,
    };
  }

  if (state === 'unavailable') {
    return {
      value: '—',
      detail: 'Balance unavailable',
      supporting: 'Check your connection and try again',
      available: false,
      zero: false,
    };
  }

  if (state === 'error') {
    return {
      value: '—',
      detail: 'Could not load your balance',
      supporting: 'Check your connection and try again',
      available: false,
      zero: false,
    };
  }

  const visibleAssets = model?.assets.filter((asset) => asset.visibility === 'visible') ?? [];
  const hasUnavailableAsset = visibleAssets.some(
    (asset) => asset.availabilityState !== 'available',
  );

  if (hasUnavailableAsset) {
    return {
      value: '—',
      detail: 'Balance partially unavailable',
      supporting: 'Some asset balances could not be read',
      available: false,
      zero: false,
    };
  }

  const hasPositiveBalance = visibleAssets.some(
    (asset) =>
      asset.availabilityState === 'available' &&
      asset.balanceState === 'positive',
  );

  if (!hasPositiveBalance) {
    return {
      value: '0',
      detail: 'Available balance',
      supporting: 'No assets on this network yet',
      available: true,
      zero: true,
    };
  }

  return {
    value: '—',
    detail: 'Fiat value unavailable',
    supporting: 'Native balances are shown below',
    available: true,
    zero: false,
  };
}

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

export function safePortfolioDiagnostic(error: unknown): string | null {
  const message = safePortfolioMessage(error);
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return `${error.code}: ${message}`;
  }
  return message === 'Portfolio data is currently unavailable. Try refreshing again later.'
    ? null
    : message;
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