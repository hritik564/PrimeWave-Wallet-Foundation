import type { EvmRpcProvider } from '@/src/core/blockchain/rpc';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { SignedTransaction } from '../signing';

export type BroadcastLifecycleState =
  | 'ready'
  | 'broadcasting'
  | 'broadcasted'
  | 'confirming'
  | 'confirmed'
  | 'reverted'
  | 'failed'
  | 'unknown';

export interface BroadcastResult {
  readonly kind: 'broadcast-result';
  readonly state: 'broadcasted' | 'unknown';
  readonly transactionHash: `0x${string}`;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionType: SignedTransaction['transactionType'];
  readonly from: string;
  readonly submittedAtMs: number | null;
  readonly errorCode?:
    | 'BROADCAST_TIMEOUT'
    | 'BROADCAST_NETWORK_UNAVAILABLE'
    | 'BROADCAST_UNKNOWN_RESULT';
}

export interface PublicTransactionReceipt {
  readonly transactionHash: `0x${string}`;
  readonly blockHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly status: 'success' | 'reverted';
  readonly gasUsed: bigint;
  readonly effectiveGasPrice: bigint | null;
}

export interface ConfirmationResult {
  readonly kind: 'confirmation-result';
  readonly state: 'confirmed' | 'reverted' | 'unknown';
  readonly transactionHash: `0x${string}`;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly receipt: PublicTransactionReceipt | null;
  readonly polls: number;
  readonly checkedAtMs: number;
  readonly errorCode?: 'BROADCAST_TIMEOUT' | 'BROADCAST_UNKNOWN_RESULT';
}

export interface TransactionLookupResult {
  readonly kind: 'transaction-lookup';
  readonly state: 'pending' | 'mined' | 'not-found';
  readonly transactionHash: `0x${string}`;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly blockHash: `0x${string}` | null;
  readonly blockNumber: bigint | null;
}

export interface ConfirmationPollingOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

export interface TransactionBroadcastEngineOptions {
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly defaultPolling?: ConfirmationPollingOptions;
}

export interface TransactionBroadcastDependencies {
  readonly registry: NetworkRegistry;
  readonly provider: EvmRpcProvider;
}