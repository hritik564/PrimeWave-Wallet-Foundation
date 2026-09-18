import type {
  ActivityAction,
  ActivityReadModelItem,
  ActivityStatus,
} from '@/src/core/activity';
import type { EvmNetwork } from '@/src/core/networks';

export type ActivityTypeFilter =
  | 'transactions'
  | 'swaps'
  | 'approvals'
  | 'contract-interactions'
  | 'all';

export interface ActivityTypeFilterOption {
  readonly value: ActivityTypeFilter;
  readonly label: string;
}

export interface ActivityDateGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly ActivityReadModelItem[];
}

export function networksForActivityFilter(
  networks: readonly EvmNetwork[],
  networkFilter: 'all' | string,
): readonly EvmNetwork[] {
  return networkFilter === 'all'
    ? networks
    : networks.filter((network) => network.id === networkFilter);
}

export function shortActivityAddress(address: string | null): string | null {
  if (!address) return null;
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function activityActionLabel(
  item: ActivityReadModelItem,
): string {
  const presentation = item.presentation;
  if (presentation.direction === 'self-transfer') return 'Self transfer';

  const assetLabel =
    presentation.primaryAsset?.symbol ??
    presentation.primaryAsset?.name ??
    null;

  if (
    presentation.action === 'swapped' &&
    presentation.secondaryAsset &&
    presentation.secondaryAmount
  ) {
    return 'Swapped';
  }
  if (presentation.action === 'approved') {
    return assetLabel ? `Approved ${assetLabel}` : 'Approved';
  }
  if (presentation.action === 'contract_interaction') {
    return 'Contract Interaction';
  }
  if (presentation.action === 'sent') {
    return assetLabel ? `Sent ${assetLabel}` : 'Sent';
  }
  if (presentation.action === 'received') {
    return assetLabel ? `Received ${assetLabel}` : 'Received';
  }
  return 'Activity';
}

export function activityContextLabel(
  item: ActivityReadModelItem,
): string {
  const counterparty = item.presentation.counterparty;
  if (counterparty.address && counterparty.directionLabel) {
    return `${counterparty.directionLabel}: ${
      counterparty.displayAddress ?? shortActivityAddress(counterparty.address)
    }`;
  }
  if (item.presentation.direction === 'self-transfer') {
    return 'Between accounts in this wallet';
  }
  if (item.presentation.action === 'contract_interaction') {
    return 'No contract address available';
  }
  return 'Public counterparty unavailable';
}

export function activityStatusLabel(status: ActivityStatus): string {
  switch (status) {
    case 'broadcasting':
      return 'Broadcasting';
    case 'broadcasted':
      return 'Broadcasted';
    case 'confirming':
      return 'Confirming';
    case 'confirmed':
      return 'Confirmed';
    case 'reverted':
      return 'Reverted';
    case 'failed':
      return 'Failed';
    case 'unknown':
      return 'Unknown';
    case 'signed':
      return 'Signed';
    case 'draft':
      return 'Draft';
  }
}

function isTransaction(item: ActivityReadModelItem): boolean {
  return (
    item.transactionType === 'native-transfer' ||
    item.transactionType === 'erc20-transfer' ||
    item.presentation.action === 'sent' ||
    item.presentation.action === 'received' ||
    item.presentation.direction === 'self-transfer'
  );
}

export function activityFilterOptions(
  items: readonly ActivityReadModelItem[],
): readonly ActivityTypeFilterOption[] {
  const options: ActivityTypeFilterOption[] = [
    { value: 'transactions', label: 'Transactions' },
  ];
  if (items.some((item) => item.presentation.action === 'swapped')) {
    options.push({ value: 'swaps', label: 'Swaps' });
  }
  if (items.some((item) => item.presentation.action === 'approved')) {
    options.push({ value: 'approvals', label: 'Approvals' });
  }
  if (
    items.some(
      (item) =>
        item.transactionType === 'contract-interaction' ||
        item.presentation.action === 'contract_interaction',
    )
  ) {
    options.push({
      value: 'contract-interactions',
      label: 'Contract interactions',
    });
  }
  options.push({ value: 'all', label: 'All activity' });
  return options;
}

export function filterActivityItems(
  items: readonly ActivityReadModelItem[],
  typeFilter: ActivityTypeFilter,
): readonly ActivityReadModelItem[] {
  return items.filter((item) => {
    switch (typeFilter) {
      case 'transactions':
        return isTransaction(item);
      case 'swaps':
        return item.presentation.action === 'swapped';
      case 'approvals':
        return item.presentation.action === 'approved';
      case 'contract-interactions':
        return (
          item.transactionType === 'contract-interaction' ||
          item.presentation.action === 'contract_interaction'
        );
      case 'all':
        return true;
    }
  });
}

function timestampForDate(item: ActivityReadModelItem): number | null {
  const timestamp = item.presentation.timestamp.timestamp;
  if (timestamp === null) return null;
  // Blockchain timestamps are normally seconds; observation timestamps in
  // this project are milliseconds. Supporting both keeps the presentation
  // model's source distinction intact without changing the read model.
  return timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
}

function dateKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function activityDateLabel(
  item: ActivityReadModelItem,
  now = Date.now(),
): string {
  const timestamp = timestampForDate(item);
  if (timestamp === null) return 'Date unavailable';

  const date = new Date(timestamp);
  const today = new Date(now);
  const todayKey = dateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const itemKey = dateKey(date);

  if (itemKey === todayKey) return 'Today';
  if (itemKey === dateKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function groupActivityItems(
  items: readonly ActivityReadModelItem[],
  now = Date.now(),
): readonly ActivityDateGroup[] {
  const groups: ActivityDateGroup[] = [];
  const indexes = new Map<string, number>();

  for (const item of items) {
    const timestamp = timestampForDate(item);
    const key =
      timestamp === null ? 'unknown' : dateKey(new Date(timestamp));
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, groups.length);
      groups.push({
        key,
        label: key === 'unknown' ? 'Date unavailable' : activityDateLabel(item, now),
        items: [item],
      });
    } else {
      const existing = groups[existingIndex];
      groups[existingIndex] = {
        ...existing,
        items: [...existing.items, item],
      };
    }
  }

  return groups;
}

export function statusTone(status: ActivityStatus): 'muted' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'confirmed':
      return 'success';
    case 'broadcasting':
    case 'broadcasted':
    case 'confirming':
    case 'signed':
    case 'draft':
      return 'warning';
    case 'reverted':
    case 'failed':
      return 'danger';
    case 'unknown':
      return 'muted';
  }
}

export function readableActivityLabel(item: ActivityReadModelItem): string {
  const presentation = item.presentation;
  const counterparty = presentation.counterparty.address;
  const amount =
    presentation.primaryAmount.signedDisplay ??
    presentation.secondaryAmount?.signedDisplay ??
    'amount unavailable';
  return `${activityActionLabel(item)}, ${amount}, ${
    counterparty ? `address ${counterparty}` : 'counterparty unavailable'
  }, on ${presentation.network.name}, status ${activityStatusLabel(
    presentation.status,
  )}`;
}

export function activityActionIcon(action: ActivityAction): string {
  switch (action) {
    case 'sent':
      return 'arrow-up-outline';
    case 'received':
      return 'arrow-down-outline';
    case 'swapped':
      return 'swap-horizontal-outline';
    case 'approved':
      return 'checkmark-circle-outline';
    case 'contract_interaction':
      return 'code-slash-outline';
    default:
      return 'time-outline';
  }
}