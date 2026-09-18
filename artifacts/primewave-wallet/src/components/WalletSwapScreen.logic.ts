import { AssetError, formatAssetAmount, parseAssetAmount } from '@/src/core/assets';
import type { AssetIdentity } from '@/src/core/assets';
import type { EvmNetwork } from '@/src/core/networks';
import {
  SwapError,
  type SwapQuote,
  type SwapQuoteRequest,
} from '@/src/core/swaps';
import type { PortfolioAssetViewModel } from '@/src/core/portfolio';

export type SwapAmountValidation =
  | { readonly state: 'empty'; readonly message: string; readonly rawAmount: null }
  | { readonly state: 'valid'; readonly message: null; readonly rawAmount: bigint }
  | { readonly state: 'invalid'; readonly message: string; readonly rawAmount: null };

export type SwapSlippageValidation =
  | { readonly state: 'valid'; readonly bps: number; readonly message: null }
  | { readonly state: 'invalid'; readonly bps: null; readonly message: string };

export interface SwapFormValidation {
  readonly amount: SwapAmountValidation;
  readonly slippage: SwapSlippageValidation;
  readonly message: string | null;
  readonly canQuote: boolean;
}

export function swapAssetKey(identity: AssetIdentity): string {
  return `${identity.networkId}:${identity.assetType}:${identity.assetId}`;
}

export function isSwapAsset(
  asset: PortfolioAssetViewModel,
  network: EvmNetwork,
): boolean {
  return (
    asset.networkId === network.id &&
    asset.identity.networkId === network.id &&
    (asset.assetType === 'native' || asset.assetType === 'fungible_token') &&
    asset.availabilityState === 'available'
  );
}

export function getSwapAssets(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
): readonly PortfolioAssetViewModel[] {
  return assets.filter((asset) => isSwapAsset(asset, network));
}

export function getSellAssets(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
): readonly PortfolioAssetViewModel[] {
  return getSwapAssets(assets, network).filter(
    (asset) => asset.rawBalance !== null && asset.decimals !== null,
  );
}

export function selectDefaultSellAsset(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
): PortfolioAssetViewModel | null {
  const sellAssets = getSellAssets(assets, network);
  return sellAssets.find((asset) => asset.assetType === 'native') ?? sellAssets[0] ?? null;
}

export function selectDefaultBuyAsset(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
  sellAsset: PortfolioAssetViewModel | null,
): PortfolioAssetViewModel | null {
  const key = sellAsset ? swapAssetKey(sellAsset.identity) : null;
  return (
    getSwapAssets(assets, network).find((asset) => swapAssetKey(asset.identity) !== key) ??
    null
  );
}

export function formatMaxSwapAmount(
  asset: PortfolioAssetViewModel | null,
): string {
  if (
    asset === null ||
    asset.rawBalance === null ||
    asset.decimals === null
  ) {
    return '';
  }
  return formatAssetAmount(asset.rawBalance, asset.decimals);
}

