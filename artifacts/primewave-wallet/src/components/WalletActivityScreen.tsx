import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type {
  ActivityAssetPresentation,
  ActivityReadModelItem,
  ActivityReadModelService,
} from '@/src/core/activity';
import { TransactionDetailScreen } from './TransactionDetailScreen';
import { createTransactionDetailSelection } from './TransactionDetailScreen.logic';
import type {
  TransactionDetailActivityDependency,
  TransactionDetailBroadcastDependency,
} from './TransactionDetailScreen.logic';
import {
  activityActionIcon,
  activityActionLabel,
  activityContextLabel,
  activityFilterOptions,
  activityStatusLabel,
  filterActivityItems,
  groupActivityItems,
  networksForActivityFilter,
  readableActivityLabel,
  shortActivityAddress,
  statusTone,
  type ActivityTypeFilter,
} from './WalletActivityScreen.logic';

type ActivityState = 'loading' | 'available' | 'empty' | 'unavailable' | 'error';
type NetworkFilter = 'all' | string;

type ActivityReadModelDependency = Pick<ActivityReadModelService, 'getActivity'>;

export interface WalletActivityScreenProps {
  readonly accountId: string | null;
  readonly activityReadModelService: ActivityReadModelDependency | null;
  readonly activityService?: TransactionDetailActivityDependency | null;
  readonly createBroadcastDependency?: (
    networkId: string,
  ) => Promise<TransactionDetailBroadcastDependency | null>;
  readonly networkRegistry: NetworkRegistry;
  readonly onBack: () => void;
}

function assetLabel(asset: ActivityAssetPresentation | null): string {
  return asset?.symbol ?? asset?.name ?? 'Asset';
}

function statusColor(status: ActivityReadModelItem['presentation']['status']): string {
  const tone = statusTone(status);
  if (tone === 'success') return theme.states.success;
  if (tone === 'warning') return theme.states.warning;
  if (tone === 'danger') return theme.colors.destructive;
  return theme.colors.mutedForeground;
}

function sortActivityItems(
  left: ActivityReadModelItem,
  right: ActivityReadModelItem,
): number {
  const leftTimestamp = left.presentation.timestamp.timestamp ?? left.observedAt;
  const rightTimestamp = right.presentation.timestamp.timestamp ?? right.observedAt;
  const normalizedLeftTimestamp =
    leftTimestamp < 100_000_000_000 ? leftTimestamp * 1000 : leftTimestamp;
  const normalizedRightTimestamp =
    rightTimestamp < 100_000_000_000 ? rightTimestamp * 1000 : rightTimestamp;
  if (normalizedLeftTimestamp !== normalizedRightTimestamp) {
    return normalizedRightTimestamp - normalizedLeftTimestamp;
  }
  return left.identity.localeCompare(right.identity);
}

function ActivityAssetVisual({
  asset,
  network,
  action,
}: {
  readonly asset: ActivityAssetPresentation | null;
  readonly network: ActivityReadModelItem['presentation']['network'];
  readonly action: ActivityReadModelItem['presentation']['action'];
}) {
  const hasRemoteReference =
    asset?.icon.status === 'available' && asset.icon.reference !== null;
  const networkAsset = asset?.icon.fallback.initials ?? '––';
  return (
    <View style={styles.assetVisual}>
      <View style={styles.assetCircle}>
        {hasRemoteReference ? (
          <Image
            accessibilityLabel={`${assetLabel(asset)} icon`}
            contentFit="contain"
            source={{ uri: asset.icon.reference as string }}
            style={styles.assetImage}
          />
        ) : (
          <Text style={styles.assetInitials}>
            {asset ? networkAsset : action === 'swapped' ? '↔' : '··'}
          </Text>
        )}
      </View>
      <View
        accessibilityLabel={`${network.name} network badge`}
        style={[
          styles.networkBadge,
          !network.available && styles.networkBadgeUnavailable,
        ]}
      >
        <Text style={styles.networkBadgeText}>
          {network.badgeFallbackInitials || '??'}
        </Text>
      </View>
    </View>
  );
}

