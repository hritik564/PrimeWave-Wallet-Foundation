import type { EvmAccountStateService } from '@/src/core/blockchain/account-state';
import type { EvmRpcProvider } from '@/src/core/blockchain/rpc';

export type AssetType = 'native' | 'fungible_token' | 'nft';
export type NativeAssetId = 'native';
export type AssetAvailabilityStatus =
  | 'available'
  | 'unconfigured'
  | 'disabled'
  | 'unsupported';

export interface AssetIdentity {
  readonly assetType: AssetType;
  readonly networkId: string;
  readonly assetId: string;
}

export interface NativeAsset extends AssetIdentity {
  readonly assetType: 'native';
  readonly assetId: NativeAssetId;
  readonly chainId: number;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly nativeCurrencyIdentifier: NativeAssetId;
  readonly enabled: true;
  readonly status: 'available';
}

export interface AssetAvailability {
  readonly identity: AssetIdentity;
  readonly networkId: string;
  readonly chainId: number | null;
  readonly status: AssetAvailabilityStatus;
}

export interface NativeAssetBalanceRequest {
  readonly networkId: string;
  readonly accountId: string;
  readonly address: unknown;
}

export interface NativeAssetBalance {
  readonly kind: 'native-asset-balance';
  readonly asset: NativeAsset;
  readonly assetIdentity: AssetIdentity;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly accountId: string;
  readonly address: string;
  readonly rawBalance: bigint;
  readonly decimals: number;
  readonly symbol: string;
  readonly displayAmount: string;
  readonly blockNumber: bigint | null;
  readonly blockHash: string | null;
  readonly retrievedAtMs: number;
}

export interface NativeAssetBalanceServiceOptions {
  readonly now?: () => number;
}

export interface NetworkBoundAccountStateService {
  readonly service: Pick<
    EvmAccountStateService,
    'getNetwork' | 'getNativeBalance' | 'assertNetworkContext'
  >;
}

export type TokenMetadataStatus =
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'invalid';

export type TokenVerificationStatus = 'unknown' | 'unverified' | 'verified';

export type TokenAvailabilityStatus =
  | 'available'
  | 'unconfigured'
  | 'disabled'
  | 'unsupported';

export interface TokenAssetIdentity extends AssetIdentity {
  readonly assetType: 'fungible_token';
  readonly contractAddress: string;
}

export interface ERC20Token extends TokenAssetIdentity {
  readonly chainId: number;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly metadataStatus: TokenMetadataStatus;
  readonly verificationStatus: TokenVerificationStatus;
  readonly availabilityStatus: 'available';
}

export interface TokenRequest {
  readonly networkId: string;
  readonly contractAddress: unknown;
}

export interface TokenBalanceRequest extends TokenRequest {
  readonly accountId: string;
  readonly accountAddress: unknown;
  readonly token?: ERC20Token;
}

export interface TokenBalance {
  readonly kind: 'erc20-token-balance';
  readonly asset: ERC20Token;
  readonly assetIdentity: TokenAssetIdentity;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly accountId: string;
  readonly contractAddress: string;
  readonly accountAddress: string;
  readonly rawBalance: bigint;
  readonly decimals: number;
  readonly displayAmount: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly metadataStatus: TokenMetadataStatus;
  readonly verificationStatus: TokenVerificationStatus;
  readonly blockNumber: bigint | null;
  readonly blockHash: string | null;
  readonly retrievedAtMs: number;
}

export interface NetworkBoundTokenReadService {
  readonly accountState: Pick<
    EvmAccountStateService,
    'getNetwork' | 'getContractCode' | 'assertNetworkContext'
  >;
  readonly provider: Pick<EvmRpcProvider, 'request'>;
}

export interface TokenServiceOptions {
  readonly now?: () => number;
}