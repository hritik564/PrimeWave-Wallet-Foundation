import type { EvmNetwork } from '@/src/core/networks/types';
import type { HexQuantity } from '@/src/core/blockchain/rpc';

export type GasQuantityInput = bigint | HexQuantity | string;

export interface GasEstimationRequest {
  readonly from?: string;
  readonly to?: string;
  readonly value?: GasQuantityInput;
  readonly data?: string;
}

export interface NormalizedGasEstimationRequest {
  readonly from?: string;
  readonly to?: string;
  readonly value?: HexQuantity;
  readonly data?: `0x${string}`;
}

export interface GasEstimate {
  readonly request: NormalizedGasEstimationRequest;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly gasLimit: bigint;
}

export type FeeModel = 'legacy' | 'eip1559' | 'unavailable';
export type FeeModelPreference = 'auto' | Exclude<FeeModel, 'unavailable'>;

export interface FeeCurrency {
  readonly symbol: string;
  readonly decimals: number;
}

export interface LegacyFeeData extends FeeCurrency {
  readonly model: 'legacy';
  readonly networkId: string;
  readonly chainId: bigint;
  readonly gasPrice: bigint;
}

export interface Eip1559FeeData extends FeeCurrency {
  readonly model: 'eip1559';
  readonly networkId: string;
  readonly chainId: bigint;
  readonly baseFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly maxFeePerGas: bigint;
}

export interface UnavailableFeeData extends FeeCurrency {
  readonly model: 'unavailable';
  readonly networkId: string;
  readonly chainId: bigint;
  readonly reason: 'missing' | 'unsupported';
}

export type FeeData = LegacyFeeData | Eip1559FeeData | UnavailableFeeData;

interface FeeQuoteBase extends FeeCurrency {
  readonly request: NormalizedGasEstimationRequest;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly gasLimit: bigint;
  readonly estimatedNetworkFee: bigint;
  readonly estimatedNetworkFeeDisplay: string;
}

export interface LegacyFeeQuote extends FeeQuoteBase {
  readonly model: 'legacy';
  readonly gasPrice: bigint;
}

export interface Eip1559FeeQuote extends FeeQuoteBase {
  readonly model: 'eip1559';
  readonly baseFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly maxFeePerGas: bigint;
}

export type FeeQuote = LegacyFeeQuote | Eip1559FeeQuote;

export interface GasFeeEngineOptions {
  readonly now?: () => number;
}

export type GasFeeNetworkContext = {
  readonly network: EvmNetwork;
  readonly networkId: string;
  readonly chainId: bigint;
};