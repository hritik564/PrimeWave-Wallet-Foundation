import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import type {
  ActivityReadModelItem,
  ActivityReadModelService,
} from '@/src/core/activity';
import type { NetworkRegistry } from '@/src/core/networks';
import type { ConfirmationResult } from '@/src/core/transactions/broadcast';
import { copyPublicText } from './public-address-actions';
import {
  canPersistConfirmation,
  createLookupContext,
  detailStatusCopy,
  detailSummaryLabel,
  formatExactQuantity,
  reconciliationOutcome,
  shortDetailValue,
  timestampLabel,
  timestampSourceLabel,
  transactionTypeLabel,
  type ReconciliationOutcome,
  type TransactionDetailActivityDependency,
  type TransactionDetailBroadcastDependency,
} from './TransactionDetailScreen.logic';

type DetailState = 'loading' | 'available' | 'unavailable' | 'error';

type ActivityReadModelDependency = Pick<ActivityReadModelService, 'getActivity'>;

export interface TransactionDetailScreenProps {
  readonly activityId: string;
  readonly accountId: string | null;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly activityReadModelService: ActivityReadModelDependency | null;
  readonly activityService?: TransactionDetailActivityDependency | null;
  readonly networkRegistry: NetworkRegistry;
  readonly createBroadcastDependency?: (
    networkId: string,
  ) => Promise<TransactionDetailBroadcastDependency | null>;
  readonly onBack: () => void;
}

function statusColor(tone: ReturnType<typeof detailStatusCopy>['tone']): string {
  if (tone === 'success') return theme.states.success;
  if (tone === 'warning') return theme.states.warning;
  if (tone === 'danger') return theme.colors.destructive;
  return theme.colors.mutedForeground;
}

function assetLabel(item: ActivityReadModelItem): string {
  return (
    item.presentation.primaryAsset?.symbol ??
    item.presentation.primaryAsset?.name ??
    'Asset'
  );
}

function dateParts(item: ActivityReadModelItem): {
  readonly value: string;
  readonly source: string;
} | null {
  const value = timestampLabel(item.presentation.timestamp.timestamp);
  return value
    ? {
        value,
        source: timestampSourceLabel(item.presentation.timestamp.source),
      }
    : null;
}

function AssetVisual({ item }: { readonly item: ActivityReadModelItem }) {
  const asset = item.presentation.primaryAsset;
  const hasRemoteReference =
    asset?.icon.status === 'available' && asset.icon.reference !== null;
  return (
    <View style={styles.assetVisual}>
      <View style={styles.assetCircle}>
        {hasRemoteReference ? (
          <Image
            accessibilityLabel={`${assetLabel(item)} icon`}
            contentFit="contain"
            source={{ uri: asset.icon.reference as string }}
            style={styles.assetImage}
          />
        ) : (
          <Text style={styles.assetInitials}>
            {asset?.icon.fallback.initials ?? '··'}
          </Text>
        )}
      </View>
      <View
        accessibilityLabel={`${item.presentation.network.name} network badge`}
        style={[
          styles.networkBadge,
          !item.presentation.network.available && styles.networkBadgeUnavailable,
        ]}
      >
        <Text style={styles.networkBadgeText}>
          {item.presentation.network.badgeFallbackInitials || '??'}
        </Text>
      </View>
    </View>
  );
}

