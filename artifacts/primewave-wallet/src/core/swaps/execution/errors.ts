export type SwapExecutionErrorCode =
  | 'SWAP_EXECUTION_PREVIEW_BLOCKED'
  | 'SWAP_EXECUTION_REVIEW_STALE'
  | 'SWAP_EXECUTION_QUOTE_EXPIRED'
  | 'SWAP_EXECUTION_ACCOUNT_MISMATCH'
  | 'SWAP_EXECUTION_NETWORK_CHANGED'
  | 'SWAP_EXECUTION_CHAIN_MISMATCH'
  | 'SWAP_EXECUTION_ALLOWANCE_UNAVAILABLE'
  | 'SWAP_EXECUTION_ALLOWANCE_CHANGED'
  | 'SWAP_EXECUTION_APPROVAL_TARGET_INVALID'
  | 'SWAP_EXECUTION_APPROVAL_AMOUNT_INVALID'
  | 'SWAP_EXECUTION_APPROVAL_TRANSACTION_MISMATCH'
  | 'SWAP_EXECUTION_PROVIDER_TRANSACTION_CHANGED'
  | 'SWAP_EXECUTION_CONSTRUCTION_FAILED'
  | 'SWAP_EXECUTION_SIGNING_FAILED'
  | 'SWAP_EXECUTION_BROADCAST_FAILED'
  | 'SWAP_EXECUTION_UNKNOWN';

const MESSAGES: Record<SwapExecutionErrorCode, string> = {
  SWAP_EXECUTION_PREVIEW_BLOCKED: 'Preview Test Mode cannot authenticate, sign, approve, broadcast, or fabricate execution results.',
  SWAP_EXECUTION_REVIEW_STALE: 'The approved swap review is no longer current. Request a fresh quote and review.',
  SWAP_EXECUTION_QUOTE_EXPIRED: 'The swap quote expired before execution. Request a fresh quote and review.',
  SWAP_EXECUTION_ACCOUNT_MISMATCH: 'The active account no longer matches the approved swap.',
  SWAP_EXECUTION_NETWORK_CHANGED: 'The selected network changed before execution.',
  SWAP_EXECUTION_CHAIN_MISMATCH: 'The approved swap chain no longer matches the selected network.',
  SWAP_EXECUTION_ALLOWANCE_UNAVAILABLE: 'The current token allowance is unavailable. Request a fresh quote.',
  SWAP_EXECUTION_ALLOWANCE_CHANGED: 'The token allowance changed after review. Request a fresh quote and review.',
  SWAP_EXECUTION_APPROVAL_TARGET_INVALID: 'The provider approval target cannot be safely bound to this token review.',
  SWAP_EXECUTION_APPROVAL_AMOUNT_INVALID: 'The approval amount is invalid or is not the exact reviewed amount.',
  SWAP_EXECUTION_APPROVAL_TRANSACTION_MISMATCH: 'The approval transaction no longer matches its dedicated approval review.',
  SWAP_EXECUTION_PROVIDER_TRANSACTION_CHANGED: 'The provider transaction changed after review. Nothing was signed.',
  SWAP_EXECUTION_CONSTRUCTION_FAILED: 'The execution transaction could not be constructed.',
  SWAP_EXECUTION_SIGNING_FAILED: 'The transaction could not be signed.',
  SWAP_EXECUTION_BROADCAST_FAILED: 'The transaction could not be broadcast.',
  SWAP_EXECUTION_UNKNOWN: 'The transaction result is unknown and requires reconciliation. Do not rebroadcast automatically.',
};

export class SwapExecutionError extends Error {
  constructor(public readonly code: SwapExecutionErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SwapExecutionError';
  }
}