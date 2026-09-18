import type {
  AssetIdentity,
  AssetType,
  TokenMetadataStatus,
  TokenVerificationStatus,
} from '@/src/core/assets';
import { formatAssetAmount } from '@/src/core/assets';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import { createAssetIcon } from '@/src/core/portfolio';
import type { AssetIcon } from '@/src/core/portfolio';
import type {
  ActivityDirection,
  ActivityRecord,
  ActivityStatus,
  ActivityTransactionType,
} from './models';

export type ActivityAction =
  | 'sent'
  | 'received'
  | 'swapped'
  | 'approved'
  | 'contract_interaction'
  | 'unknown';

export type ActivityCounterpartyType = 'to' | 'from' | 'contract' | 'unknown';

export interface ActivityCounterparty {
  readonly type: ActivityCounterpartyType;
  readonly address: string | null;
  readonly displayAddress: string | null;
  readonly directionLabel: 'To' | 'From' | 'Contract' | null;
}

export interface ActivityAssetPresentation {
  readonly identity: AssetIdentity;
  readonly assetType: AssetType;
  readonly networkId: string;
  readonly assetId: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly icon: AssetIcon;
  readonly metadataStatus: TokenMetadataStatus;
  readonly verificationStatus: TokenVerificationStatus;
}

export interface ActivityAssetMetadata {
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly icon: AssetIcon;
  readonly metadataStatus: TokenMetadataStatus;
  readonly verificationStatus: TokenVerificationStatus;
}

export interface ActivityNetworkPresentation {
  readonly networkId: string;
  readonly name: string;
  readonly badgeId: string;
  readonly badgeFallbackInitials: string;
  readonly chainId: bigint;
  readonly configured: boolean;
  readonly available: boolean;
  readonly configurationStatus: EvmNetwork['configurationStatus'] | 'unavailable';
}

export type ActivityAmountSign = 'positive' | 'negative' | 'none' | 'unknown';

export interface ActivityAmountPresentation {
  readonly raw: bigint | null;
  readonly decimals: number | null;
  readonly symbol: string | null;
  readonly display: string | null;
  readonly signedDisplay: string | null;
  readonly sign: ActivityAmountSign;
}

export interface ActivityFiatValue {
  readonly currencyCode: string;
  readonly display: string;
}

export type ActivityTimestampSource = 'blockchain' | 'observation' | 'unknown';

export interface ActivityTimestampPresentation {
  readonly timestamp: number | null;
  readonly source: ActivityTimestampSource;
  readonly isBlockchainDerived: boolean;
}

export interface ActivityExplorerPresentation {
  readonly available: boolean;
  readonly url: string | null;
  readonly explorerName: string | null;
}

export interface ActivityPresentationInterpretation {
  readonly action: ActivityAction;
  readonly primaryAsset?: ActivityAssetMetadata | null;
  readonly secondaryAsset?: ActivityAssetPresentation | null;
  readonly secondaryAmount?: ActivityAmountPresentation | null;
  readonly counterparty?: ActivityCounterparty | null;
  readonly fiatValue?: ActivityFiatValue | null;
}

export interface ActivityPresentationModel {
  readonly kind: 'activity-presentation';
  readonly activityId: string;
  readonly transactionHash: ActivityRecord['transactionHash'];
  readonly accountId: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly action: ActivityAction;
  readonly transactionType: ActivityTransactionType;
  readonly primaryAsset: ActivityAssetPresentation | null;
  readonly secondaryAsset: ActivityAssetPresentation | null;
  readonly direction: ActivityDirection;
  readonly counterparty: ActivityCounterparty;
  readonly primaryAmount: ActivityAmountPresentation;
  readonly secondaryAmount: ActivityAmountPresentation | null;
  readonly fiatValue: ActivityFiatValue | null;
  readonly status: ActivityStatus;
  readonly timestamp: ActivityTimestampPresentation;
  readonly provenance: ActivityRecord['provenance'];
  readonly network: ActivityNetworkPresentation;
  readonly explorerAvailability: ActivityExplorerPresentation;
}

export type ActivityAssetResolver = (
  identity: AssetIdentity,
) => ActivityAssetMetadata | null;

export type ActivityInterpretationResolver = (
  record: ActivityRecord,
  primaryAsset: ActivityAssetPresentation | null,
) => ActivityPresentationInterpretation | null;

