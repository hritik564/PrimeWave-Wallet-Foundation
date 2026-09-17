import type {
  AssetIdentity,
  AssetType,
} from '@/src/core/assets';
import type {
  BroadcastResult,
  ConfirmationResult,
  PublicTransactionReceipt,
} from '@/src/core/transactions/broadcast';

export type ActivityTransactionHash = `0x${string}`;

export type ActivityTransactionType =
  | 'native-transfer'
  | 'erc20-transfer'
  | 'contract-interaction'
  | 'unknown';

export type ActivityDirection =
  | 'outgoing'
  | 'incoming'
  | 'self-transfer'
  | 'unknown';

export type ActivityStatus =
  | 'draft'
  | 'signed'
  | 'broadcasting'
  | 'broadcasted'
  | 'confirming'
  | 'confirmed'
  | 'reverted'
  | 'failed'
  | 'unknown';

export type ActivityProvenance =
  | 'local_wallet'
  | 'broadcast_engine'
  | 'confirmation_engine'
  | 'blockchain_read'
  | 'external_indexer_future';

export interface ActivityScope {
  readonly accountId: string;
  readonly networkId: string;
  readonly chainId: bigint;
}

export interface ActivityConfirmation {
  readonly state: ConfirmationResult['state'];
  readonly receipt: PublicTransactionReceipt | null;
  readonly polls: number;
  readonly checkedAtMs: number;
}

export interface ActivityRecord extends ActivityScope {
  readonly kind: 'activity-record';
  readonly localTransactionId: string | null;
  readonly transactionHash: ActivityTransactionHash | null;
  readonly senderAddress: string;
  readonly transactionType: ActivityTransactionType;
  readonly direction: ActivityDirection;
  readonly assetIdentity: AssetIdentity | null;
  readonly recipient: string | null;
  readonly amountRaw: bigint | null;
  readonly amountDecimals: number | null;
  readonly amountDisplay: string | null;
  readonly nativeValue: bigint | null;
  readonly tokenContractAddress: string | null;
  readonly nonce: bigint | null;
  readonly gasLimit: bigint | null;
  readonly feeModel: 'legacy' | 'eip1559' | null;
  readonly feeAmount: bigint | null;
  readonly createdAt: number;
  readonly broadcastAt: number | null;
  readonly confirmedAt: number | null;
  readonly status: ActivityStatus;
  readonly confirmation: ActivityConfirmation | null;
  readonly explorerUrl: string | null;
  readonly provenance: ActivityProvenance;
  readonly observedAt: number;
}

export interface ActivityRecordInput extends ActivityScope {
  readonly localTransactionId?: string | null;
  readonly transactionHash?: ActivityTransactionHash | null;
  readonly senderAddress: string;
  readonly transactionType: ActivityTransactionType;
  readonly direction: ActivityDirection;
  readonly assetIdentity?: AssetIdentity | null;
  readonly recipient?: string | null;
  readonly amountRaw?: bigint | null;
  readonly amountDecimals?: number | null;
  readonly amountDisplay?: string | null;
  readonly nativeValue?: bigint | null;
  readonly tokenContractAddress?: string | null;
  readonly nonce?: bigint | null;
  readonly gasLimit?: bigint | null;
  readonly feeModel?: 'legacy' | 'eip1559' | null;
  readonly feeAmount?: bigint | null;
  readonly createdAt: number;
  readonly broadcastAt?: number | null;
  readonly confirmedAt?: number | null;
  readonly status: ActivityStatus;
  readonly confirmation?: ActivityConfirmation | null;
  readonly explorerUrl?: string | null;
  readonly provenance: ActivityProvenance;
  readonly observedAt?: number;
}

export interface ActivityScopeQuery extends ActivityScope {}

export interface ActivityListOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ActivityStatusUpdate {
  readonly status: ActivityStatus;
  readonly transactionHash?: ActivityTransactionHash | null;
  readonly broadcastAt?: number | null;
  readonly confirmedAt?: number | null;
  readonly confirmation?: ActivityConfirmation | null;
  readonly explorerUrl?: string | null;
  readonly provenance?: ActivityProvenance;
  readonly observedAt?: number;
}

export interface ActivityDraftInput extends ActivityScope {
  readonly senderAddress: string;
  readonly transactionType: ActivityTransactionType;
  readonly direction: ActivityDirection;
  readonly assetIdentity?: AssetIdentity | null;
  readonly recipient?: string | null;
  readonly amountRaw?: bigint | null;
  readonly amountDecimals?: number | null;
  readonly amountDisplay?: string | null;
  readonly nativeValue?: bigint | null;
  readonly tokenContractAddress?: string | null;
  readonly nonce?: bigint | null;
  readonly gasLimit?: bigint | null;
  readonly feeModel?: 'legacy' | 'eip1559' | null;
  readonly feeAmount?: bigint | null;
  readonly explorerUrl?: string | null;
}

export interface ActivityExternalInput extends ActivityScope {
  readonly transactionHash: ActivityTransactionHash;
  readonly senderAddress: string;
  readonly transactionType?: ActivityTransactionType;
  readonly direction: ActivityDirection;
  readonly assetIdentity?: AssetIdentity | null;
  readonly recipient?: string | null;
  readonly amountRaw?: bigint | null;
  readonly amountDecimals?: number | null;
  readonly amountDisplay?: string | null;
  readonly nativeValue?: bigint | null;
  readonly tokenContractAddress?: string | null;
  readonly nonce?: bigint | null;
  readonly gasLimit?: bigint | null;
  readonly feeModel?: 'legacy' | 'eip1559' | null;
  readonly feeAmount?: bigint | null;
  readonly status?: Extract<ActivityStatus, 'broadcasted' | 'confirming' | 'confirmed' | 'reverted' | 'unknown'>;
  readonly confirmation?: ActivityConfirmation | null;
  readonly explorerUrl?: string | null;
  readonly observedAt?: number;
}

export type BroadcastLifecycleResult = BroadcastResult;
export type ConfirmationLifecycleResult = ConfirmationResult;