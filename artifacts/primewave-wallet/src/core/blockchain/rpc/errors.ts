export type RpcProviderErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'ENDPOINT_UNAVAILABLE'
  | 'NETWORK_UNAVAILABLE'
  | 'TIMEOUT'
  | 'HTTP_FAILURE'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_RESPONSE'
  | 'JSON_RPC_ERROR'
  | 'UNSUPPORTED_METHOD'
  | 'CHAIN_ID_MISMATCH'
  | 'PROVIDER_NOT_INITIALIZED';

export interface RpcProviderErrorDetails {
  readonly endpointId?: string;
  readonly method?: string;
  readonly status?: number;
  readonly rpcCode?: number;
}

const SAFE_MESSAGES: Record<RpcProviderErrorCode, string> = {
  CONFIGURATION_ERROR: 'The RPC provider configuration is invalid.',
  ENDPOINT_UNAVAILABLE: 'No usable RPC endpoint is available.',
  NETWORK_UNAVAILABLE: 'The network is unavailable.',
  TIMEOUT: 'The RPC request timed out.',
  HTTP_FAILURE: 'The RPC endpoint returned an HTTP failure.',
  MALFORMED_RESPONSE: 'The RPC endpoint returned malformed data.',
  INVALID_RESPONSE: 'The RPC endpoint returned an invalid response.',
  JSON_RPC_ERROR: 'The RPC endpoint rejected the request.',
  UNSUPPORTED_METHOD: 'This RPC method is not supported.',
  CHAIN_ID_MISMATCH: 'The RPC endpoint belongs to a different network.',
  PROVIDER_NOT_INITIALIZED: 'The RPC provider is not initialized.',
};

export class RpcProviderError extends Error {
  constructor(
    public readonly code: RpcProviderErrorCode,
    details?: RpcProviderErrorDetails,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'RpcProviderError';
    this.details = details;
  }

  readonly details: RpcProviderErrorDetails | undefined;
}