export type TransactionBroadcastErrorCode =
  | 'BROADCAST_NETWORK_UNAVAILABLE'
  | 'BROADCAST_TIMEOUT'
  | 'BROADCAST_RPC_ERROR'
  | 'BROADCAST_REJECTED'
  | 'BROADCAST_MALFORMED_RESPONSE'
  | 'BROADCAST_CHAIN_MISMATCH'
  | 'BROADCAST_NETWORK_CHANGED'
  | 'BROADCAST_INVALID_TRANSACTION'
  | 'BROADCAST_HASH_MISMATCH'
  | 'BROADCAST_ALREADY_IN_PROGRESS'
  | 'BROADCAST_UNKNOWN_RESULT'
  | 'BROADCAST_NOT_INITIALIZED';

export interface TransactionBroadcastErrorDetails {
  readonly method?: string;
  readonly rpcCode?: number;
}

const SAFE_MESSAGES: Record<TransactionBroadcastErrorCode, string> = {
  BROADCAST_NETWORK_UNAVAILABLE: 'The broadcast network is unavailable.',
  BROADCAST_TIMEOUT:
    'The broadcast or confirmation request timed out; the result may be unknown.',
  BROADCAST_RPC_ERROR: 'The RPC provider could not complete the request.',
  BROADCAST_REJECTED: 'The RPC provider rejected the transaction.',
  BROADCAST_MALFORMED_RESPONSE:
    'The RPC provider returned a malformed response.',
  BROADCAST_CHAIN_MISMATCH:
    'The signed transaction does not match the selected chain.',
  BROADCAST_NETWORK_CHANGED:
    'The selected network changed before broadcasting.',
  BROADCAST_INVALID_TRANSACTION: 'The signed transaction is invalid.',
  BROADCAST_HASH_MISMATCH:
    'The transaction hash did not match the signed transaction.',
  BROADCAST_ALREADY_IN_PROGRESS:
    'A broadcast for this transaction is already in progress.',
  BROADCAST_UNKNOWN_RESULT:
    'The broadcast result is unknown and requires reconciliation.',
  BROADCAST_NOT_INITIALIZED: 'The RPC provider is not initialized.',
};

export class TransactionBroadcastError extends Error {
  constructor(
    public readonly code: TransactionBroadcastErrorCode,
    public readonly details?: TransactionBroadcastErrorDetails,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'TransactionBroadcastError';
  }
}