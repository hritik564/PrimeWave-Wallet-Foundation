export type TransactionSigningErrorCode =
  | 'SIGNING_NOT_AUTHENTICATED'
  | 'SIGNING_NOT_AUTHORIZED'
  | 'SIGNING_TRANSACTION_MISMATCH'
  | 'SIGNING_ACCOUNT_MISMATCH'
  | 'SIGNING_NETWORK_MISMATCH'
  | 'SIGNING_CHAIN_MISMATCH'
  | 'SIGNING_INVALID_TRANSACTION'
  | 'SIGNING_UNSUPPORTED_TRANSACTION'
  | 'SIGNING_VAULT_UNAVAILABLE'
  | 'SIGNING_KEY_ACCESS_FAILED'
  | 'SIGNING_FAILED'
  | 'SIGNING_CANCELLED'
  | 'SIGNING_CONCURRENT'
  | 'SIGNING_NETWORK_CHANGED';

const SAFE_MESSAGES: Record<TransactionSigningErrorCode, string> = {
  SIGNING_NOT_AUTHENTICATED: 'Wallet authentication is required before signing.',
  SIGNING_NOT_AUTHORIZED: 'Explicit transaction authorization is required.',
  SIGNING_TRANSACTION_MISMATCH: 'The transaction does not match its authorization.',
  SIGNING_ACCOUNT_MISMATCH: 'The signing account does not match the authorized sender.',
  SIGNING_NETWORK_MISMATCH: 'The transaction network does not match the selected network.',
  SIGNING_CHAIN_MISMATCH: 'The transaction chain does not match the selected chain.',
  SIGNING_INVALID_TRANSACTION: 'The unsigned transaction is invalid.',
  SIGNING_UNSUPPORTED_TRANSACTION: 'The unsigned transaction type is unsupported.',
  SIGNING_VAULT_UNAVAILABLE: 'Secure wallet storage is unavailable.',
  SIGNING_KEY_ACCESS_FAILED: 'The wallet signing key could not be accessed.',
  SIGNING_FAILED: 'The transaction could not be signed.',
  SIGNING_CANCELLED: 'Transaction signing was cancelled.',
  SIGNING_CONCURRENT: 'Another transaction signing operation is in progress.',
  SIGNING_NETWORK_CHANGED: 'The selected network changed during signing.',
};

export class TransactionSigningError extends Error {
  constructor(public readonly code: TransactionSigningErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'TransactionSigningError';
  }
}