function SectionCard({
  title,
  children,
  warning = false,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly warning?: boolean;
}) {
  return (
    <View style={[styles.card, warning && styles.warningCard]}>
      <Text style={styles.cardEyebrow}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({
  label,
  value,
  secondary,
  onCopy,
}: {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
  readonly onCopy?: () => void;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueColumn}>
        <Text selectable style={styles.detailValue}>
          {value}
        </Text>
        {secondary ? <Text style={styles.detailSecondary}>{secondary}</Text> : null}
        {onCopy ? (
          <Pressable
            accessibilityLabel={`Copy ${label.toLowerCase()}`}
            accessibilityRole="button"
            onPress={onCopy}
            style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
          >
            <Ionicons name="copy-outline" size={15} color={theme.colors.accent} />
            <Text style={styles.copyText}>Copy</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AmountLine({
  label,
  value,
  symbol,
  positive = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly symbol: string | null;
  readonly positive?: boolean;
}) {
  return (
    <View style={styles.amountLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.amountValue, positive && styles.amountPositive]}>
        {value ? `${value}${symbol ? ` ${symbol}` : ''}` : 'Unavailable'}
      </Text>
    </View>
  );
}

function reconciliationMessage(
  outcome: ReconciliationOutcome,
): string {
  switch (outcome) {
    case 'confirmed':
      return 'Receipt found. The activity now shows confirmed execution.';
    case 'reverted':
      return 'Receipt found. The activity now shows reverted execution.';
    case 'pending':
      return 'The transaction is still pending. No confirmation was assumed.';
    case 'not-found':
      return 'The transaction was not found on this network. Status remains unchanged.';
    case 'unknown':
      return 'The network response was inconclusive. Status remains unknown.';
  }
}

export function TransactionDetailScreen({
  activityId,
  accountId,
  networkId,
  chainId,
  activityReadModelService,
  activityService,
  networkRegistry,
  createBroadcastDependency,
  onBack,
}: TransactionDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<DetailState>('loading');
  const [item, setItem] = useState<ActivityReadModelItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);

  const loadItem = useCallback(async () => {
    if (!activityReadModelService || !accountId) {
      setItem(null);
      setState('unavailable');
      return;
    }
    setState('loading');
    try {
      const result = activityReadModelService.getActivity({
        accountId,
        networkId,
        chainId,
        limit: 100,
      });
      const nextItem =
        result.items.find((candidate) => candidate.identity === activityId) ??
        null;
      if (!nextItem) {
        setItem(null);
        setState('unavailable');
        return;
      }
      setItem(nextItem);
      setState('available');
    } catch {
      setItem(null);
      setErrorMessage('This transaction detail is currently unavailable.');
      setState('error');
    }
  }, [
    accountId,
    activityId,
    activityReadModelService,
    chainId,
    networkId,
  ]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  const copyValue = useCallback(async (label: string, value: string | null) => {
    if (!value) return;
    try {
      await copyPublicText(value);
      setCopyState(`${label} copied`);
    } catch {
      setCopyState(`${label} unavailable`);
    }
  }, []);

  const handleReconcile = useCallback(async () => {
    if (!item || reconciling) return;
    const lookupContext = createLookupContext(item);
    if (!lookupContext) {
      setReconcileMessage('A transaction hash is not available for reconciliation.');
      return;
    }
    if (!createBroadcastDependency) {
      setReconcileMessage('Read-only reconciliation is unavailable in this context.');
      return;
    }
    setReconciling(true);
    setReconcileMessage(null);
    try {
      const dependency = await createBroadcastDependency(item.networkId);
      if (!dependency) {
        setReconcileMessage(
          'This transaction is tied to another or unconfigured network. No network was changed.',
        );
        return;
      }
      const lookup = await dependency.lookup(lookupContext);
      let confirmation: ConfirmationResult | null = null;
      if (lookup.state === 'mined') {
        confirmation = await dependency.confirm(lookupContext);
        if (
          activityService &&
          confirmation.state !== 'unknown' &&
          canPersistConfirmation(item)
        ) {
          activityService.recordConfirmation?.(item.localTransactionId!, confirmation, {
            explorerUrl: item.presentation.explorerAvailability.url,
          });
        } else if (
          activityService?.recordExternal &&
          confirmation.state !== 'unknown' &&
          item.localTransactionId === null
        ) {
          activityService.recordExternal({
            accountId: item.accountId,
            networkId: item.networkId,
            chainId: item.chainId,
            transactionHash: item.transactionHash!,
            senderAddress: item.senderAddress,
            transactionType: item.transactionType,
            direction: item.direction,
            assetIdentity: item.assetIdentity,
            recipient: item.recipient,
            amountRaw: item.amountRaw,
            amountDecimals: item.amountDecimals,
            amountDisplay: item.amountDisplay,
            nativeValue: item.nativeValue,
            tokenContractAddress: item.tokenContractAddress,
            nonce: item.nonce,
            gasLimit: item.gasLimit,
            feeModel: item.feeModel,
            feeAmount: item.feeAmount,
            status: confirmation.state,
            blockTimestamp: item.blockTimestamp,
            confirmation: {
              state: confirmation.state,
              receipt: confirmation.receipt,
              polls: confirmation.polls,
              checkedAtMs: confirmation.checkedAtMs,
            },
            explorerUrl: item.presentation.explorerAvailability.url,
            observedAt: confirmation.checkedAtMs,
          });
        }
      }
      const outcome = reconciliationOutcome(lookup, confirmation);
      setReconcileMessage(reconciliationMessage(outcome));
      await loadItem();
    } catch {
      setReconcileMessage(
        'Unable to reconcile this transaction. No broadcast, signing, or automatic retry was performed.',
      );
    } finally {
      setReconciling(false);
    }
  }, [
    activityService,
    createBroadcastDependency,
    item,
    loadItem,
    reconciling,
  ]);

  const date = useMemo(() => (item ? dateParts(item) : null), [item]);

  return (
    <Modal animationType="slide" onRequestClose={onBack} visible>
      <View style={styles.screen}>
        <View style={styles.backgroundOrbTop} />
        <View style={styles.backgroundOrbBottom} />
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + theme.spacing.sm },
          ]}
        >
          <Pressable
            accessibilityLabel="Back to Activity"
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={20} color={theme.colors.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.cardEyebrow}>WAVEX WALLET</Text>
            <Text style={styles.headerTitle}>Transaction Details</Text>
          </View>
        </View>
        {state === 'loading' ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.stateTitle}>Loading transaction details</Text>
          </View>
        ) : state !== 'available' || !item ? (
          <View style={styles.stateCard}>
            <Ionicons
              name={state === 'error' ? 'alert-circle-outline' : 'lock-closed-outline'}
              size={26}
              color={theme.colors.accent}
            />
            <Text style={styles.stateTitle}>
              {state === 'error'
                ? 'Details unavailable'
                : 'Transaction not available'}
            </Text>
            <Text style={styles.stateBody}>
              {errorMessage ??
                'The authoritative activity record is not available for this account and network context.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom:
                  insets.bottom + (Platform.OS === 'web' ? 34 : theme.spacing.xl),
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <SectionCard title="TRANSACTION SUMMARY">
              <View
                accessible
                accessibilityLabel={`${detailSummaryLabel(item)} ${item.presentation.primaryAmount.signedDisplay ?? ''} on ${item.presentation.network.name}`}
                style={styles.summary}
              >
                <AssetVisual item={item} />
                <View style={styles.summaryCopy}>
                  <Text style={styles.summaryTitle}>{detailSummaryLabel(item)}</Text>
                  <Text style={styles.summaryAsset}>
                    {assetLabel(item)} · {item.presentation.network.name}
                  </Text>
                  <Text
                    style={[
                      styles.summaryAmount,
                      item.presentation.primaryAmount.sign === 'positive' &&
                        styles.amountPositive,
                    ]}
                  >
                    {item.presentation.primaryAmount.signedDisplay ?? 'Amount unavailable'}
                  </Text>
                </View>
              </View>
              {item.presentation.action === 'swapped' &&
              item.presentation.secondaryAsset &&
              item.presentation.secondaryAmount ? (
                <AmountLine
                  label="Output"
                  positive
                  symbol={item.presentation.secondaryAmount.symbol}
                  value={item.presentation.secondaryAmount.display}
                />
              ) : null}
              {item.localTransactionId === null ? (
                <Text style={styles.neutralOrigin}>
                  Origin not established by WAVEX. This is public blockchain activity.
                </Text>
              ) : null}
            </SectionCard>

            {(() => {
              const status = detailStatusCopy(item.status);
              return (
                <SectionCard title="STATUS" warning={status.tone === 'warning'}>
                  <View accessible accessibilityLabel={`Status ${status.label}`} style={styles.statusRow}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(status.tone) }]} />
                    <Text style={[styles.statusTitle, { color: statusColor(status.tone) }]}>
                      {status.label}
                    </Text>
                  </View>
                  <Text style={styles.explanation}>{status.explanation}</Text>
                  <Pressable
                    accessibilityLabel="Refresh transaction status"
                    accessibilityRole="button"
                    disabled={reconciling || !item.transactionHash}
                    onPress={() => void handleReconcile()}
                    style={({ pressed }) => [
                      styles.refreshButton,
                      (reconciling || !item.transactionHash) && styles.disabledButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    {reconciling ? (
                      <ActivityIndicator color={theme.colors.primaryForeground} size="small" />
                    ) : (
                      <Ionicons name="refresh-outline" size={17} color={theme.colors.primaryForeground} />
                    )}
                    <Text style={styles.refreshButtonText}>
                      {reconciling ? 'Checking' : 'Refresh status'}
                    </Text>
                  </Pressable>
                  {reconcileMessage ? (
                    <Text accessibilityLiveRegion="polite" style={styles.reconcileMessage}>
                      {reconcileMessage}
                    </Text>
                  ) : null}
                </SectionCard>
              );
            })()}

            <SectionCard title="FROM / TO">
              <DetailRow
                label="From"
                onCopy={() => void copyValue('Sender address', item.senderAddress)}
                secondary={shortDetailValue(item.senderAddress) ?? undefined}
                value={item.senderAddress}
              />
              {item.presentation.counterparty.address ? (
                <DetailRow
                  label={item.presentation.counterparty.directionLabel ?? 'Counterparty'}
                  onCopy={() =>
                    void copyValue(
                      'Counterparty address',
                      item.presentation.counterparty.address,
                    )
                  }
                  secondary={item.presentation.counterparty.displayAddress ?? undefined}
                  value={item.presentation.counterparty.address}
                />
              ) : null}
            </SectionCard>

            <SectionCard title="ASSET / AMOUNT">
              <AmountLine
                label="Amount"
                positive={item.presentation.primaryAmount.sign === 'positive'}
                symbol={item.presentation.primaryAmount.symbol}
                value={item.presentation.primaryAmount.display}
              />
              <DetailRow
                label="Asset"
                value={
                  item.presentation.primaryAsset?.name ??
                  item.presentation.primaryAsset?.symbol ??
                  'Metadata unavailable'
                }
                secondary={
                  item.presentation.primaryAsset?.symbol
                    ? `${item.presentation.primaryAsset.symbol} · ${
                        item.presentation.primaryAsset.metadataStatus
                      } metadata`
                    : 'Metadata unavailable'
                }
              />
              {item.tokenContractAddress ? (
                <DetailRow
                  label="Token contract"
                  onCopy={() =>
                    void copyValue('Token contract address', item.tokenContractAddress)
                  }
                  secondary={shortDetailValue(item.tokenContractAddress) ?? undefined}
                  value={item.tokenContractAddress}
                />
              ) : null}
            </SectionCard>

            <SectionCard title="NETWORK">
              <DetailRow label="Network" value={item.presentation.network.name} />
              <DetailRow label="Chain ID" value={item.chainId.toString()} />
              <DetailRow
                label="Configuration"
                value={
                  item.presentation.network.configured
                    ? 'Configured'
                    : 'Unavailable or unconfigured'
                }
              />
            </SectionCard>

            <SectionCard title="NETWORK FEE">
              {item.feeAmount !== null ? (
                <AmountLine
                  label="Network fee"
                  symbol={networkRegistry.getById(item.networkId)?.nativeCurrency.symbol ?? null}
                  value={formatFee(item, networkRegistry)}
                />
              ) : (
                <Text style={styles.mutedValue}>Fee unavailable</Text>
              )}
              {item.feeModel ? (
                <DetailRow
                  label="Fee model"
                  value={item.feeModel === 'eip1559' ? 'EIP-1559' : 'Legacy'}
                />
              ) : null}
              {item.gasLimit !== null ? (
                <DetailRow label="Gas limit" value={item.gasLimit.toString()} />
              ) : null}
              {item.confirmation?.receipt?.gasUsed !== undefined &&
              item.confirmation.receipt.gasUsed !== null ? (
                <DetailRow
                  label="Gas used"
                  value={item.confirmation.receipt.gasUsed.toString()}
                />
              ) : null}
              {item.confirmation?.receipt?.effectiveGasPrice !== null &&
              item.confirmation?.receipt?.effectiveGasPrice !== undefined ? (
                <DetailRow
                  label="Effective gas price"
                  value={item.confirmation.receipt.effectiveGasPrice.toString()}
                />
              ) : null}
            </SectionCard>

            <SectionCard title="TRANSACTION DETAILS">
              <DetailRow label="Type" value={transactionTypeLabel(item)} />
              {item.transactionHash ? (
                <DetailRow
                  label="Transaction hash"
                  onCopy={() => void copyValue('Transaction hash', item.transactionHash)}
                  secondary={shortDetailValue(item.transactionHash) ?? undefined}
                  value={item.transactionHash}
                />
              ) : (
                <DetailRow label="Transaction hash" value="Not yet available" />
              )}
              {item.localTransactionId ? (
                <DetailRow label="Local transaction ID" value={item.localTransactionId} />
              ) : null}
              {item.nonce !== null ? (
                <DetailRow label="Nonce" value={item.nonce.toString()} />
              ) : null}
              {item.confirmation?.receipt?.blockNumber !== undefined &&
              item.confirmation.receipt.blockNumber !== null ? (
                <DetailRow
                  label="Block number"
                  value={item.confirmation.receipt.blockNumber.toString()}
                />
              ) : null}
              {date ? (
                <DetailRow label="Time" secondary={date.source} value={date.value} />
              ) : null}
              <DetailRow
                label="Confirmation checks"
                value={
                  item.confirmation
                    ? item.confirmation.polls.toString()
                    : 'Unavailable'
                }
              />
            </SectionCard>

            {item.presentation.explorerAvailability.available &&
            item.presentation.explorerAvailability.url ? (
              <Pressable
                accessibilityLabel="View transaction on Explorer"
                accessibilityRole="button"
                onPress={() =>
                  void Linking.openURL(item.presentation.explorerAvailability.url!)
                }
                style={({ pressed }) => [styles.explorerButton, pressed && styles.pressed]}
              >
                <Ionicons name="open-outline" size={18} color={theme.colors.accent} />
                <Text style={styles.explorerText}>
                  View on {item.presentation.explorerAvailability.explorerName ?? 'Explorer'}
                </Text>
              </Pressable>
            ) : null}
            {copyState ? (
              <Text accessibilityLiveRegion="polite" style={styles.copyNotice}>
                {copyState}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function formatFee(
  item: ActivityReadModelItem,
  networkRegistry: NetworkRegistry,
): string | null {
  const decimals = networkRegistry.getById(item.networkId)?.nativeCurrency.decimals;
  return decimals === undefined
    ? item.feeAmount?.toString() ?? null
    : formatExactQuantity(item.feeAmount, decimals);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  backgroundOrbTop: { position: 'absolute', top: -140, right: -110, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(80, 217, 255, 0.07)' },
  backgroundOrbBottom: { position: 'absolute', bottom: -160, left: -140, width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(124, 140, 255, 0.07)' },
  header: { minHeight: 68, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  headerCopy: { flex: 1, gap: 1 },
  headerTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24, lineHeight: 30 },
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.md },
  card: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.panel },
  warningCard: { borderColor: 'rgba(244, 200, 107, 0.38)' },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.25 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  assetVisual: { width: 58, height: 58, position: 'relative', flexShrink: 0 },
  assetCircle: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: 'rgba(124, 140, 255, 0.16)', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.36)' },
  assetImage: { width: 36, height: 36, borderRadius: 12 },
  assetInitials: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 14 },
  networkBadge: { position: 'absolute', right: -5, bottom: -5, minWidth: 24, height: 24, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.colors.secondary, borderWidth: 2, borderColor: theme.colors.background },
  networkBadgeUnavailable: { backgroundColor: theme.colors.muted },
  networkBadgeText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 8, letterSpacing: 0.3 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  summaryTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 23, lineHeight: 28 },
  summaryAsset: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12 },
  summaryAmount: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 17, marginTop: 3 },
  neutralOrigin: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusTitle: { flex: 1, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  explanation: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  refreshButton: { minHeight: 42, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary },
  refreshButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  disabledButton: { opacity: theme.states.disabledOpacity },
  reconcileMessage: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  detailRow: { minWidth: 0, paddingVertical: 5, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.12)' },
  detailLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11, lineHeight: 18 },
  detailValueColumn: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 2 },
  detailValue: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  detailSecondary: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 10, lineHeight: 15, textAlign: 'right' },
  copyButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3 },
  copyText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10 },
  amountLine: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  amountValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, textAlign: 'right' },
  amountPositive: { color: theme.states.success },
  mutedValue: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12 },
  explorerButton: { minHeight: 48, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)' },
  explorerText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  copyNotice: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, textAlign: 'center' },
  stateCard: { margin: theme.spacing.lg, padding: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border },
  stateTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15, textAlign: 'center' },
  stateBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: theme.states.pressedOpacity },
});