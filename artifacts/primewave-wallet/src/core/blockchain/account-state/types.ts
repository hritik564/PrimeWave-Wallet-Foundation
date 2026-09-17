import type { EvmNetwork } from '@/src/core/networks/types';

export type AccountCodeKind =
  | 'externally-owned-account'
  | 'contract';

export interface NativeBalanceState {
  readonly address: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly symbol: string;
  readonly decimals: number;
  readonly raw: bigint;
  readonly display: string;
}

export interface EvmChainState {
  readonly networkId: string;
  readonly chainId: bigint;
  readonly latestBlockNumber: bigint;
}

export interface AccountNonceState {
  readonly address: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly value: bigint;
}

export interface ContractCodeState {
  readonly address: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly kind: AccountCodeKind;
  readonly hasCode: boolean;
  readonly code: `0x${string}`;
}

export interface LatestBlockState {
  readonly number: bigint | null;
  readonly hash: string | null;
  readonly timestamp: bigint | null;
}

export interface AccountStateSnapshot {
  readonly address: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly nativeBalance: NativeBalanceState;
  readonly nonce: bigint;
  readonly code: ContractCodeState;
  readonly latestBlock: LatestBlockState | null;
  readonly retrievedAtMs: number;
}

export interface AccountStateServiceOptions {
  readonly now?: () => number;
}

export interface AccountStateNetworkContext {
  readonly network: EvmNetwork;
  readonly networkId: string;
  readonly chainId: bigint;
}