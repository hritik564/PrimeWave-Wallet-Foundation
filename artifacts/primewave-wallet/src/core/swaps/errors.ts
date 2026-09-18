export type SwapErrorCode =
  | 'SWAP_INVALID_REQUEST'
  | 'SWAP_ACCOUNT_INVALID'
  | 'SWAP_SENDER_INVALID'
  | 'SWAP_NETWORK_UNSUPPORTED'
  | 'SWAP_NETWORK_DISABLED'
  | 'SWAP_NETWORK_NOT_CONFIGURED'
  | 'SWAP_NETWORK_MISMATCH'
  | 'SWAP_CHAIN_MISMATCH'
  | 'SWAP_ASSET_UNSUPPORTED'
  | 'SWAP_ASSET_INVALID'
  | 'SWAP_ASSET_MISMATCH'
  | 'SWAP_SAME_ASSET'
  | 'SWAP_INVALID_AMOUNT'
  | 'SWAP_INVALID_SLIPPAGE'
  | 'SWAP_EXCESSIVE_SLIPPAGE'
  | 'SWAP_CROSS_CHAIN_UNSUPPORTED'
  | 'SWAP_QUOTE_UNAVAILABLE'
  | 'SWAP_QUOTE_EXPIRED'
  | 'SWAP_PROVIDER_ERROR'
  | 'SWAP_PROVIDER_CONFIGURATION'
  | 'SWAP_PROVIDER_RATE_LIMITED'
  | 'SWAP_INVALID_QUOTE'
  | 'SWAP_PROVIDER_ID_MISMATCH'
  | 'SWAP_AMOUNT_MISMATCH'
  | 'SWAP_INVALID_ROUTE'
  | 'SWAP_INVALID_TRANSACTION_REQUEST'
  | 'SWAP_INVALID_FEE'
  | 'SWAP_INVALID_PRICE_IMPACT';

const SAFE_MESSAGES: Record<SwapErrorCode, string> = {
  SWAP_INVALID_REQUEST: 'The swap request is invalid.',
  SWAP_ACCOUNT_INVALID: 'The swap account is invalid.',
  SWAP_SENDER_INVALID: 'The public swap sender address is invalid.',
  SWAP_NETWORK_UNSUPPORTED: 'The selected swap network is unsupported.',
  SWAP_NETWORK_DISABLED: 'The selected swap network is disabled.',
  SWAP_NETWORK_NOT_CONFIGURED: 'The selected swap network is not configured.',
  SWAP_NETWORK_MISMATCH: 'The quote network does not match the request.',
  SWAP_CHAIN_MISMATCH: 'The swap chain does not match the selected network.',
  SWAP_ASSET_UNSUPPORTED: 'This asset type is not supported for swaps.',
  SWAP_ASSET_INVALID: 'The swap asset identity is invalid.',
  SWAP_ASSET_MISMATCH: 'The swap asset does not match the selected network.',
  SWAP_SAME_ASSET: 'The sell and buy assets must be different.',
  SWAP_INVALID_AMOUNT: 'The sell amount is invalid.',
  SWAP_INVALID_SLIPPAGE: 'The slippage value is invalid.',
  SWAP_EXCESSIVE_SLIPPAGE: 'The requested slippage is above the allowed limit.',
  SWAP_CROSS_CHAIN_UNSUPPORTED: 'Cross-chain swaps are not supported.',
  SWAP_QUOTE_UNAVAILABLE: 'A swap quote is unavailable.',
  SWAP_QUOTE_EXPIRED: 'The swap quote has expired.',
  SWAP_PROVIDER_ERROR: 'The swap quote provider could not complete the request.',
  SWAP_PROVIDER_CONFIGURATION: 'The swap quote provider is not configured.',
  SWAP_PROVIDER_RATE_LIMITED: 'The swap quote provider is rate limited.',
  SWAP_INVALID_QUOTE: 'The swap quote returned by the provider is invalid.',
  SWAP_PROVIDER_ID_MISMATCH: 'The quote provider identity does not match.',
  SWAP_AMOUNT_MISMATCH: 'The quote amount does not match the request.',
  SWAP_INVALID_ROUTE: 'The swap route returned by the provider is invalid.',
  SWAP_INVALID_TRANSACTION_REQUEST:
    'The provider transaction request is invalid.',
  SWAP_INVALID_FEE: 'The provider fee data is invalid.',
  SWAP_INVALID_PRICE_IMPACT: 'The provider price-impact data is invalid.',
};

export class SwapError extends Error {
  constructor(
    public readonly code: SwapErrorCode,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'SwapError';
  }
}

export function normalizeSwapError(error: unknown): SwapError {
  if (error instanceof SwapError) return error;
  return new SwapError('SWAP_PROVIDER_ERROR');
}