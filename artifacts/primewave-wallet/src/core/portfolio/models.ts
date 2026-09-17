import type {
  AssetIdentity,
  AssetErrorCode,
  ERC20Token,
  NativeAsset,
  NetworkBoundTokenReadService,
  TokenMetadataStatus,
  TokenVerificationStatus,
  TokenAssetIdentity,
} from '@/src/core/assets';
import type {
  TokenCandidate,
  TokenDiscoveryState,
  TokenProvenance,
} from '@/src/core/assets';

export type PortfolioAssetStatus =
  | 'available'
  | 'unavailable'
  | 'metadata_unavailable'
  | 'balance_unavailable';

export type PortfolioAssetSource =
  | 'native'
  | 'registry'
  | 'user_added'
  | 'discovered';

export type PortfolioVisibility = 'visible' | 'hidden';

export type AssetIconSource =
  | 'curated_registry'
  | 'trusted_external_source'
  | 'user_provided'
  | 'none';

export type AssetIconStatus = 'available' | 'unavailable';

export type AssetIconFallbackType =
  | 'native_currency'
  | 'asset_initials'
  | 'identity';

export interface AssetIconFallback {
  readonly type: AssetIconFallbackType;
  readonly initials: string;
  readonly deterministicId: `0x${string}`;
}

export interface AssetIcon {
  readonly source: AssetIconSource;
  readonly status: AssetIconStatus;
  readonly reference: string | null;
  readonly dimensions: {
    readonly width: number;
    readonly height: number;
  } | null;
  readonly provenance: AssetIconSource;
  readonly fallback: AssetIconFallback;
}

export type TokenLogo = AssetIcon;

export interface PortfolioAccount {
  readonly accountId: string;
  readonly address: string;
}

export interface PortfolioNetwork {
  readonly networkId: string;
  readonly chainId: number;
  readonly displayName: string;
  readonly nativeCurrencySymbol: string;
}

export interface PortfolioAssetBalance {
  readonly rawAmount: bigint | null;
  readonly decimals: number | null;
  readonly formattedAmount: string | null;
  readonly hasBalance: boolean | null;
  readonly blockNumber: bigint | null;
  readonly blockHash: string | null;
  readonly retrievedAtMs: number | null;
}

export interface PortfolioAsset {
  readonly identity: AssetIdentity;
  readonly networkId: string;
  readonly accountId: string;
  readonly asset: NativeAsset | ERC20Token;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly metadataStatus: TokenMetadataStatus | 'complete';
  readonly verificationStatus: TokenVerificationStatus | null;
  readonly discoveryState: TokenDiscoveryState | null;
  readonly sources: readonly PortfolioAssetSource[];
  readonly provenance: readonly TokenProvenance[];
  readonly visibility: PortfolioVisibility;
  readonly status: PortfolioAssetStatus;
  readonly errorCode: AssetErrorCode | null;
  readonly icon: AssetIcon;
  readonly balance: PortfolioAssetBalance;
}

export interface PortfolioSummary {
  readonly networksRepresented: number;
  readonly visibleAssetCount: number;
  readonly hiddenAssetCount: number;
  readonly assetsWithBalances: number;
  readonly nativeAssetCount: number;
  readonly fungibleTokenCount: number;
  readonly unavailableAssetCount: number;
}

export interface Portfolio {
  readonly kind: 'portfolio';
  readonly account: PortfolioAccount;
  readonly networks: readonly PortfolioNetwork[];
  readonly assets: readonly PortfolioAsset[];
  readonly summary: PortfolioSummary;
  readonly refreshedAtMs: number;
}

export interface PortfolioQuery {
  readonly accountId: string;
  readonly accountAddress: unknown;
  readonly networkIds: readonly string[];
  readonly tokenIdentities?: readonly AssetIdentity[];
  readonly includeHidden?: boolean;
}

export interface PortfolioNetworkReadService
  extends NetworkBoundTokenReadService {}

export interface PortfolioAggregationServiceOptions {
  readonly now?: () => number;
  readonly tokenDiscoveryService?: Pick<
    import('@/src/core/assets').TokenDiscoveryService,
    'getCandidate'
  >;
  readonly maxNetworks?: number;
  readonly maxAssets?: number;
  readonly maxTokensPerNetwork?: number;
}