function ActivityAmount({
  item,
}: {
  readonly item: ActivityReadModelItem;
}) {
  const presentation = item.presentation;
  const amountLines = [
    presentation.primaryAmount.signedDisplay,
    presentation.secondaryAmount?.signedDisplay,
  ].filter((value): value is string => Boolean(value));
  return (
    <View style={styles.amountColumn}>
      {amountLines.length > 0 ? (
        amountLines.map((value, index) => (
          <Text
            key={`${value}-${index}`}
            numberOfLines={1}
            style={[
              styles.amountText,
              value.startsWith('+') && styles.amountPositive,
              value.startsWith('-') && styles.amountNegative,
            ]}
          >
            {value}
          </Text>
        ))
      ) : (
        <Text style={styles.amountUnavailable}>Amount unavailable</Text>
      )}
      {presentation.fiatValue ? (
        <Text numberOfLines={1} style={styles.fiatText}>
          {presentation.fiatValue.display}
        </Text>
      ) : null}
    </View>
  );
}

export function ActivityRow({
  item,
  onPress,
}: {
  readonly item: ActivityReadModelItem;
  readonly onPress: () => void;
}) {
  const presentation = item.presentation;
  const label = readableActivityLabel(item);
  const action = activityActionLabel(item);
  const isSwap =
    presentation.action === 'swapped' &&
    presentation.secondaryAsset !== null &&
    presentation.secondaryAmount !== null;
  return (
    <Pressable
      accessibilityHint="Opens read-only transaction details"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}
      testID={`activity-row-${item.identity}`}
    >
      <ActivityAssetVisual
        action={presentation.action}
        asset={presentation.primaryAsset}
        network={presentation.network}
      />
      <View style={styles.activityCopy}>
        <View style={styles.actionLine}>
          <Ionicons
            accessibilityElementsHidden
            name={activityActionIcon(presentation.action) as keyof typeof Ionicons.glyphMap}
            size={14}
            color={theme.colors.accent}
          />
          <Text numberOfLines={1} style={styles.actionText}>
            {action}
          </Text>
        </View>
        {isSwap ? (
          <Text numberOfLines={1} style={styles.swapText}>
            {assetLabel(presentation.primaryAsset)} → {assetLabel(presentation.secondaryAsset)}
          </Text>
        ) : (
          <Text numberOfLines={1} style={styles.contextText}>
            {activityContextLabel(item)}
          </Text>
        )}
        <View style={styles.rowMeta}>
          <Text numberOfLines={1} style={styles.networkText}>
            {presentation.network.name}
          </Text>
          <View style={styles.statusDotRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(presentation.status) },
              ]}
            />
            <Text style={[styles.statusText, { color: statusColor(presentation.status) }]}>
              {activityStatusLabel(presentation.status)}
            </Text>
          </View>
        </View>
      </View>
      <ActivityAmount item={item} />
    </Pressable>
  );
}

