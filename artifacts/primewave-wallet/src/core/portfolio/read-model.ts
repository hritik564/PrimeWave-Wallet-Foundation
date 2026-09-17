import type {
  AssetIdentity,
  AssetType,
  TokenMetadataStatus,
  TokenProvenance,
  TokenVerificationStatus,
} from '@/src/core/assets';
import type { AssetIcon } from './models';

export type PortfolioBalanceState = 'positive' | 'zero' | 'unavailable';

export type PortfolioAvailabilityState =
  | 'available'
  | 'unavailable'
  | 'stale'
  | 'invalid';

export type PortfolioReadModelState =
  | 'ready'
  | 'partial'
  | 'unavailable'
  | 'invalid';

export type PortfolioReadModelWarningCode =
  | 'ASSET_BALANCE_UNAVAILABLE'
  | 'ASSET_METADATA_INCOMPLETE';

export interface PortfolioReadModelWarning {
  readonly code: PortfolioReadModelWarningCode;
  readonly assetIdentity: AssetIdentity;
  readonly message: string;
}

export interface PortfolioAssetViewModel {
  readonly identity: AssetIdentity;
  readonly assetType: AssetType;
  readonly networkId: string;
  readonly contractAddress: string | null;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly rawBalance: bigint | null;
  readonly formattedBalance: string | null;
  readonly visibility: 'visible' | 'hidden';
  readonly verificationStatus: TokenVerificationStatus;
  readonly metadataStatus: TokenMetadataStatus;
  readonly provenance: readonly TokenProvenance[];
  readonly icon: AssetIcon;
  readonly balanceState: PortfolioBalanceState;
  readonly availabilityState: PortfolioAvailabilityState;
}

export interface PortfolioReadModel {
  readonly accountId: string;
  readonly accountAddress: string;
  readonly networkId: string;
  readonly networkName: string;
  readonly chainId: number;
  readonly generatedAt: number;
  readonly totalAssetCount: number;
  readonly visibleAssetCount: number;
  readonly assets: readonly PortfolioAssetViewModel[];
  readonly warnings: readonly PortfolioReadModelWarning[];
  readonly state: PortfolioReadModelState;
}

export interface PortfolioReadModelQuery {
  readonly accountId: string;
  readonly accountAddress: unknown;
  readonly networkId: string;
  readonly includeHidden?: boolean;
  readonly tokenIdentities?: readonly AssetIdentity[];
}