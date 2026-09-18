import { formatAssetAmount } from '@/src/core/assets';
import type {
  ActivityReadModelItem,
  ActivityStatus,
  ActivityTransactionType,
} from '@/src/core/activity';
import type {
  BroadcastResult,
  ConfirmationResult,
  TransactionLookupResult,
} from '@/src/core/transactions/broadcast';

export interface TransactionDetailBroadcastDependency {
  readonly lookup: (
    broadcast: BroadcastResult,
  ) => Promise<TransactionLookupResult>;
  readonly confirm: (
    broadcast: BroadcastResult,
  ) => Promise<ConfirmationResult>;
}

export interface TransactionDetailActivityDependency {
  readonly recordConfirmation?: (
    localTransactionId: string,
    result: ConfirmationResult,
    options?: { readonly explorerUrl?: string | null },
  ) => ActivityReadModelItem | unknown;
  readonly recordExternal?: (input: {
    readonly accountId: string;
    readonly networkId: string;
    readonly chainId: bigint;
    readonly transactionHash: `0x${string}`;
    readonly senderAddress: string;
    readonly transactionType?: ActivityTransactionType;
    readonly direction: ActivityReadModelItem['direction'];
    readonly assetIdentity?: ActivityReadModelItem['assetIdentity'];
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
    readonly status?: Extract<
      ActivityStatus,
      'broadcasted' | 'confirming' | 'confirmed' | 'reverted' | 'unknown'
    >;
    readonly blockTimestamp?: number | null;
    readonly confirmation?: ActivityReadModelItem['confirmation'];
    readonly explorerUrl?: string | null;
    readonly observedAt?: number;
  }) => ActivityReadModelItem | unknown;
}

export type TransactionDetailStatusTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger';

export interface TransactionDetailStatusCopy {
  readonly label: string;
  readonly explanation: string;
  readonly tone: TransactionDetailStatusTone;
}

export type ReconciliationOutcome =
  | 'confirmed'
  | 'reverted'
  | 'pending'
  | 'not-found'
  | 'unknown';

export interface TransactionDetailSelection {
  readonly activityId: string;
  readonly accountId: string;
  readonly networkId: string;
  readonly chainId: bigint;
}

export function createTransactionDetailSelection(
  item: ActivityReadModelItem,
): TransactionDetailSelection {
  return Object.freeze({
    activityId: item.identity,
    accountId: item.accountId,
    networkId: item.networkId,
    chainId: item.chainId,
  });
}

export function detailStatusCopy(
  status: ActivityStatus,
): TransactionDetailStatusCopy {
  switch (status) {
    case 'draft':
      return {
        label: 'Draft',
        explanation: 'This is a local transaction record and has not been signed.',
        tone: 'neutral',
      };
    case 'signed':
      return {
        label: 'Signed locally — not broadcast',
        explanation: 'The transaction was signed on this device but has not been broadcast.',
        tone: 'warning',
      };
    case 'broadcasting':
      return {
        label: 'Broadcasting',
        explanation: 'WAVEX is sending the signed transaction to the configured network.',
        tone: 'warning',
      };
    case 'broadcasted':
      return {
        label: 'Broadcasted — awaiting confirmation',
        explanation: 'The network accepted the transaction. On-chain execution is not confirmed yet.',
        tone: 'warning',
      };
    case 'confirming':
      return {
        label: 'Confirming',
        explanation: 'WAVEX is checking the network for a transaction receipt.',
        tone: 'warning',
      };
    case 'confirmed':
      return {
        label: 'Confirmed',
        explanation: 'The transaction was included on-chain and execution succeeded.',
        tone: 'success',
      };
    case 'reverted':
      return {
        label: 'Reverted',
        explanation: 'The transaction was included on-chain but execution reverted.',
        tone: 'danger',
      };
    case 'failed':
      return {
        label: 'Broadcast failed',
        explanation: 'The transaction did not reach confirmed on-chain execution.',
        tone: 'danger',
      };
    case 'unknown':
      return {
        label: 'Status unknown',
        explanation:
          'The result could not be established. Check the transaction on the network before attempting anything again.',
        tone: 'warning',
      };
  }
}

export function detailSummaryLabel(item: ActivityReadModelItem): string {
  const { presentation } = item;
  if (presentation.direction === 'self-transfer') return 'Self transfer';
  if (
    presentation.action === 'swapped' &&
    presentation.secondaryAsset &&
    presentation.secondaryAmount
  ) {
    return 'Swapped';
  }
  if (presentation.action === 'contract_interaction') {
    return 'Contract Interaction';
  }
  if (presentation.action === 'approved') return 'Approval';
  if (presentation.action === 'sent') return 'Sent';
  if (presentation.action === 'received') return 'Received';
  return 'Transaction';
}

export function transactionTypeLabel(
  item: ActivityReadModelItem,
): string {
  if (
    item.presentation.action === 'swapped' &&
    item.presentation.secondaryAsset &&
    item.presentation.secondaryAmount
  ) {
    return 'Swap';
  }
  if (item.presentation.action === 'approved') return 'Approval';
  switch (item.transactionType) {
    case 'native-transfer':
      return 'Native Transfer';
    case 'erc20-transfer':
      return 'ERC-20 Transfer';
    case 'contract-interaction':
      return 'Contract Interaction';
    case 'unknown':
      return 'Unknown';
  }
}

export function formatExactQuantity(
  raw: bigint | null,
  decimals: number | null,
): string | null {
  if (raw === null || decimals === null) return null;
  try {
    return formatAssetAmount(raw, decimals);
  } catch {
    return null;
  }
}

export function shortDetailValue(
  value: string | null,
  head = 10,
  tail = 8,
): string | null {
  if (!value) return null;
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function timestampLabel(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const milliseconds =
    timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toLocaleString();
}

export function timestampSourceLabel(
  source: ActivityReadModelItem['presentation']['timestamp']['source'],
): string {
  switch (source) {
    case 'blockchain':
      return 'Blockchain timestamp';
    case 'observation':
      return 'Observed locally';
    case 'unknown':
      return 'Timestamp unavailable';
  }
}

function broadcastTransactionType(
  type: ActivityTransactionType,
): 'native-transfer' | 'contract-call' {
  return type === 'native-transfer' ? 'native-transfer' : 'contract-call';
}

export function createLookupContext(
  item: ActivityReadModelItem,
): BroadcastResult | null {
  if (!item.transactionHash) return null;
  return Object.freeze({
    kind: 'broadcast-result',
    state: item.status === 'unknown' ? 'unknown' : 'broadcasted',
    transactionHash: item.transactionHash,
    networkId: item.networkId,
    chainId: item.chainId,
    transactionType: broadcastTransactionType(item.transactionType),
    from: item.senderAddress,
    submittedAtMs: item.broadcastAt,
  });
}

export function reconciliationOutcome(
  lookup: TransactionLookupResult,
  confirmation: ConfirmationResult | null,
): ReconciliationOutcome {
  if (lookup.state === 'not-found') return 'not-found';
  if (confirmation?.state === 'confirmed') return 'confirmed';
  if (confirmation?.state === 'reverted') return 'reverted';
  if (confirmation?.state === 'unknown') return 'unknown';
  return 'pending';
}

export function canPersistConfirmation(
  item: ActivityReadModelItem,
): boolean {
  return (
    item.localTransactionId !== null &&
    (item.status === 'broadcasted' ||
      item.status === 'confirming' ||
      item.status === 'unknown')
  );
}