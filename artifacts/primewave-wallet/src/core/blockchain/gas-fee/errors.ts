export type GasFeeErrorCode =
  | 'INVALID_ADDRESS'
  | 'INVALID_VALUE'
  | 'INVALID_CALLDATA'
  | 'INVALID_QUANTITY'
  | 'INVALID_TRANSACTION_REQUEST'
  | 'ZERO_GAS_LIMIT'
  | 'ZERO_GAS_PRICE'
  | 'MISSING_FEE_DATA'
  | 'UNSUPPORTED_FEE_MODEL'
  | 'NETWORK_CHANGED'
  | 'CHAIN_ID_MISMATCH'
  | 'CONFIGURATION_ERROR'
  | 'ESTIMATION_FAILED'
  | 'RPC_TIMEOUT'
  | 'RPC_UNAVAILABLE'
  | 'RPC_MALFORMED_RESPONSE'
  | 'UNSUPPORTED_RPC_METHOD';

const SAFE_MESSAGES: Record<GasFeeErrorCode, string> = {
  INVALID_ADDRESS: 'A public EVM address is invalid.',
  INVALID_VALUE: 'The native transaction value is invalid.',
  INVALID_CALLDATA: 'The transaction calldata is invalid.',
  INVALID_QUANTITY: 'The RPC returned an invalid quantity.',
  INVALID_TRANSACTION_REQUEST: 'The public transaction request is invalid.',
  ZERO_GAS_LIMIT: 'The RPC returned a zero gas limit.',
  ZERO_GAS_PRICE: 'The RPC returned a zero gas price.',
  MISSING_FEE_DATA: 'Required fee data is unavailable on this network.',
  UNSUPPORTED_FEE_MODEL: 'This fee model is not supported by the network.',
  NETWORK_CHANGED: 'The selected network changed during the fee read.',
  CHAIN_ID_MISMATCH: 'The RPC endpoint belongs to a different network.',
  CONFIGURATION_ERROR: 'The gas and fee engine is not configured.',
  ESTIMATION_FAILED: 'The network rejected gas estimation.',
  RPC_TIMEOUT: 'The RPC request timed out.',
  RPC_UNAVAILABLE: 'The network is unavailable.',
  RPC_MALFORMED_RESPONSE: 'The RPC endpoint returned malformed data.',
  UNSUPPORTED_RPC_METHOD: 'This RPC method is not supported.',
};

export class GasFeeError extends Error {
  constructor(public readonly code: GasFeeErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'GasFeeError';
  }
}