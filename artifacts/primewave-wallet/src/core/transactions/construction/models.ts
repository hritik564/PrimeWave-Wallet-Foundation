import type { GasQuantityInput } from '@/src/core/blockchain/gas-fee';

export type TransactionType = 'native-transfer' | 'contract-call';
export type TransactionFeePreference = 'auto' | 'legacy' | 'eip1559';

export interface PublicWalletAccount {
  readonly accountId: string;
  readonly address: string;
}

export interface TransactionFeeConfiguration {
  readonly preference?: TransactionFeePreference;
}

export interface TransactionIntent {
  readonly networkId: string;
  readonly from: string;
  readonly to: string;
  readonly value: GasQuantityInput;
  readonly data?: string;
  readonly nonce?: GasQuantityInput;
  readonly gasLimit?: GasQuantityInput;
  readonly transactionType?: TransactionType;
  readonly fee?: TransactionFeeConfiguration;
}

export interface NormalizedTransactionIntent {
  readonly networkId: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly data: `0x${string}`;
  readonly nonce?: bigint;
  readonly gasLimit?: bigint;
  readonly transactionType: TransactionType;
  readonly feePreference: TransactionFeePreference;
}

export interface UnsignedTransactionBase {
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionType: TransactionType;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly data: `0x${string}`;
  readonly nonce: bigint;
  readonly gasLimit: bigint;
  readonly canonicalRepresentation: string;
}

export interface LegacyUnsignedTransaction extends UnsignedTransactionBase {
  readonly feeModel: 'legacy';
  readonly gasPrice: bigint;
}

export interface Eip1559UnsignedTransaction extends UnsignedTransactionBase {
  readonly feeModel: 'eip1559';
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export type UnsignedTransaction =
  | LegacyUnsignedTransaction
  | Eip1559UnsignedTransaction;

export interface TransactionPreviewBase {
  readonly networkName: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionType: TransactionType;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly valueDisplay: string;
  readonly data: `0x${string}`;
  readonly hasCalldata: boolean;
  readonly nonce: bigint;
  readonly gasLimit: bigint;
  readonly symbol: string;
  readonly decimals: number;
  readonly estimatedNetworkFee: bigint;
  readonly estimatedNetworkFeeDisplay: string;
  readonly totalMaximumNativeAmount: bigint;
  readonly totalMaximumNativeAmountDisplay: string;
  readonly warnings: readonly string[];
  readonly unsignedTransaction: UnsignedTransaction;
}

export interface LegacyTransactionPreview extends TransactionPreviewBase {
  readonly feeModel: 'legacy';
  readonly gasPrice: bigint;
}

export interface Eip1559TransactionPreview extends TransactionPreviewBase {
  readonly feeModel: 'eip1559';
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export type TransactionPreview =
  | LegacyTransactionPreview
  | Eip1559TransactionPreview;

export interface TransactionConstructionEngineOptions {
  readonly now?: () => number;
  readonly gasFeeEngine?: GasFeeEngineDependency;
  readonly accountStateService?: AccountStateDependency;
}

export interface GasFeeEngineDependency {
  estimateGas(
    request: {
      readonly from?: string;
      readonly to?: string;
      readonly value?: GasQuantityInput;
      readonly data?: string;
    },
  ): Promise<{
    readonly networkId: string;
    readonly chainId: bigint;
    readonly gasLimit: bigint;
  }>;
  getLegacyFeeData(): Promise<{
    readonly model: 'legacy';
    readonly networkId: string;
    readonly chainId: bigint;
    readonly gasPrice: bigint;
    readonly symbol: string;
    readonly decimals: number;
  }>;
  getEip1559FeeData(): Promise<{
    readonly model: 'eip1559';
    readonly networkId: string;
    readonly chainId: bigint;
    readonly baseFeePerGas: bigint;
    readonly maxPriorityFeePerGas: bigint;
    readonly maxFeePerGas: bigint;
    readonly symbol: string;
    readonly decimals: number;
  }>;
  getFeeData(): Promise<
    | {
        readonly model: 'legacy';
        readonly networkId: string;
        readonly chainId: bigint;
        readonly gasPrice: bigint;
        readonly symbol: string;
        readonly decimals: number;
      }
    | {
        readonly model: 'eip1559';
        readonly networkId: string;
        readonly chainId: bigint;
        readonly baseFeePerGas: bigint;
        readonly maxPriorityFeePerGas: bigint;
        readonly maxFeePerGas: bigint;
        readonly symbol: string;
        readonly decimals: number;
      }
    | {
        readonly model: 'unavailable';
        readonly networkId: string;
        readonly chainId: bigint;
        readonly reason: 'missing' | 'unsupported';
        readonly symbol: string;
        readonly decimals: number;
      }
  >;
}

export interface AccountStateDependency {
  getNonce(address: string): Promise<{
    readonly address: string;
    readonly networkId: string;
    readonly chainId: bigint;
    readonly value: bigint;
  }>;
}