export function parseSlippageBps(input: string): SwapSlippageValidation {
  const value = input.trim();
  const match = /^(0|[0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) {
    return { state: 'invalid', bps: null, message: 'Use a percentage from 0% to 50%.' };
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const bps = whole * 100 + fraction;
  if (!Number.isSafeInteger(bps) || bps > 5000) {
    return { state: 'invalid', bps: null, message: 'Maximum slippage is 50%.' };
  }
  return { state: 'valid', bps, message: null };
}

export function validateSwapAmount(
  input: string,
  asset: PortfolioAssetViewModel | null,
): SwapAmountValidation {
  if (input.length === 0) {
    return { state: 'empty', message: 'Enter an amount to swap.', rawAmount: null };
  }
  if (
    asset === null ||
    asset.rawBalance === null ||
    asset.decimals === null
  ) {
    return {
      state: 'invalid',
      message: 'The selected balance is unavailable.',
      rawAmount: null,
    };
  }
  try {
    const rawAmount = parseAssetAmount(input, asset.decimals);
    if (rawAmount === 0n) {
      return { state: 'invalid', message: 'Amount must be greater than zero.', rawAmount: null };
    }
    if (rawAmount > asset.rawBalance) {
      return { state: 'invalid', message: 'Amount exceeds the available balance.', rawAmount: null };
    }
    return { state: 'valid', message: null, rawAmount };
  } catch (error) {
    if (error instanceof AssetError && error.code === 'DECIMAL_OVERFLOW') {
      return {
        state: 'invalid',
        message: `Use no more than ${asset.decimals} decimal places.`,
        rawAmount: null,
      };
    }
    return { state: 'invalid', message: 'Enter a valid amount.', rawAmount: null };
  }
}

export function validateSwapForm({
  accountId,
  senderAddress,
  network,
  sellAsset,
  buyAsset,
  amount,
  slippage,
}: {
  readonly accountId: string;
  readonly senderAddress: string;
  readonly network: EvmNetwork;
  readonly sellAsset: PortfolioAssetViewModel | null;
  readonly buyAsset: PortfolioAssetViewModel | null;
  readonly amount: string;
  readonly slippage: string;
}): SwapFormValidation {
  const amountResult = validateSwapAmount(amount, sellAsset);
  const slippageResult = parseSlippageBps(slippage);
  const networkAvailable =
    network.enabled &&
    network.configurationStatus === 'configured' &&
    network.chainId !== null;

  let message: string | null = null;
  if (!accountId.trim() || !senderAddress.trim()) {
    message = 'The public swap account is unavailable.';
  } else if (!networkAvailable) {
    message = 'This network is unavailable for swaps.';
  } else if (!sellAsset) {
    message = 'Select an asset to sell.';
  } else if (!isSwapAsset(sellAsset, network) || sellAsset.rawBalance === null || sellAsset.decimals === null) {
    message = 'The selected sell asset is unavailable.';
  } else if (!buyAsset) {
    message = 'Select an asset to receive.';
  } else if (!isSwapAsset(buyAsset, network)) {
    message = 'The selected receive asset is unavailable.';
  } else if (swapAssetKey(sellAsset.identity) === swapAssetKey(buyAsset.identity)) {
    message = 'The sell and receive assets must be different.';
  } else if (amountResult.state !== 'valid') {
    message = amountResult.message;
  } else if (slippageResult.state !== 'valid') {
    message = slippageResult.message;
  }

  return {
    amount: amountResult,
    slippage: slippageResult,
    message,
    canQuote:
      message === null &&
      amountResult.state === 'valid' &&
      slippageResult.state === 'valid',
  };
}

export function createSwapQuoteRequest({
  accountId,
  senderAddress,
  network,
  sellAsset,
  buyAsset,
  amount,
  slippageBps,
}: {
  readonly accountId: string;
  readonly senderAddress: string;
  readonly network: EvmNetwork;
  readonly sellAsset: PortfolioAssetViewModel;
  readonly buyAsset: PortfolioAssetViewModel;
  readonly amount: bigint;
  readonly slippageBps: number;
}): SwapQuoteRequest {
  if (network.chainId === null) throw new SwapError('SWAP_NETWORK_NOT_CONFIGURED');
  return Object.freeze({
    accountId,
    senderAddress,
    networkId: network.id,
    chainId: BigInt(network.chainId),
    sellAsset: sellAsset.identity,
    buyAsset: buyAsset.identity,
    sellAmount: amount,
    slippageBps,
  });
}

export function swapQuoteContextKey({
  accountId,
  senderAddress,
  network,
  sellAsset,
  buyAsset,
  amount,
  slippage,
}: {
  readonly accountId: string;
  readonly senderAddress: string;
  readonly network: EvmNetwork;
  readonly sellAsset: PortfolioAssetViewModel | null;
  readonly buyAsset: PortfolioAssetViewModel | null;
  readonly amount: string;
  readonly slippage: string;
}): string {
  return [
    accountId,
    senderAddress,
    network.id,
    network.chainId ?? 'unconfigured',
    sellAsset ? swapAssetKey(sellAsset.identity) : 'none',
    buyAsset ? swapAssetKey(buyAsset.identity) : 'none',
    amount,
    slippage,
  ].join('|');
}

export function swapErrorMessage(error: unknown): string {
  if (error instanceof SwapError) {
    switch (error.code) {
      case 'SWAP_PROVIDER_CONFIGURATION':
        return 'Swap quotes are not configured for this build.';
      case 'SWAP_PROVIDER_RATE_LIMITED':
        return 'The quote provider is rate limited. Try again shortly.';
      case 'SWAP_QUOTE_UNAVAILABLE':
        return 'The quote provider is temporarily unavailable.';
      case 'SWAP_QUOTE_EXPIRED':
        return 'This quote expired. Refresh to request a new quote.';
      default:
        return error.message;
    }
  }
  return 'A quote could not be retrieved. Try again.';
}

export function formatSwapAmount(
  amount: bigint,
  decimals: number | null,
): string | null {
  if (decimals === null) return null;
  try {
    return formatAssetAmount(amount, decimals);
  } catch {
    return null;
  }
}

export function quoteIsActive(quote: SwapQuote, now = Date.now()): boolean {
  return now < quote.expiresAt;
}