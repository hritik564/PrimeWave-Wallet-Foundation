export type AssetErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'ASSET_UNSUPPORTED'
  | 'ASSET_NETWORK_NOT_CONFIGURED'
  | 'ASSET_NETWORK_DISABLED'
  | 'ASSET_INVALID_METADATA'
  | 'ASSET_DUPLICATE_IDENTITY'
  | 'BALANCE_NETWORK_UNAVAILABLE'
  | 'BALANCE_INVALID_ADDRESS'
  | 'BALANCE_NETWORK_CHANGED'
  | 'BALANCE_CHAIN_MISMATCH'
  | 'BALANCE_RPC_FAILURE'
  | 'BALANCE_CONFIGURATION_ERROR'
  | 'INVALID_AMOUNT'
  | 'DECIMAL_OVERFLOW'
  | 'MALFORMED_AMOUNT'
  | 'TOKEN_INVALID_ADDRESS'
  | 'TOKEN_NOT_A_CONTRACT'
  | 'TOKEN_METADATA_UNAVAILABLE'
  | 'TOKEN_METADATA_INVALID'
  | 'TOKEN_INVALID_DECIMALS'
  | 'TOKEN_BALANCE_UNAVAILABLE'
  | 'TOKEN_CONTRACT_CALL_FAILED'
  | 'TOKEN_NETWORK_CHANGED'
  | 'TOKEN_CHAIN_MISMATCH'
  | 'TOKEN_NETWORK_UNAVAILABLE'
  | 'TOKEN_UNSUPPORTED'
  | 'TOKEN_RPC_ERROR'
  | 'TOKEN_DUPLICATE_IDENTITY';

const SAFE_MESSAGES: Record<AssetErrorCode, string> = {
  ASSET_NOT_FOUND: 'The requested asset was not found.',
  ASSET_UNSUPPORTED: 'The requested asset type is not supported.',
  ASSET_NETWORK_NOT_CONFIGURED: 'The requested network is not configured.',
  ASSET_NETWORK_DISABLED: 'The requested network is disabled.',
  ASSET_INVALID_METADATA: 'The asset metadata is invalid.',
  ASSET_DUPLICATE_IDENTITY: 'The asset identity is duplicated.',
  BALANCE_NETWORK_UNAVAILABLE: 'The balance network is unavailable.',
  BALANCE_INVALID_ADDRESS: 'The public account address is invalid.',
  BALANCE_NETWORK_CHANGED: 'The selected network changed during the read.',
  BALANCE_CHAIN_MISMATCH: 'The balance response belongs to a different chain.',
  BALANCE_RPC_FAILURE: 'The balance provider could not complete the read.',
  BALANCE_CONFIGURATION_ERROR: 'The balance service is not configured.',
  INVALID_AMOUNT: 'The asset amount is invalid.',
  DECIMAL_OVERFLOW: 'The asset amount is too large.',
  MALFORMED_AMOUNT: 'The asset amount format is invalid.',
  TOKEN_INVALID_ADDRESS: 'The token contract address is invalid.',
  TOKEN_NOT_A_CONTRACT: 'The token address is not a contract.',
  TOKEN_METADATA_UNAVAILABLE: 'Token metadata is unavailable.',
  TOKEN_METADATA_INVALID: 'Token metadata is invalid.',
  TOKEN_INVALID_DECIMALS: 'The token decimals are invalid.',
  TOKEN_BALANCE_UNAVAILABLE: 'The token balance is unavailable.',
  TOKEN_CONTRACT_CALL_FAILED: 'The token read call failed.',
  TOKEN_NETWORK_CHANGED: 'The token network changed during the read.',
  TOKEN_CHAIN_MISMATCH: 'The token response belongs to a different chain.',
  TOKEN_NETWORK_UNAVAILABLE: 'The token network is unavailable.',
  TOKEN_UNSUPPORTED: 'The token operation is not supported.',
  TOKEN_RPC_ERROR: 'The token provider returned an error.',
  TOKEN_DUPLICATE_IDENTITY: 'The token identity is duplicated.',
};

export class AssetError extends Error {
  constructor(
    public readonly code: AssetErrorCode,
    message = SAFE_MESSAGES[code],
  ) {
    super(message);
    this.name = 'AssetError';
  }
}