function FilterPill({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label} activity filter`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.filterPill, pressed && styles.pressed]}
      testID={`activity-filter-${label}`}
    >
      <Text numberOfLines={1} style={styles.filterPillText}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={14} color={theme.colors.accent} />
    </Pressable>
  );
}

function ActivityFiltersSheet({
  visible,
  typeFilter,
  networkFilter,
  typeOptions,
  networks,
  onClose,
  onTypeChange,
  onNetworkChange,
}: {
  readonly visible: boolean;
  readonly typeFilter: ActivityTypeFilter;
  readonly networkFilter: NetworkFilter;
  readonly typeOptions: ReturnType<typeof activityFilterOptions>;
  readonly networks: readonly EvmNetwork[];
  readonly onClose: () => void;
  readonly onTypeChange: (value: ActivityTypeFilter) => void;
  readonly onNetworkChange: (value: NetworkFilter) => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close activity filters"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.filterSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.cardEyebrow}>ACTIVITY VIEW</Text>
              <Text style={styles.sheetTitle}>Filter activity</Text>
            </View>
            <Pressable
              accessibilityLabel="Close activity filters"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={theme.colors.foreground} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.filterSectionLabel}>ACTIVITY TYPE</Text>
            <View style={styles.sheetOptions}>
              {typeOptions.map((option) => (
                <Pressable
                  accessibilityLabel={`${option.label} activity filter`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: typeFilter === option.value }}
                  key={option.value}
                  onPress={() => onTypeChange(option.value)}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    typeFilter === option.value && styles.sheetOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetOptionText,
                      typeFilter === option.value && styles.sheetOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {typeFilter === option.value ? (
                    <Ionicons name="checkmark-circle" size={17} color={theme.colors.accent} />
                  ) : null}
                </Pressable>
              ))}
            </View>
            <Text style={styles.filterSectionLabel}>NETWORK</Text>
            <View style={styles.sheetOptions}>
              <Pressable
                accessibilityLabel="All networks activity filter"
                accessibilityRole="radio"
                accessibilityState={{ checked: networkFilter === 'all' }}
                onPress={() => onNetworkChange('all')}
                style={({ pressed }) => [
                  styles.sheetOption,
                  networkFilter === 'all' && styles.sheetOptionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.sheetOptionText,
                    networkFilter === 'all' && styles.sheetOptionTextSelected,
                  ]}
                >
                  All networks
                </Text>
                {networkFilter === 'all' ? (
                  <Ionicons name="checkmark-circle" size={17} color={theme.colors.accent} />
                ) : null}
              </Pressable>
              {networks.map((network) => (
                <Pressable
                  accessibilityLabel={`${network.displayName} activity filter`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: networkFilter === network.id }}
                  key={network.id}
                  onPress={() => onNetworkChange(network.id)}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    networkFilter === network.id && styles.sheetOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.networkOptionCopy}>
                    <Text
                      style={[
                        styles.sheetOptionText,
                        networkFilter === network.id && styles.sheetOptionTextSelected,
                      ]}
                    >
                      {network.displayName}
                    </Text>
                    <Text style={styles.sheetOptionMeta}>
                      {network.configurationStatus === 'configured'
                        ? network.nativeCurrency.symbol
                        : 'Not configured'}
                    </Text>
                  </View>
                  {networkFilter === network.id ? (
                    <Ionicons name="checkmark-circle" size={17} color={theme.colors.accent} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable
            accessibilityLabel="Done filtering activity"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ActivitySkeleton() {
  return (
    <View accessibilityLabel="Loading activity" style={styles.activityList}>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={styles.skeletonCircle} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, styles.skeletonTitle]} />
            <View style={[styles.skeletonLine, styles.skeletonSubtitle]} />
          </View>
          <View style={[styles.skeletonLine, styles.skeletonAmount]} />
        </View>
      ))}
    </View>
  );
}

function ActivityStateCard({
  title,
  body,
  icon,
  action,
  onAction,
}: {
  readonly title: string;
  readonly body: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly action?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View style={styles.stateCard}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={23} color={theme.colors.accent} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {action && onAction ? (
        <Pressable
          accessibilityLabel={action}
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          <Ionicons name="refresh-outline" size={16} color={theme.colors.accent} />
          <Text style={styles.refreshText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function WalletActivityScreen({
  accountId,
  activityReadModelService,
  activityService,
  createBroadcastDependency,
  networkRegistry,
  onBack,
}: WalletActivityScreenProps) {
  const [activityState, setActivityState] = useState<ActivityState>('loading');
  const [items, setItems] = useState<readonly ActivityReadModelItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>('transactions');
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>('all');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<
    ReturnType<typeof createTransactionDetailSelection> | null
  >(null);

  const enabledNetworks = useMemo(
    () => networkRegistry.listEnabledNetworks(),
    [networkRegistry],
  );
  const typeOptions = useMemo(() => activityFilterOptions(items), [items]);
  const selectedTypeLabel =
    typeOptions.find((option) => option.value === typeFilter)?.label ??
    'Transactions';
  const selectedNetworkLabel =
    networkFilter === 'all'
      ? 'All networks'
      : networkRegistry.getById(networkFilter)?.displayName ?? 'Network';

  const loadActivity = useCallback(
    async (isRefresh = false) => {
      if (!activityReadModelService || !accountId) {
        setActivityState('unavailable');
        setItems([]);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setActivityState('loading');
      setErrorMessage(null);

      try {
        const nextItems = networksForActivityFilter(enabledNetworks, networkFilter)
          .filter((candidate): candidate is EvmNetwork & { chainId: number } => candidate.chainId !== null)
          .flatMap((candidate) =>
            activityReadModelService.getActivity({
              accountId,
              networkId: candidate.id,
              chainId: BigInt(candidate.chainId),
              limit: 50,
            }).items,
          )
          .sort(sortActivityItems);
        setItems(nextItems);
        setActivityState(nextItems.length === 0 ? 'empty' : 'available');
      } catch {
        setErrorMessage('Activity data is currently unavailable. Try refreshing again.');
        setActivityState('error');
      } finally {
        setRefreshing(false);
      }
    },
    [
      accountId,
      activityReadModelService,
      enabledNetworks,
      networkFilter,
    ],
  );

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const filteredItems = useMemo(
    () => filterActivityItems(items, typeFilter),
    [items, typeFilter],
  );
  const groups = useMemo(() => groupActivityItems(filteredItems), [filteredItems]);

  const renderGroup = useCallback(
    ({ item }: { item: ReturnType<typeof groupActivityItems>[number] }) => (
      <View style={styles.dateGroup}>
        <Text style={styles.dateLabel}>{item.label}</Text>
        <View style={styles.activityList}>
          {item.items.map((activity) => (
            <ActivityRow
              item={activity}
              key={activity.identity}
              onPress={() =>
                setSelectedActivity(createTransactionDetailSelection(activity))
              }
            />
          ))}
        </View>
      </View>
    ),
    [],
  );

  const listHeader = (
    <View style={styles.screenHeader}>
      <View>
        <Text style={styles.cardEyebrow}>WALLET HISTORY</Text>
        <Text style={styles.screenTitle}>Activity</Text>
        <Text style={styles.screenIntro}>
          Asset-first activity for the active public account.
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Refresh activity"
        accessibilityRole="button"
        disabled={refreshing}
        onPress={() => void loadActivity(true)}
        style={({ pressed }) => [styles.refreshIcon, pressed && styles.pressed]}
      >
        {refreshing ? (
          <ActivityIndicator color={theme.colors.accent} size="small" />
        ) : (
          <Ionicons name="refresh-outline" size={18} color={theme.colors.accent} />
        )}
      </Pressable>
    </View>
  );

  const listControls = (
    <View style={styles.controls}>
      <FilterPill label={selectedTypeLabel} onPress={() => setFilterSheetVisible(true)} />
      <FilterPill label={selectedNetworkLabel} onPress={() => setFilterSheetVisible(true)} />
    </View>
  );

  let content: React.ReactNode;
  if (activityState === 'loading') {
    content = <ActivitySkeleton />;
  } else if (activityState === 'unavailable') {
    content = (
      <ActivityStateCard
        body="Activity is not available in this preview context. No fake transactions are shown."
        icon="cloud-offline-outline"
        title="Activity data unavailable"
      />
    );
  } else if (activityState === 'error') {
    content = (
      <ActivityStateCard
        action="Refresh activity"
        body={errorMessage ?? 'Activity data could not be loaded.'}
        icon="alert-circle-outline"
        onAction={() => void loadActivity(true)}
        title="Could not load activity"
      />
    );
  } else if (filteredItems.length === 0) {
    const title = items.length === 0
      ? networkFilter === 'all'
        ? 'No transactions yet'
        : 'No activity on this network'
      : 'No matching activity';
    content = (
      <ActivityStateCard
        body={
          items.length === 0
            ? 'Completed and in-progress activity will appear here when the existing activity architecture has records for this account.'
            : 'Try another activity type or network filter.'
        }
        icon="time-outline"
        title={title}
      />
    );
  } else {
    content = (
      <FlatList
        contentContainerStyle={styles.listContent}
        data={groups}
        keyExtractor={(item) => item.key}
        ListFooterComponent={
          errorMessage ? (
            <Text style={styles.refreshNotice}>Refresh note: {errorMessage}</Text>
          ) : null
        }
        renderItem={renderGroup}
        refreshControl={
          <RefreshControl
            colors={[theme.colors.accent]}
            onRefresh={() => void loadActivity(true)}
            refreshing={refreshing}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to Home"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <Text style={styles.cardEyebrow}>WAVEX WALLET</Text>
          <Text style={styles.topBarTitle}>Activity</Text>
        </View>
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={activityState === 'available' && filteredItems.length > 0 ? groups : []}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={
          <View style={styles.emptyContent}>
            {listHeader}
            {listControls}
            {content}
          </View>
        }
        ListHeaderComponent={
          activityState === 'available' && filteredItems.length > 0 ? (
            <>
              {listHeader}
              {listControls}
            </>
          ) : null
        }
        ListFooterComponent={
          activityState === 'available' && filteredItems.length > 0 && errorMessage ? (
            <Text style={styles.refreshNotice}>Refresh note: {errorMessage}</Text>
          ) : null
        }
        refreshControl={
          <RefreshControl
            colors={[theme.colors.accent]}
            onRefresh={() => void loadActivity(true)}
            refreshing={refreshing}
            tintColor={theme.colors.accent}
          />
        }
        renderItem={renderGroup}
        showsVerticalScrollIndicator={false}
      />
      <ActivityFiltersSheet
        networks={enabledNetworks}
        networkFilter={networkFilter}
        onClose={() => setFilterSheetVisible(false)}
        onNetworkChange={(value) => {
          setNetworkFilter(value);
          setFilterSheetVisible(false);
        }}
        onTypeChange={(value) => {
          setTypeFilter(value);
          setFilterSheetVisible(false);
        }}
        typeFilter={typeFilter}
        typeOptions={typeOptions}
        visible={filterSheetVisible}
      />
      {selectedActivity ? (
        <TransactionDetailScreen
          accountId={selectedActivity.accountId}
          activityId={selectedActivity.activityId}
          activityReadModelService={activityReadModelService}
          activityService={activityService}
          chainId={selectedActivity.chainId}
          createBroadcastDependency={createBroadcastDependency}
          networkId={selectedActivity.networkId}
          networkRegistry={networkRegistry}
          onBack={() => setSelectedActivity(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { minHeight: 54, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  topBarCopy: { flex: 1, gap: 1 },
  topBarTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25, lineHeight: 31 },
  listContent: { paddingHorizontal: theme.spacing.lg, paddingBottom: 112, gap: theme.spacing.lg },
  emptyContent: { gap: theme.spacing.lg },
  screenHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.25 },
  screenTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24, lineHeight: 30, marginTop: 4 },
  screenIntro: { maxWidth: 260, color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18, marginTop: 3 },
  refreshIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  controls: { flexDirection: 'row', gap: theme.spacing.sm },
  filterPill: { flex: 1, minHeight: 42, maxWidth: '50%', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7, borderRadius: theme.radius.pill, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  filterPillText: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  dateGroup: { gap: theme.spacing.sm },
  dateLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  activityList: { overflow: 'hidden', borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.82)', borderWidth: 1, borderColor: theme.colors.border },
  activityRow: { minHeight: 88, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  assetVisual: { width: 48, height: 48, position: 'relative', flexShrink: 0 },
  assetCircle: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(124, 140, 255, 0.16)', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.32)' },
  assetImage: { width: 30, height: 30, borderRadius: 10 },
  assetInitials: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  networkBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 21, height: 21, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.colors.secondary, borderWidth: 2, borderColor: theme.colors.background },
  networkBadgeUnavailable: { backgroundColor: theme.colors.muted },
  networkBadgeText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 8, letterSpacing: 0.3 },
  activityCopy: { flex: 1, minWidth: 0, gap: 3 },
  actionLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  contextText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  swapText: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  networkText: { flexShrink: 1, color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.4 },
  statusDotRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.3 },
  amountColumn: { maxWidth: '42%', minWidth: 70, alignItems: 'flex-end', gap: 3 },
  amountText: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, textAlign: 'right' },
  amountPositive: { color: theme.states.success },
  amountNegative: { color: theme.colors.foreground },
  amountUnavailable: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 10, textAlign: 'right' },
  fiatText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 10, textAlign: 'right' },
  stateCard: { padding: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.82)', borderWidth: 1, borderColor: theme.colors.border },
  stateIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.24)' },
  stateTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16, textAlign: 'center' },
  stateBody: { maxWidth: 300, color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  refreshButton: { minHeight: 42, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  refreshText: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  refreshNotice: { color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  skeletonRow: { minHeight: 88, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  skeletonCircle: { width: 48, height: 48, borderRadius: 17, backgroundColor: 'rgba(126, 145, 191, 0.2)' },
  skeletonCopy: { flex: 1, gap: 9 },
  skeletonLine: { borderRadius: theme.radius.pill, backgroundColor: 'rgba(126, 145, 191, 0.2)' },
  skeletonTitle: { width: '55%', height: 12 },
  skeletonSubtitle: { width: '78%', height: 9 },
  skeletonAmount: { width: 56, height: 11 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 16, 0.72)' },
  filterSheet: { maxHeight: '86%', padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  detailSheet: { padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(126, 145, 191, 0.45)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25, lineHeight: 31, marginTop: 4 },
  sheetClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  filterSectionLabel: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.25, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  sheetOptions: { gap: theme.spacing.sm },
  sheetOption: { minHeight: 52, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.78)', borderWidth: 1, borderColor: theme.colors.border },
  sheetOptionSelected: { backgroundColor: 'rgba(80, 217, 255, 0.1)', borderColor: 'rgba(80, 217, 255, 0.5)' },
  sheetOptionText: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  sheetOptionTextSelected: { color: theme.colors.accent },
  sheetOptionMeta: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 10, marginTop: 2 },
  networkOptionCopy: { flex: 1 },
  doneButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.accent },
  doneButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  detailHero: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  detailIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  detailTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 22, lineHeight: 28 },
  detailBody: { maxWidth: 300, color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  detailRows: { gap: theme.spacing.sm },
  detailRow: { minHeight: 44, paddingHorizontal: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  detailLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.8 },
  detailValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, textAlign: 'right' },
  explorerNotice: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.22)' },
  explorerNoticeText: { flex: 1, color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  pressed: { opacity: theme.states.pressedOpacity },
});