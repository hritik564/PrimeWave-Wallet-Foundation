import type { EvmAccountStateService } from '@/src/core/blockchain/account-state';

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
    'getNetwork' | 'getNativeBalance'
  >;
}