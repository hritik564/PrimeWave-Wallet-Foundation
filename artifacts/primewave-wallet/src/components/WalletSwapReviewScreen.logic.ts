import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import {
  formatSwapReviewAmount,
  type SwapFeeAmount,
  type SwapReviewAssetSnapshot,
  type SwapReviewSnapshot,
} from '@/src/core/swaps';
import { swapAssetKey } from './WalletSwapScreen.logic';

export function findReviewPortfolioAsset(
  portfolio: PortfolioReadModel | null,
  asset: SwapReviewAssetSnapshot,
): PortfolioAssetViewModel | null {
  return portfolio?.assets.find(
    (candidate) => swapAssetKey(candidate.identity) === swapAssetKey(asset.identity),
  ) ?? null;
}

export function formatReviewFee(
  fee: SwapFeeAmount | null,
  network: EvmNetwork,
  sellAsset: SwapReviewAssetSnapshot,
  buyAsset: SwapReviewAssetSnapshot,
): string | null {
  if (!fee) return null;
  const decimals = fee.asset.assetType === 'native' && fee.asset.assetId === 'native'
    ? network.nativeCurrency.decimals
    : fee.asset.assetType === 'fungible_token' && fee.asset.assetId === sellAsset.identity.assetId
      ? sellAsset.decimals
      : fee.asset.assetType === 'fungible_token' && fee.asset.assetId === buyAsset.identity.assetId
        ? buyAsset.decimals
        : null;
  return decimals === null ? null : formatSwapReviewAmount(fee.amount, decimals);
}

export function reviewFeeAssetLabel(
  fee: SwapFeeAmount | null,
  network: EvmNetwork,
  sellAsset: SwapReviewAssetSnapshot,
  buyAsset: SwapReviewAssetSnapshot,
): string {
  if (!fee) return 'Unavailable';
  if (fee.asset.assetType === 'native' && fee.asset.assetId === 'native') {
    return network.nativeCurrency.symbol;
  }
  if (fee.asset.assetId === sellAsset.identity.assetId) return sellAsset.symbol ?? 'token';
  if (fee.asset.assetId === buyAsset.identity.assetId) return buyAsset.symbol ?? 'token';
  return 'token';
}

export function reviewRouteLabel(review: SwapReviewSnapshot): string {
  if (review.route.state !== 'available') return 'Unavailable';
  return review.route.hops.map((hop) => hop.protocol || hop.poolOrVenue).join(' → ');
}

export function formatReviewSlippage(slippageBps: number): string {
  return `${(slippageBps / 100).toFixed(2)}%`;
}

export function formatReviewImpact(review: SwapReviewSnapshot): string {
  return review.priceImpact.state === 'available'
    ? `${(review.priceImpact.bps / 100).toFixed(2)}%`
    : 'Unavailable';
}