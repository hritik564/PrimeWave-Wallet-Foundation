import type { EvmNetwork } from '@/src/core/networks';
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

  const native = model?.assets.find(asset => asset.assetType === 'native' && asset.visibility === 'visible');
  if (!native || native.availabilityState !== 'available' ||
      native.rawBalance === null || native.formattedBalance === null) {
    return {
      value: '—',
      detail: 'Balance unavailable',
      supporting: 'No confirmed native balance',
      available: false,
      zero: false,
    };
  }
  return {
    value: native.formattedBalance,
    detail: native.symbol ?? native.name ?? 'Native asset',
    supporting: model?.networkName ?? '',
    available: true,
    zero: native.rawBalance === 0n,
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

export function portfolioForSelection(
  model: PortfolioReadModel | null,
  selection: Pick<PortfolioReadModel, 'accountId' | 'accountAddress' | 'networkId'>,
): PortfolioReadModel | null {
  if (!model || model.accountId !== selection.accountId ||
      model.networkId !== selection.networkId ||
      model.accountAddress.toLowerCase() !== selection.accountAddress.toLowerCase()) {
    return null;
  }
  return model;
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

export function filterRegisteredNetworks(networks: readonly EvmNetwork[], search: string) {
  const query = search.trim().toLowerCase();
  return networks.filter(network => [
    network.displayName, network.id,
    network.configurationStatus === 'configured' ? network.nativeCurrency.symbol : '',
    network.chainId?.toString() ?? '',
  ].some(value => value.toLowerCase().includes(query)));
}
