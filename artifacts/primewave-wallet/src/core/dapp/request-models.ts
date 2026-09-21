import type {
  DAppCapability,
  DAppRequestContext,
  DAppRequestType,
} from './models';

export interface DAppConnectPayload {
  readonly kind: 'connect';
  readonly requestedCapabilities: readonly DAppCapability[];
}

export interface DAppDisconnectPayload {
  readonly kind: 'disconnect';
  readonly reason: string | null;
}

export interface DAppAccountAccessPayload {
  readonly kind: 'account-access';
  readonly requestedAccountId: string | null;
}

export interface DAppNetworkInformationPayload {
  readonly kind: 'network-information';
  readonly requestedNetworkId: string | null;
}

export interface DAppMessageSigningPayload {
  readonly kind: 'message-signing';
  readonly message: string;
  readonly method?: 'personal_sign';
  readonly rawPayload?: string;
  readonly encoding?: 'hex' | 'utf8';
  readonly displayWasNormalized?: boolean;
  readonly displayWasTruncated?: boolean;
}

export interface DAppTypedDataSigningPayload {
  readonly kind: 'typed-data-signing';
  /**
   * The exact provider-supplied typed-data payload. It is intentionally not
   * parsed or rewritten by the architecture layer.
   */
  readonly typedData: string;
  readonly method?: 'eth_signTypedData' | 'eth_signTypedData_v4';
  readonly displayWasTruncated?: boolean;
}

export interface DAppTransactionIntent {
  readonly kind: 'transaction';
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly calldata: `0x${string}`;
  readonly chainId: bigint;
  readonly gasLimit: bigint | null;
  readonly nonce: bigint | null;
  readonly gasPrice: bigint | null;
  readonly maxFeePerGas: bigint | null;
  readonly maxPriorityFeePerGas: bigint | null;
  readonly feePreference: 'auto' | 'legacy' | 'eip1559';
  readonly transactionType: 'legacy' | 'eip1559' | null;
}

export interface DAppChainRequestPayload {
  readonly kind: 'chain-request';
  readonly requestedNetworkId: string;
  readonly requestedChainId: bigint;
  readonly activeNetworkId: string;
  readonly activeChainId: bigint;
  readonly sessionApprovedNetworkIds: readonly string[];
  readonly configured: boolean;
  readonly enabled: boolean;
}

export type DAppRequestPayload =
  | DAppConnectPayload
  | DAppDisconnectPayload
  | DAppAccountAccessPayload
  | DAppNetworkInformationPayload
  | DAppMessageSigningPayload
  | DAppTypedDataSigningPayload
  | DAppTransactionIntent
  | DAppChainRequestPayload;

export interface DAppRequest extends DAppRequestContext {
  readonly payload: DAppRequestPayload;
}

export type DAppRequestInput = Omit<DAppRequest, 'status'> & {
  readonly status?: DAppRequest['status'];
};

export type DAppTransactionRequest = DAppRequest & {
  readonly requestType: 'transaction';
  readonly payload: DAppTransactionIntent;
};

export type DAppMessageSigningRequest = DAppRequest & {
  readonly requestType: 'message-signing';
  readonly payload: DAppMessageSigningPayload;
};

export type DAppTypedDataSigningRequest = DAppRequest & {
  readonly requestType: 'typed-data-signing';
  readonly payload: DAppTypedDataSigningPayload;
};