import type { AssetIdentity, AssetType, TokenMetadataStatus, TokenProvenance, TokenVerificationStatus } from '@/src/core/assets';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import type {
  SwapAllowanceRequirement,
  SwapAllowanceState,
  SwapFeeAmount,
  SwapPriceImpact,
  SwapProviderIssue,
  SwapQuote,
  SwapQuoteLifecycleState,
  SwapRoute,
  SwapTransactionRequest,
} from '../models';

export interface SwapReviewInput {
  readonly quote: SwapQuote;
  readonly quoteLifecycleState: SwapQuoteLifecycleState;
  readonly account: {
    readonly accountId: string;
    readonly address: string;
  };
  readonly network: EvmNetwork | null;
  readonly registeredNetwork: EvmNetwork | undefined;
  readonly activeNetworkId: string | null;
  readonly sellAsset: PortfolioAssetViewModel | null;
  readonly buyAsset: PortfolioAssetViewModel | null;
  readonly portfolio: PortfolioReadModel | null;
}

export interface SwapReviewAssetSnapshot {
  readonly identity: AssetIdentity;
  readonly assetType: AssetType;
  readonly networkId: string;
  readonly contractAddress: string | null;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly formattedBalance: string | null;
  readonly verificationStatus: TokenVerificationStatus;
  readonly metadataStatus: TokenMetadataStatus;
  readonly provenance: readonly TokenProvenance[];
}

export type SwapReviewBlockerCode =
  | 'SWAP_REVIEW_BALANCE_UNAVAILABLE'
  | 'SWAP_REVIEW_INSUFFICIENT_BALANCE'
  | 'SWAP_REVIEW_FEE_UNAVAILABLE'
  | 'SWAP_REVIEW_ALLOWANCE_UNAVAILABLE'
  | 'SWAP_REVIEW_PROVIDER_ISSUE';

export interface SwapReviewBlocker {
  readonly code: SwapReviewBlockerCode;
  readonly message: string;
}

export interface SwapReviewSnapshot {
  readonly status: 'ready';
  readonly createdAt: number;
  readonly quoteId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly senderAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly sellAsset: SwapReviewAssetSnapshot;
  readonly buyAsset: SwapReviewAssetSnapshot;
  readonly sellAmount: bigint;
  readonly sellAmountDisplay: string;
  readonly expectedBuyAmount: bigint;
  readonly expectedBuyAmountDisplay: string;
  readonly minimumBuyAmount: bigint;
  readonly minimumBuyAmountDisplay: string;
  readonly slippageBps: number;
  readonly route: SwapRoute;
  readonly priceImpact: SwapPriceImpact;
  readonly gasEstimate: bigint | null;
  readonly gasFee: SwapFeeAmount | null;
  readonly protocolFee: SwapFeeAmount | null;
  readonly providerFee: SwapFeeAmount | null;
  readonly integratorFee: SwapFeeAmount | null;
  readonly allowanceRequirement: SwapAllowanceRequirement | null;
  readonly allowanceState: SwapAllowanceState;
  readonly providerIssues: readonly SwapProviderIssue[];
  readonly transactionRequest: SwapTransactionRequest;
  readonly portfolioGeneratedAt: number;
  readonly approvalRequired: boolean;
  readonly blockers: readonly SwapReviewBlocker[];
  readonly canApprove: boolean;
  readonly reviewDigest: `0x${string}`;
}

export interface SwapReviewApproval {
  readonly status: 'approved-for-signing';
  readonly approvedAt: number;
  readonly reviewDigest: `0x${string}`;
  readonly quoteId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly senderAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly sellAsset: AssetIdentity;
  readonly buyAsset: AssetIdentity;
  readonly sellAmount: bigint;
  readonly expectedBuyAmount: bigint;
  readonly minimumBuyAmount: bigint;
  readonly slippageBps: number;
  readonly transactionRequest: SwapTransactionRequest;
  readonly allowanceRequirement: SwapAllowanceRequirement | null;
  readonly allowanceState: SwapAllowanceState;
}

export interface SwapReviewServiceOptions {
  readonly now?: () => number;
  readonly maxPortfolioAgeMs?: number;
}

export const DEFAULT_SWAP_REVIEW_MAX_PORTFOLIO_AGE_MS = 120_000;

export type SwapReviewContext = Pick<
  SwapReviewSnapshot,
  | 'quoteId'
  | 'providerId'
  | 'accountId'
  | 'senderAddress'
  | 'networkId'
  | 'chainId'
  | 'sellAsset'
  | 'buyAsset'
  | 'sellAmount'
  | 'expectedBuyAmount'
  | 'minimumBuyAmount'
  | 'slippageBps'
  | 'route'
  | 'priceImpact'
  | 'gasEstimate'
  | 'gasFee'
  | 'protocolFee'
  | 'providerFee'
  | 'integratorFee'
  | 'allowanceRequirement'
   | 'allowanceState'
  | 'providerIssues'
  | 'transactionRequest'
>;

export function assetSnapshot(asset: PortfolioAssetViewModel): SwapReviewAssetSnapshot {
  return Object.freeze({
    identity: Object.freeze({ ...asset.identity }),
    assetType: asset.assetType,
    networkId: asset.networkId,
    contractAddress: asset.contractAddress,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    formattedBalance: asset.formattedBalance,
    verificationStatus: asset.verificationStatus,
    metadataStatus: asset.metadataStatus,
    provenance: Object.freeze([...asset.provenance]),
  });
}