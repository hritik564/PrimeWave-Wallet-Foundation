import type { AssetIdentity } from '@/src/core/assets';

export type SwapSlippageBps = number;

export interface SwapQuoteRequest {
  readonly accountId: string;
  readonly senderAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly sellAsset: AssetIdentity;
  readonly buyAsset: AssetIdentity;
  readonly sellAmount: bigint;
  readonly slippageBps: SwapSlippageBps;
}

export interface SwapTransactionRequest {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly data: `0x${string}`;
  readonly gasLimit: bigint | null;
}

export interface SwapFeeAmount {
  readonly amount: bigint;
  readonly asset: AssetIdentity;
}

export type SwapPriceImpact =
  | {
      readonly state: 'available';
      readonly bps: number;
    }
  | {
      readonly state: 'unavailable';
      readonly reason: 'not-provided' | 'unavailable';
    };

export interface SwapRouteHop {
  readonly inputAsset: AssetIdentity;
  readonly outputAsset: AssetIdentity;
  readonly poolOrVenue: string;
  readonly protocol: string;
}

export interface SwapRoute {
  readonly hops: readonly SwapRouteHop[];
}

export interface SwapQuote {
  readonly quoteId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly sellAsset: AssetIdentity;
  readonly buyAsset: AssetIdentity;
  readonly sellAmount: bigint;
  readonly expectedBuyAmount: bigint;
  readonly minimumBuyAmount: bigint;
  readonly slippageBps: SwapSlippageBps;
  readonly route: SwapRoute;
  readonly priceImpact: SwapPriceImpact;
  readonly gasEstimate: bigint | null;
  readonly gasFee: SwapFeeAmount | null;
  readonly protocolFee: SwapFeeAmount | null;
  readonly providerFee: SwapFeeAmount | null;
  readonly estimatedExecutionTime: number | null;
  readonly quotedAt: number;
  readonly expiresAt: number;
  readonly transactionRequest: SwapTransactionRequest;
}

export type SwapProviderCapability =
  | 'exact-input'
  | 'multi-hop-route'
  | 'transaction-request';

export interface SwapQuoteProviderMetadata {
  readonly providerId: string;
  readonly displayName: string;
  readonly supportedNetworks: readonly string[];
  readonly supportedCapabilities: readonly SwapProviderCapability[];
}

export interface SwapQuoteProvider {
  readonly metadata: SwapQuoteProviderMetadata;
  readonly getQuote: (request: SwapQuoteRequest) => Promise<unknown>;
}

export type SwapQuoteLifecycleState =
  | 'idle'
  | 'requesting'
  | 'quoted'
  | 'expired'
  | 'failed';

export interface SwapQuoteLifecycle {
  readonly state: SwapQuoteLifecycleState;
  readonly quote: SwapQuote | null;
  readonly errorCode: string | null;
}