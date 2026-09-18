export type SwapReviewErrorCode =
  | 'SWAP_REVIEW_QUOTE_STALE'
  | 'SWAP_REVIEW_QUOTE_EXPIRED'
  | 'SWAP_REVIEW_ACCOUNT_MISMATCH'
  | 'SWAP_REVIEW_SENDER_MISMATCH'
  | 'SWAP_REVIEW_NETWORK_MISMATCH'
  | 'SWAP_REVIEW_CHAIN_MISMATCH'
  | 'SWAP_REVIEW_ASSET_MISMATCH'
  | 'SWAP_REVIEW_AMOUNT_MISMATCH'
  | 'SWAP_REVIEW_SLIPPAGE_MISMATCH'
  | 'SWAP_REVIEW_TRANSACTION_INVALID'
  | 'SWAP_REVIEW_TRANSACTION_TARGET_INVALID'
  | 'SWAP_REVIEW_CALLDATA_INVALID'
  | 'SWAP_REVIEW_BALANCE_UNAVAILABLE'
  | 'SWAP_REVIEW_INSUFFICIENT_BALANCE'
  | 'SWAP_REVIEW_FEE_UNAVAILABLE'
  | 'SWAP_REVIEW_ALLOWANCE_UNSUPPORTED'
  | 'SWAP_REVIEW_ALLOWANCE_UNAVAILABLE'
  | 'SWAP_REVIEW_PROVIDER_ISSUE'
  | 'SWAP_REVIEW_PORTFOLIO_STALE'
  | 'SWAP_REVIEW_UNSUPPORTED_SIGNING_MECHANISM';

const MESSAGES: Record<SwapReviewErrorCode, string> = {
  SWAP_REVIEW_QUOTE_STALE: 'This quote no longer matches the current swap context. Return to Swap for a fresh quote.',
  SWAP_REVIEW_QUOTE_EXPIRED: 'This quote expired. Return to Swap and request a current quote.',
  SWAP_REVIEW_ACCOUNT_MISMATCH: 'This quote belongs to a different wallet account.',
  SWAP_REVIEW_SENDER_MISMATCH: 'The quote sender does not match the current public wallet address.',
  SWAP_REVIEW_NETWORK_MISMATCH: 'The quote does not match the selected network.',
  SWAP_REVIEW_CHAIN_MISMATCH: 'The quote chain does not match the selected network chain.',
  SWAP_REVIEW_ASSET_MISMATCH: 'The reviewed assets no longer match the selected swap pair.',
  SWAP_REVIEW_AMOUNT_MISMATCH: 'The reviewed sell amount no longer matches the quote.',
  SWAP_REVIEW_SLIPPAGE_MISMATCH: 'The reviewed slippage no longer matches the quote.',
  SWAP_REVIEW_TRANSACTION_INVALID: 'The provider transaction request is invalid for review.',
  SWAP_REVIEW_TRANSACTION_TARGET_INVALID: 'The provider transaction target is invalid.',
  SWAP_REVIEW_CALLDATA_INVALID: 'The provider calldata is malformed or too large to review.',
  SWAP_REVIEW_BALANCE_UNAVAILABLE: 'A fresh relevant balance is unavailable. Approval is blocked.',
  SWAP_REVIEW_INSUFFICIENT_BALANCE: 'The current balance does not cover the reviewed swap and required network fee.',
  SWAP_REVIEW_FEE_UNAVAILABLE: 'Required network fee information is unavailable. Approval is blocked.',
  SWAP_REVIEW_ALLOWANCE_UNSUPPORTED: 'This allowance mechanism is not supported for review.',
  SWAP_REVIEW_ALLOWANCE_UNAVAILABLE: 'The current token allowance is unavailable. Refresh the quote before approval.',
  SWAP_REVIEW_PROVIDER_ISSUE: 'The quote provider reported an issue that blocks approval.',
  SWAP_REVIEW_PORTFOLIO_STALE: 'The public balance snapshot is stale. Refresh balances before approval.',
  SWAP_REVIEW_UNSUPPORTED_SIGNING_MECHANISM: 'This provider signing mechanism is deferred to a later phase.',
};

export class SwapReviewError extends Error {
  constructor(public readonly code: SwapReviewErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SwapReviewError';
  }
}

export function isSwapReviewError(error: unknown): error is SwapReviewError {
  return error instanceof SwapReviewError;
}