export type TransactionConstructionErrorCode =
  | 'INVALID_TRANSACTION'
  | 'INVALID_FROM_ADDRESS'
  | 'UNKNOWN_ACCOUNT'
  | 'INVALID_RECIPIENT'
  | 'INVALID_VALUE'
  | 'INVALID_CALLDATA'
  | 'INVALID_NONCE'
  | 'INVALID_GAS_LIMIT'
  | 'NETWORK_NOT_SELECTED'
  | 'NETWORK_MISMATCH'
  | 'NETWORK_DISABLED'
  | 'NETWORK_NOT_CONFIGURED'
  | 'NETWORK_CHANGED'
  | 'CHAIN_ID_MISMATCH'
  | 'GAS_ESTIMATION_FAILED'
  | 'FEE_UNAVAILABLE'
  | 'UNSUPPORTED_FEE_MODEL'
  | 'RPC_TIMEOUT'
  | 'RPC_UNAVAILABLE'
  | 'RPC_MALFORMED_RESPONSE'
  | 'CONFIGURATION_ERROR'
  | 'CONSTRUCTION_FAILED';

const SAFE_MESSAGES: Record<TransactionConstructionErrorCode, string> = {
  INVALID_TRANSACTION: 'The transaction intent is invalid.',
  INVALID_FROM_ADDRESS: 'The sender address is invalid.',
  UNKNOWN_ACCOUNT: 'The sender is not a known local wallet account.',
  INVALID_RECIPIENT: 'The recipient address is invalid.',
  INVALID_VALUE: 'The native transaction value is invalid.',
  INVALID_CALLDATA: 'The transaction calldata is invalid.',
  INVALID_NONCE: 'The transaction nonce is invalid.',
  INVALID_GAS_LIMIT: 'The gas limit is invalid.',
  NETWORK_NOT_SELECTED: 'A network must be selected before construction.',
  NETWORK_MISMATCH: 'The transaction network does not match the selected network.',
  NETWORK_DISABLED: 'The selected network is disabled.',
  NETWORK_NOT_CONFIGURED: 'The selected network is not configured.',
  NETWORK_CHANGED: 'The selected network changed during construction.',
  CHAIN_ID_MISMATCH: 'The RPC endpoint belongs to a different network.',
  GAS_ESTIMATION_FAILED: 'The network rejected gas estimation.',
  FEE_UNAVAILABLE: 'Fee data is unavailable on the selected network.',
  UNSUPPORTED_FEE_MODEL: 'The requested fee model is not supported.',
  RPC_TIMEOUT: 'The RPC request timed out.',
  RPC_UNAVAILABLE: 'The network is unavailable.',
  RPC_MALFORMED_RESPONSE: 'The RPC endpoint returned malformed data.',
  CONFIGURATION_ERROR: 'The transaction engine is not configured.',
  CONSTRUCTION_FAILED: 'The unsigned transaction could not be constructed.',
};

export class TransactionConstructionError extends Error {
  constructor(public readonly code: TransactionConstructionErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'TransactionConstructionError';
  }
}