export type ActivityFiatValueResolver = (
  record: ActivityRecord,
) => ActivityFiatValue | null;

export interface ActivityPresentationOptions {
  readonly networkRegistry?: NetworkRegistry;
  readonly assetResolver?: ActivityAssetResolver;
  readonly interpretationResolver?: ActivityInterpretationResolver;
  readonly fiatValueResolver?: ActivityFiatValueResolver;
}

function initialsFor(value: string): string {
  const initials = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return initials.slice(0, 2).padEnd(2, '?');
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function defaultAssetMetadata(
  identity: AssetIdentity,
  networkRegistry?: NetworkRegistry,
): ActivityAssetMetadata {
  let name: string | null = null;
  let symbol: string | null = null;
  let decimals: number | null = null;

  if (identity.assetType === 'native') {
    const network = networkRegistry?.getById(identity.networkId);
    if (network && identity.assetId === 'native') {
      name = network.nativeCurrency.name;
      symbol = network.nativeCurrency.symbol;
      decimals = network.nativeCurrency.decimals;
    }
  }

  return {
    name,
    symbol,
    decimals,
    icon: createAssetIcon(
      identity,
      name,
      symbol,
      identity.assetType === 'native' ? 'native_currency' : 'asset_initials',
    ),
    metadataStatus: name || symbol || decimals !== null ? 'complete' : 'unavailable',
    verificationStatus: 'unknown',
  };
}

function resolveAsset(
  identity: AssetIdentity | null,
  options: ActivityPresentationOptions,
): ActivityAssetPresentation | null {
  if (!identity) return null;
  const metadata =
    options.assetResolver?.(identity) ??
    defaultAssetMetadata(identity, options.networkRegistry);
  return Object.freeze({
    identity,
    assetType: identity.assetType,
    networkId: identity.networkId,
    assetId: identity.assetId,
    symbol: metadata.symbol,
    name: metadata.name,
    decimals: metadata.decimals,
    icon: metadata.icon,
    metadataStatus: metadata.metadataStatus,
    verificationStatus: metadata.verificationStatus,
  });
}

function defaultAction(record: ActivityRecord): ActivityAction {
  if (
    record.transactionType === 'native-transfer' ||
    record.transactionType === 'erc20-transfer'
  ) {
    if (record.direction === 'incoming') return 'received';
    if (
      record.direction === 'outgoing' ||
      record.direction === 'self-transfer'
    ) {
      return 'sent';
    }
    return 'unknown';
  }
  if (record.transactionType === 'contract-interaction') {
    return 'contract_interaction';
  }
  return 'unknown';
}

function defaultCounterparty(record: ActivityRecord): ActivityCounterparty {
  if (record.direction === 'incoming') {
    return {
      type: 'from',
      address: record.senderAddress,
      displayAddress: shortenAddress(record.senderAddress),
      directionLabel: 'From',
    };
  }
  if (
    record.transactionType === 'contract-interaction' &&
    record.recipient
  ) {
    return {
      type: 'contract',
      address: record.recipient,
      displayAddress: shortenAddress(record.recipient),
      directionLabel: 'Contract',
    };
  }
  if (
    (record.direction === 'outgoing' || record.direction === 'self-transfer') &&
    record.recipient
  ) {
    return {
      type: 'to',
      address: record.recipient,
      displayAddress: shortenAddress(record.recipient),
      directionLabel: 'To',
    };
  }
  return {
    type: 'unknown',
    address: null,
    displayAddress: null,
    directionLabel: null,
  };
}

function amountPresentation(
  raw: bigint | null,
  decimals: number | null,
  symbol: string | null,
  display: string | null,
  direction: ActivityDirection,
): ActivityAmountPresentation {
  const sign =
    direction === 'outgoing'
      ? 'negative'
      : direction === 'incoming'
        ? 'positive'
        : direction === 'self-transfer'
          ? 'none'
          : 'unknown';
  const exactDisplay =
    display ??
    (raw !== null && decimals !== null
      ? formatExactAmount(raw, decimals)
      : null);
  const signedDisplay =
    exactDisplay === null
      ? null
      : `${sign === 'negative' ? '-' : sign === 'positive' ? '+' : ''}${exactDisplay}${symbol ? ` ${symbol}` : ''}`;
  return Object.freeze({
    raw,
    decimals,
    symbol,
    display: exactDisplay,
    signedDisplay,
    sign,
  });
}

function formatExactAmount(raw: bigint, decimals: number): string | null {
  try {
    return formatAssetAmount(raw, decimals);
  } catch {
    return null;
  }
}

function networkPresentation(
  record: ActivityRecord,
  registry?: NetworkRegistry,
): ActivityNetworkPresentation {
  const network = registry?.getById(record.networkId);
  const chainMatches = network?.chainId !== null &&
    network?.chainId !== undefined &&
    BigInt(network.chainId) === record.chainId;
  return Object.freeze({
    networkId: record.networkId,
    name: network?.displayName ?? record.networkId,
    badgeId: `network:${record.networkId}`,
    badgeFallbackInitials: initialsFor(network?.displayName ?? record.networkId),
    chainId: record.chainId,
    configured: network?.configurationStatus === 'configured' && Boolean(chainMatches),
    available: Boolean(network?.enabled && chainMatches),
    configurationStatus: network?.configurationStatus ?? 'unavailable',
  });
}

function explorerPresentation(
  record: ActivityRecord,
  registry?: NetworkRegistry,
): ActivityExplorerPresentation {
  const network = registry?.getById(record.networkId);
  if (
    !network ||
    !network.enabled ||
    network.configurationStatus !== 'configured' ||
    network.chainId === null ||
    BigInt(network.chainId) !== record.chainId ||
    !record.transactionHash ||
    !network.explorer.transactionUrlTemplate
  ) {
    return Object.freeze({
      available: false,
      url: null,
      explorerName: network?.explorer.name ?? null,
    });
  }
  try {
    const url = new URL(
      network.explorer.transactionUrlTemplate.replace(
        '{txHash}',
        encodeURIComponent(record.transactionHash),
      ),
    );
    return Object.freeze({
      available: true,
      url: url.toString(),
      explorerName: network.explorer.name,
    });
  } catch {
    return Object.freeze({
      available: false,
      url: null,
      explorerName: network.explorer.name,
    });
  }
}

export function toActivityPresentationModel(
  record: ActivityRecord,
  options: ActivityPresentationOptions = {},
): ActivityPresentationModel {
  const primaryAsset = resolveAsset(record.assetIdentity, options);
  const interpretation = options.interpretationResolver?.(record, primaryAsset);
  const action = interpretation?.action ?? defaultAction(record);
  const primaryMetadata = interpretation?.primaryAsset;
  const resolvedPrimaryAsset =
    primaryAsset && primaryMetadata
      ? Object.freeze({
          ...primaryAsset,
          ...primaryMetadata,
          identity: primaryAsset.identity,
          assetType: primaryAsset.assetType,
          networkId: primaryAsset.networkId,
          assetId: primaryAsset.assetId,
        })
      : primaryAsset;
  const primaryAmount = amountPresentation(
    record.amountRaw,
    resolvedPrimaryAsset?.decimals ?? record.amountDecimals,
    resolvedPrimaryAsset?.symbol ?? null,
    record.amountDisplay,
    record.direction,
  );
  const timestamp = record.blockTimestamp ?? record.observedAt;
  return Object.freeze({
    kind: 'activity-presentation',
    activityId: record.localTransactionId ?? `hash:${record.networkId}:${record.chainId}:${record.transactionHash}`,
    transactionHash: record.transactionHash,
    accountId: record.accountId,
    networkId: record.networkId,
    chainId: record.chainId,
    action,
    transactionType: record.transactionType,
    primaryAsset: resolvedPrimaryAsset,
    secondaryAsset: interpretation?.secondaryAsset ?? null,
    direction: record.direction,
    counterparty: interpretation?.counterparty ?? defaultCounterparty(record),
    primaryAmount,
    secondaryAmount: interpretation?.secondaryAmount ?? null,
    fiatValue:
      interpretation?.fiatValue ??
      options.fiatValueResolver?.(record) ??
      null,
    status: record.status,
    timestamp: Object.freeze({
      timestamp,
      source: record.blockTimestamp === null ? 'observation' : 'blockchain',
      isBlockchainDerived: record.blockTimestamp !== null,
    }),
    provenance: record.provenance,
    network: networkPresentation(record, options.networkRegistry),
    explorerAvailability: explorerPresentation(record, options.networkRegistry),
  });
}