import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import {
  PortfolioReadModelError,
  type PortfolioAssetViewModel,
  type PortfolioReadModel,
  type PortfolioReadModelService,
} from '@/src/core/portfolio';
import type { ActivityReadModelService } from '@/src/core/activity';
import type { Wallet } from '@/src/core/wallet/models';
import { ReceiveScreen } from './ReceiveScreen';
import {
  TransactionReviewScreen,
} from './TransactionReviewScreen';
import type {
  PublicReviewConfirmationResult,
  TransactionActivityDependency,
  TransactionBroadcastDependency,
  TransactionConstructionDependency,
  TransactionSigningDependency,
} from './TransactionReviewScreen.logic';
import { WalletSendScreen } from './WalletSendScreen';
import { WalletActivityScreen } from './WalletActivityScreen';
import { assetIdentityKey, type PublicSendDraft } from './WalletSendScreen.logic';
import { copyPublicAddress } from './public-address-actions';
import {
  assetDisplayName,
  assetDisplaySubtitle,
  assetStateLabel,
  filterPortfolioAssets,
  type AssetFilter,
  getPortfolioState,
  homeNavigationLabels,
  safePortfolioMessage,
  shortPublicAddress,
} from './WalletHomeShell.logic';

const iconSource = require('../../assets/images/icon.png');

type Destination = 'home' | 'assets' | 'receive' | 'send' | 'swap' | 'activity' | 'settings';
type PortfolioState = 'loading' | 'available' | 'empty' | 'unavailable' | 'error';

export type NetworkSelectionResult =
  | { ok: true; network: EvmNetwork }
  | { ok: false; message: string };

const navigationItems: readonly {
  readonly key: Destination;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'home', label: homeNavigationLabels[0], icon: 'home-outline' },
  { key: 'assets', label: homeNavigationLabels[1], icon: 'layers-outline' },
  { key: 'swap', label: homeNavigationLabels[2], icon: 'swap-horizontal-outline' },
  { key: 'activity', label: homeNavigationLabels[3], icon: 'time-outline' },
  { key: 'settings', label: homeNavigationLabels[4], icon: 'settings-outline' },
];

function stateColor(asset: PortfolioAssetViewModel): string {
  if (asset.availabilityState === 'available' && asset.balanceState === 'positive') {
    return theme.states.success;
  }
  if (asset.availabilityState === 'available') return theme.colors.accent;
  if (asset.availabilityState === 'stale') return theme.states.warning;
  return theme.colors.mutedForeground;
}

function AssetIconView({ asset }: { asset: PortfolioAssetViewModel }) {
  const hasRemoteReference =
    asset.icon.status === 'available' && asset.icon.reference !== null;

  return (
    <View style={styles.assetIcon}>
      {hasRemoteReference ? (
        <Image
          accessibilityLabel={`${assetDisplayName(asset)} icon`}
          contentFit="contain"
          source={{ uri: asset.icon.reference as string }}
          style={styles.assetIconImage}
        />
      ) : (
        <Text style={styles.assetInitials}>{asset.icon.fallback.initials}</Text>
      )}
    </View>
  );
}

function Header({
  wallet,
  detailMode,
  onBack,
  onAccountPress,
  onSettingsPress,
}: {
  wallet: Wallet;
  detailMode: 'receive' | 'send' | 'activity' | null;
  onBack: () => void;
  onAccountPress: () => void;
  onSettingsPress: () => void;
}) {
  const account = wallet.accounts[0];
  const accountLabel = account ? `Account ${account.index + 1}` : 'Account';
  return (
    <View style={styles.homeHeader}>
      <View style={styles.brandLockup}>
        <View style={styles.brandMark}>
          <Image source={iconSource} style={styles.brandIcon} />
        </View>
        <View>
          <Text style={styles.brandName}>WAVEX</Text>
          <Text style={styles.brandProduct}>{detailMode ? detailMode.toUpperCase() : 'WALLET'}</Text>
        </View>
      </View>
      {detailMode ? (
        <Pressable
          accessibilityLabel="Back to Home"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.receiveHeaderBack, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.receiveHeaderBackText}>Back</Text>
        </Pressable>
      ) : (
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel={`Open ${accountLabel} account details`}
            accessibilityRole="button"
            onPress={onAccountPress}
            style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}
          >
            <Text style={styles.accountButtonLabel}>{accountLabel}</Text>
            <Text style={styles.accountButtonAddress}>
              {account ? shortPublicAddress(account.address) : 'Unavailable'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            onPress={onSettingsPress}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
          >
            <Ionicons name="settings-outline" size={19} color={theme.colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AccountPanel({
  visible,
  wallet,
  onClose,
  onLock,
}: {
  visible: boolean;
  wallet: Wallet;
  onClose: () => void;
  onLock: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const account = wallet.accounts[0];
  const accountLabel = account ? `Account ${account.index + 1}` : 'Account unavailable';

  useEffect(() => {
    if (visible) setCopyState('idle');
  }, [visible]);

  const copyAddress = async () => {
    if (!account) return;
    try {
      await copyPublicAddress(account.address);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close account panel"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.accountSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.cardEyebrow}>PUBLIC ACCOUNT</Text>
              <Text style={styles.sheetTitle}>{accountLabel}</Text>
            </View>
            <Pressable
              accessibilityLabel="Close account panel"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={theme.colors.foreground} />
            </Pressable>
          </View>
          <View style={styles.accountStatusCard}>
            <View style={styles.accountStatusIcon}>
              <Ionicons name="person-outline" size={22} color={theme.colors.accent} />
            </View>
            <View style={styles.accountStatusCopy}>
              <Text style={styles.accountStatusTitle}>Unlocked public account</Text>
              <Text style={styles.accountStatusBody}>
                Only public identity information is shown here.
              </Text>
            </View>
          </View>
          <Text style={styles.cardEyebrow}>FULL PUBLIC ADDRESS</Text>
          <View style={styles.fullAddressCard}>
            <Text selectable style={styles.fullAddressText}>
              {account?.address ?? 'Unavailable'}
            </Text>
            <Pressable
              accessibilityLabel="Copy public address"
              accessibilityRole="button"
              disabled={!account}
              onPress={() => void copyAddress()}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <Ionicons
                name={copyState === 'copied' ? 'checkmark' : 'copy-outline'}
                size={17}
                color={copyState === 'copied' ? theme.states.success : theme.colors.accent}
              />
              <Text style={styles.copyButtonText}>
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>
          {copyState === 'error' ? (
            <Text style={styles.copyError}>Could not copy the public address. Try again.</Text>
          ) : null}
          <View style={styles.accountDetailRow}>
            <Text style={styles.accountDetailLabel}>ACCOUNT INDEX</Text>
            <Text style={styles.accountDetailValue}>{account ? account.index : 'Unavailable'}</Text>
          </View>
          <Pressable
            accessibilityLabel="Lock wallet"
            accessibilityRole="button"
            onPress={onLock}
            style={({ pressed }) => [styles.sheetLockButton, pressed && styles.pressed]}
          >
              <Ionicons name="lock-closed-outline" size={18} color={theme.states.warning} />
            <Text style={styles.sheetLockText}>Lock wallet</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function NetworkSelector({
  visible,
  registry,
  selectedNetwork,
  onClose,
  onSelect,
}: {
  visible: boolean;
  registry: NetworkRegistry;
  selectedNetwork: EvmNetwork;
  onClose: () => void;
  onSelect: (networkId: string) => NetworkSelectionResult;
}) {
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const networks = registry.listNetworks();

  useEffect(() => {
    if (visible) setSelectionMessage(null);
  }, [visible]);

  const selectNetwork = (network: EvmNetwork) => {
    const result = onSelect(network.id);
    if (result.ok) {
      onClose();
      return;
    }
    setSelectionMessage(result.message);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close network selector"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.networkSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.cardEyebrow}>NETWORK CONTEXT</Text>
              <Text style={styles.sheetTitle}>Select network</Text>
            </View>
            <Pressable
              accessibilityLabel="Close network selector"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={theme.colors.foreground} />
            </Pressable>
          </View>
          <Text style={styles.sheetIntro}>
            Network changes are explicit and refresh the account-scoped portfolio.
          </Text>
          {selectionMessage ? (
            <View accessibilityRole="alert" style={styles.selectionMessage}>
              <Ionicons name="information-circle-outline" size={18} color={theme.states.warning} />
              <Text style={styles.selectionMessageText}>{selectionMessage}</Text>
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.networkList}
            showsVerticalScrollIndicator={false}
          >
            {networks.map((network) => {
              const selected = selectedNetwork.id === network.id;
              const configured = network.configurationStatus === 'configured';
              const status = !network.enabled
                ? 'Disabled'
                : configured
                  ? 'Configured'
                  : 'Not configured';
              return (
                <Pressable
                  accessibilityLabel={`${network.displayName}, ${status}${selected ? ', selected' : ''}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !network.enabled }}
                  key={network.id}
                  onPress={() => selectNetwork(network)}
                  style={({ pressed }) => [
                    styles.networkOption,
                    selected && styles.networkOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.networkOptionIcon, selected && styles.networkOptionIconSelected]}>
                    <Text style={styles.networkOptionInitial}>
                      {network.displayName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.networkOptionCopy}>
                    <View style={styles.networkOptionTitleRow}>
                      <Text numberOfLines={1} style={styles.networkOptionName}>
                        {network.displayName}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={16} color={theme.colors.accent} />
                      ) : null}
                    </View>
                    <Text style={styles.networkOptionMeta}>
                      {network.chainId === null ? 'Chain ID unavailable' : `Chain ID ${network.chainId}`}
                      {' • '}
                      {network.nativeCurrency.symbol}
                    </Text>
                    <Text style={styles.networkOptionEnvironment}>
                      {network.environment.toUpperCase()} • {status}
                    </Text>
                  </View>
                  <Ionicons
                    name={configured && network.enabled ? 'chevron-forward' : 'lock-closed-outline'}
                    size={16}
                    color={configured && network.enabled ? theme.colors.mutedForeground : theme.states.warning}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PreviewBanner({ previewMode }: { previewMode: boolean }) {
  if (!previewMode) return null;
  return (
    <View accessibilityRole="alert" style={styles.previewBanner}>
      <Ionicons name="flask-outline" size={16} color={theme.states.warning} />
      <View style={styles.previewBannerCopy}>
        <Text style={styles.previewBannerTitle}>PREVIEW TEST MODE</Text>
        <Text style={styles.previewBannerBody}>
          Development-only public identity. No native vault, secrets, or signing are used.
        </Text>
      </View>
    </View>
  );
}

function NetworkCard({
  network,
  onPress,
}: {
  network: EvmNetwork;
  onPress: () => void;
}) {
  const configured = network.configurationStatus === 'configured' && network.chainId !== null;
  return (
    <Pressable
      accessibilityLabel={`Selected network: ${network.displayName}. Open network selector.`}
      accessibilityRole="button"
      accessibilityState={{ disabled: false }}
      onPress={onPress}
      style={({ pressed }) => [styles.networkCard, pressed && styles.pressed]}
    >
      <View style={styles.networkIcon}>
        <Ionicons name="globe-outline" size={20} color={configured ? theme.colors.accent : theme.states.warning} />
      </View>
      <View style={styles.networkCopy}>
        <Text style={styles.cardEyebrow}>SELECTED NETWORK</Text>
        <Text style={styles.networkName}>{network.displayName}</Text>
        <Text style={styles.networkStatus}>
          {configured
            ? `${network.nativeCurrency.symbol} • Connected`
            : `${network.nativeCurrency.symbol} • Not configured`}
        </Text>
      </View>
      <View style={styles.networkChevron}>
        <Ionicons name="chevron-down" size={17} color={theme.colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function ActionButton({
  label,
  icon,
  comingSoon = true,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  comingSoon?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={comingSoon ? `${label}. Coming soon` : label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={theme.colors.accent} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function PortfolioSkeleton() {
  return (
    <View accessibilityLabel="Loading portfolio" style={styles.portfolioCard}>
      <View style={[styles.skeletonLine, styles.skeletonSmall]} />
      <View style={[styles.skeletonLine, styles.skeletonLarge]} />
      <View style={[styles.skeletonLine, styles.skeletonMedium]} />
      <View style={styles.skeletonAssetRow}>
        <View style={styles.skeletonCircle} />
        <View style={styles.skeletonAssetCopy}>
          <View style={[styles.skeletonLine, styles.skeletonAssetTitle]} />
          <View style={[styles.skeletonLine, styles.skeletonAssetSubtitle]} />
        </View>
      </View>
    </View>
  );
}

function PortfolioSummary({
  state,
  model,
  errorMessage,
  onRefresh,
  refreshing,
  networkConfigured,
}: {
  state: PortfolioState;
  model: PortfolioReadModel | null;
  errorMessage: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  networkConfigured: boolean;
}) {
  if (state === 'loading') return <PortfolioSkeleton />;

  if (state === 'unavailable') {
    return (
      <View style={[styles.portfolioCard, styles.unavailableCard]}>
        <View style={styles.stateIcon}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.states.warning} />
        </View>
        <Text style={styles.portfolioTitle}>Blockchain data unavailable</Text>
        <Text style={styles.portfolioBody}>
          {networkConfigured
            ? 'Blockchain data is currently unavailable. No balance is being shown as zero.'
            : 'This network is not configured yet. No balance is being shown as zero.'}
        </Text>
        <RefreshButton onPress={onRefresh} refreshing={refreshing} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[styles.portfolioCard, styles.errorCard]}>
        <View style={styles.stateIcon}>
          <Ionicons name="alert-circle-outline" size={22} color={theme.colors.destructive} />
        </View>
        <Text style={styles.portfolioTitle}>Could not load your assets</Text>
        <Text style={styles.portfolioBody}>{errorMessage}</Text>
        <RefreshButton onPress={onRefresh} refreshing={refreshing} />
      </View>
    );
  }

  const count = model?.visibleAssetCount ?? 0;
  return (
    <View style={styles.portfolioCard}>
      <View style={styles.portfolioCardHeader}>
        <View>
          <Text style={styles.cardEyebrow}>PORTFOLIO</Text>
          <Text style={styles.portfolioTitle}>Your assets</Text>
        </View>
        <RefreshButton onPress={onRefresh} refreshing={refreshing} compact />
      </View>
      <View style={styles.assetCountRow}>
        <Text style={styles.assetCount}>{count}</Text>
        <Text style={styles.assetCountLabel}>{count === 1 ? 'visible asset' : 'visible assets'}</Text>
      </View>
      <Text style={styles.portfolioBody}>
        Native balances and token amounts are shown without price or fiat estimates.
      </Text>
      {errorMessage ? (
        <Text style={styles.refreshNotice}>Refresh note: {errorMessage}</Text>
      ) : null}
    </View>
  );
}

function RefreshButton({
  onPress,
  refreshing,
  compact = false,
}: {
  onPress: () => void;
  refreshing: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel="Refresh portfolio"
      accessibilityRole="button"
      disabled={refreshing}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.refreshButtonCompact : styles.refreshButton,
        pressed && styles.pressed,
      ]}
    >
      {refreshing ? (
        <ActivityIndicator color={theme.colors.accent} size="small" />
      ) : (
        <>
          <Ionicons name="refresh-outline" size={16} color={theme.colors.accent} />
          {!compact ? <Text style={styles.refreshText}>Refresh</Text> : null}
        </>
      )}
    </Pressable>
  );
}

function AssetRow({
  asset,
  onPress,
}: {
  asset: PortfolioAssetViewModel;
  onPress?: () => void;
}) {
  const amount = asset.formattedBalance ?? 'Unavailable';
  const color = stateColor(asset);
  const content = (
    <>
      <AssetIconView asset={asset} />
      <View style={styles.assetCopy}>
        <Text numberOfLines={1} style={styles.assetName}>{assetDisplayName(asset)}</Text>
        <Text style={styles.assetSymbol}>{assetDisplaySubtitle(asset)}</Text>
      </View>
      <View style={styles.assetBalance}>
        <Text numberOfLines={1} style={styles.assetAmount}>{amount}</Text>
        <View style={styles.assetStateRow}>
          {asset.verificationStatus === 'verified' ? (
            <Ionicons
              accessibilityLabel="Verified asset"
              name="checkmark-circle"
              size={12}
              color={theme.states.success}
            />
          ) : null}
          <Text style={[styles.assetState, { color }]}>{assetStateLabel(asset)}</Text>
        </View>
        {asset.metadataStatus !== 'complete' ? (
          <Text style={styles.assetMetadataState}>
            {asset.metadataStatus.toUpperCase()} METADATA
          </Text>
        ) : null}
      </View>
      {onPress ? (
        <Ionicons
          accessibilityElementsHidden
          name="chevron-forward"
          size={16}
          color={theme.colors.mutedForeground}
        />
      ) : null}
    </>
  );

  return (
    <Pressable
      accessibilityLabel={`${assetDisplayName(asset)} ${assetDisplaySubtitle(asset)} balance ${amount}, ${assetStateLabel(asset)}`}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={styles.assetRow}
    >
      {content}
    </Pressable>
  );
}

function AssetPreview({
  state,
  model,
  onViewAll,
  onAssetPress,
}: {
  state: PortfolioState;
  model: PortfolioReadModel | null;
  onViewAll: () => void;
  onAssetPress: (asset: PortfolioAssetViewModel) => void;
}) {
  const assets = model?.assets.filter((asset) => asset.visibility === 'visible') ?? [];
  if (state === 'loading' || state === 'unavailable' || state === 'error') return null;

  return (
    <View style={styles.assetSection}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.cardEyebrow}>ASSET PREVIEW</Text>
          <Text style={styles.sectionTitle}>Balances</Text>
        </View>
        <Pressable
          accessibilityLabel="View all assets"
          accessibilityRole="button"
          onPress={onViewAll}
          style={({ pressed }) => [styles.viewAllButton, pressed && styles.pressed]}
        >
          <Text style={styles.viewAllText}>View all</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} />
        </Pressable>
      </View>
      {assets.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="layers-outline" size={24} color={theme.colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No assets yet</Text>
          <Text style={styles.emptyBody}>
            Assets will appear here when a configured network returns public balance data.
          </Text>
        </View>
      ) : (
        <View style={styles.assetList}>
          {assets.slice(0, 4).map((asset) => (
            <AssetRow
              key={`${asset.networkId}:${asset.identity.assetType}:${asset.identity.assetId}`}
              asset={asset}
              onPress={() => onAssetPress(asset)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AssetStatusPanel({
  state,
  errorMessage,
  networkConfigured,
  onRefresh,
  refreshing,
}: {
  state: PortfolioState;
  errorMessage: string | null;
  networkConfigured: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (state === 'loading') {
    return (
      <View accessibilityLabel="Loading assets" style={styles.assetsLoadingCard}>
        <View style={styles.assetsLoadingHeader}>
          <View style={[styles.skeletonLine, styles.skeletonSmall]} />
          <View style={[styles.skeletonLine, styles.skeletonCount]} />
        </View>
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.assetsSkeletonRow}>
            <View style={styles.skeletonCircle} />
            <View style={styles.skeletonAssetCopy}>
              <View style={[styles.skeletonLine, styles.skeletonAssetTitle]} />
              <View style={[styles.skeletonLine, styles.skeletonAssetSubtitle]} />
            </View>
            <View style={[styles.skeletonLine, styles.skeletonBalance]} />
          </View>
        ))}
      </View>
    );
  }

  if (state === 'unavailable' || state === 'error') {
    const isError = state === 'error';
    return (
      <View style={[styles.assetsStateCard, isError && styles.errorCard]}>
        <View style={[styles.stateIcon, isError && styles.errorStateIcon]}>
          <Ionicons
            name={isError ? 'alert-circle-outline' : 'cloud-offline-outline'}
            size={22}
            color={isError ? theme.colors.destructive : theme.states.warning}
          />
        </View>
        <Text style={styles.portfolioTitle}>
          {isError ? 'Could not load your assets' : 'Blockchain data unavailable'}
        </Text>
        <Text style={styles.portfolioBody}>
          {isError
            ? errorMessage
            : networkConfigured
              ? 'Blockchain data is currently unavailable. No balance is being shown as zero.'
              : 'This network is not configured yet. No balance is being shown as zero.'}
        </Text>
        <RefreshButton onPress={onRefresh} refreshing={refreshing} />
      </View>
    );
  }

  return null;
}

function AssetsScreen({
  state,
  model,
  errorMessage,
  network,
  onBack,
  onRefresh,
  onAssetPress,
  refreshing,
}: {
  state: PortfolioState;
  model: PortfolioReadModel | null;
  errorMessage: string | null;
  network: EvmNetwork;
  onBack: () => void;
  onRefresh: () => void;
  onAssetPress: (asset: PortfolioAssetViewModel) => void;
  refreshing: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('all');
  const assets = model?.assets ?? [];
  const filteredAssets = useMemo(
    () => filterPortfolioAssets(assets, filter, searchQuery),
    [assets, filter, searchQuery],
  );
  const counts = {
    all: assets.length,
    visible: assets.filter((asset) => asset.visibility === 'visible').length,
    hidden: assets.filter((asset) => asset.visibility === 'hidden').length,
  };

  return (
    <ScrollView
      contentContainerStyle={styles.assetsScrollContent}
      refreshControl={
        <RefreshControl
          colors={[theme.colors.accent]}
          onRefresh={onRefresh}
          refreshing={refreshing}
          tintColor={theme.colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.assetsTopBar}>
        <Pressable
          accessibilityLabel="Back to Home"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <View style={styles.assetsTopBarCopy}>
          <Text style={styles.cardEyebrow}>PORTFOLIO</Text>
          <Text style={styles.assetsTitle}>Assets</Text>
        </View>
        <RefreshButton
          compact
          onPress={onRefresh}
          refreshing={refreshing}
        />
      </View>
      <Text style={styles.assetsIntro}>
        Public balances for {network.displayName}. No price or fiat estimates are shown.
      </Text>
      <View style={styles.searchField}>
        <Ionicons name="search-outline" size={17} color={theme.colors.mutedForeground} />
        <TextInput
          accessibilityLabel="Search assets"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchQuery}
          placeholder="Search assets..."
          placeholderTextColor={theme.colors.mutedForeground}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel="Clear asset search"
            accessibilityRole="button"
            onPress={() => setSearchQuery('')}
            style={styles.searchClear}
          >
            <Ionicons name="close-circle" size={17} color={theme.colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <View accessibilityRole="tablist" style={styles.filterRow}>
        {(['all', 'visible', 'hidden'] as const).map((item) => {
          const selected = filter === item;
          return (
            <Pressable
              accessibilityLabel={`${item[0].toUpperCase()}${item.slice(1)} assets filter`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={item}
              onPress={() => setFilter(item)}
              style={({ pressed }) => [
                styles.filterChip,
                selected && styles.filterChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                {item[0].toUpperCase() + item.slice(1)}
              </Text>
              <Text style={[styles.filterChipCount, selected && styles.filterChipTextSelected]}>
                {counts[item]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <AssetStatusPanel
        errorMessage={errorMessage}
        networkConfigured={
          network.configurationStatus === 'configured' &&
          network.chainId !== null
        }
        onRefresh={onRefresh}
        refreshing={refreshing}
        state={state}
      />
      {state !== 'loading' && state !== 'unavailable' && state !== 'error' ? (
        filteredAssets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="layers-outline" size={26} color={theme.colors.mutedForeground} />
            <Text style={styles.emptyTitle}>
              {assets.length === 0
                ? 'No assets yet'
                : searchQuery.length > 0
                  ? 'No matching assets'
                  : filter === 'hidden'
                    ? 'No hidden assets'
                    : 'No visible assets'}
            </Text>
            <Text style={styles.emptyBody}>
              {assets.length === 0
                ? 'Assets will appear here when a configured network returns public balance data.'
                : 'Try another search or visibility filter.'}
            </Text>
          </View>
        ) : (
          <View style={styles.assetList}>
            {filteredAssets.map((asset) => (
              <AssetRow
                key={`${asset.networkId}:${asset.identity.assetType}:${asset.identity.assetId}`}
                asset={asset}
                onPress={() => onAssetPress(asset)}
              />
            ))}
          </View>
        )
      ) : null}
      {state === 'available' && errorMessage ? (
        <Text style={styles.refreshNotice}>Refresh note: {errorMessage}</Text>
      ) : null}
    </ScrollView>
  );
}

function PlaceholderDestination({
  destination,
  onBack,
}: {
  destination: Exclude<Destination, 'home' | 'assets' | 'receive' | 'send'>;
  onBack: () => void;
}) {
  const details = {
    swap: {
      icon: 'swap-horizontal-outline' as const,
      eyebrow: 'SWAP',
      title: 'Swap is coming soon.',
      body: 'No quote, price, approval, or transaction behavior is connected in this phase.',
    },
    activity: {
      icon: 'time-outline' as const,
      eyebrow: 'ACTIVITY',
      title: 'Activity is coming soon.',
      body: 'Transaction history is not available yet. No history service is queried by this screen.',
    },
    settings: {
      icon: 'settings-outline' as const,
      eyebrow: 'SETTINGS',
      title: 'Settings are coming soon.',
      body: 'Wallet security remains protected by the existing native flow. Product settings will be added separately.',
    },
  }[destination];

  return (
    <View style={styles.placeholderScreen}>
      <View style={styles.placeholderIcon}>
        <Ionicons name={details.icon} size={28} color={theme.colors.accent} />
      </View>
      <Text style={styles.cardEyebrow}>{details.eyebrow}</Text>
      <Text style={styles.placeholderTitle}>{details.title}</Text>
      <Text style={styles.placeholderBody}>{details.body}</Text>
      <Pressable
        accessibilityLabel="Return to Home"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back-outline" size={18} color={theme.colors.primaryForeground} />
        <Text style={styles.primaryButtonText}>Back to Home</Text>
      </Pressable>
    </View>
  );
}

export function WalletHomeShell({
  wallet,
  previewMode,
  network,
  networkRegistry,
  readModelService,
  createConstructionEngine,
  createSigningDependency,
  createBroadcastDependency,
  activityService,
  activityReadModelService,
  onNetworkSelect,
  onLock,
  onComingSoon,
}: {
  wallet: Wallet;
  previewMode: boolean;
  network: EvmNetwork;
  networkRegistry: NetworkRegistry;
  readModelService: PortfolioReadModelService;
  createConstructionEngine: (
    wallet: Wallet,
    networkId: string,
  ) => Promise<TransactionConstructionDependency | null>;
  createSigningDependency: (
    wallet: Wallet,
    networkId: string,
  ) => Promise<TransactionSigningDependency | null>;
  createBroadcastDependency: (
    networkId: string,
  ) => Promise<TransactionBroadcastDependency | null>;
  activityService?: TransactionActivityDependency | null;
  activityReadModelService?: Pick<ActivityReadModelService, 'getActivity'> | null;
  onNetworkSelect: (networkId: string) => NetworkSelectionResult;
  onLock: () => void;
  onComingSoon: (label: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [destination, setDestination] = useState<Destination>('home');
  const [accountPanelVisible, setAccountPanelVisible] = useState(false);
  const [networkSelectorVisible, setNetworkSelectorVisible] = useState(false);
  const [portfolioState, setPortfolioState] = useState<PortfolioState>('loading');
  const [portfolio, setPortfolio] = useState<PortfolioReadModel | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<PublicSendDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sendAssetKey, setSendAssetKey] = useState<string | null>(null);
  const account = wallet.accounts[0];

  const accountQuery = useMemo(
    () => ({
      accountId: account?.accountId ?? '',
      accountAddress: account?.address ?? '',
      networkId: network.id,
      includeHidden: true,
    }),
    [account?.accountId, account?.address, network.id],
  );

  const loadPortfolio = useCallback(
    async (isRefresh = false) => {
      if (!account) {
        setPortfolioState('error');
        setPortfolioError('The active public account is unavailable.');
        return;
      }
      if (isRefresh) setRefreshing(true);
      else {
        setPortfolio(null);
        setPortfolioState('loading');
      }
      setPortfolioError(null);
      try {
        const next = await readModelService.getPortfolio(accountQuery);
        setPortfolio(next);
        setPortfolioState(getPortfolioState(next.assets.length));
      } catch (error) {
        const message = safePortfolioMessage(error);
        setPortfolioError(message);
        if (isRefresh && portfolio) {
          setPortfolioState(getPortfolioState(portfolio.assets.length));
        } else if (error instanceof PortfolioReadModelError && error.code === 'READ_MODEL_AGGREGATION_FAILED') {
          setPortfolioState('error');
        } else {
          setPortfolioState('unavailable');
        }
      } finally {
        setRefreshing(false);
      }
    },
    [account, accountQuery, readModelService],
  );

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    if (reviewDraft && reviewDraft.networkId !== network.id) {
      setReviewDraft(null);
      setDestination('send');
    }
  }, [network.id, reviewDraft]);

  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={theme.gradients.background}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <View style={[styles.shellContent, { paddingTop: insets.top + 18 }]}>
        <Header
          onBack={() => setDestination('home')}
          wallet={wallet}
          detailMode={
            destination === 'receive'
              ? 'receive'
              : destination === 'send'
                ? 'send'
                : destination === 'activity'
                  ? 'activity'
                  : null
          }
          onAccountPress={() => setAccountPanelVisible(true)}
          onSettingsPress={() => setDestination('settings')}
        />
        <PreviewBanner previewMode={previewMode} />
        {destination === 'home' ? (
          <ScrollView
            contentContainerStyle={[
              styles.homeScrollContent,
              { paddingBottom: insets.bottom + 102 },
            ]}
            refreshControl={
              <RefreshControl
                colors={[theme.colors.accent]}
                onRefresh={() => void loadPortfolio(true)}
                refreshing={refreshing}
                tintColor={theme.colors.accent}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.greeting}>
              <Text style={styles.eyebrow}>{previewMode ? 'DEVELOPMENT • PREVIEW TEST MODE' : 'WALLET HOME'}</Text>
              <Text style={styles.heroTitle}>Good to see you.</Text>
              <Text style={styles.body}>
                {previewMode
                  ? 'A safe public preview of the WaveX wallet shell.'
                  : 'Your public wallet overview, without price estimates or hidden assumptions.'}
              </Text>
            </View>
            <NetworkCard
              network={network}
              onPress={() => setNetworkSelectorVisible(true)}
            />
            <PortfolioSummary
              errorMessage={portfolioError}
              model={portfolio}
              networkConfigured={
                network.configurationStatus === 'configured' &&
                network.chainId !== null
              }
              onRefresh={() => void loadPortfolio(true)}
              refreshing={refreshing}
              state={portfolioState}
            />
            <View style={styles.actionsSection}>
              <Text style={styles.cardEyebrow}>QUICK ACTIONS</Text>
              <View style={styles.actionsRow}>
                <ActionButton
                  icon="arrow-up-outline"
                  label="Send"
                  onPress={() => {
                    setSendAssetKey(null);
                    setReviewDraft(null);
                    setDestination('send');
                  }}
                />
                <ActionButton
                  comingSoon={false}
                  icon="arrow-down-outline"
                  label="Receive"
                  onPress={() => setDestination('receive')}
                />
                <ActionButton icon="scan-outline" label="Scan" onPress={() => onComingSoon('QR scanning is coming soon.')} />
              </View>
            </View>
            <AssetPreview
              model={portfolio}
              onAssetPress={(asset) => {
                setSendAssetKey(assetIdentityKey(asset.identity));
                setReviewDraft(null);
                setDestination('send');
              }}
              onViewAll={() => setDestination('assets')}
              state={portfolioState}
            />
            <Pressable
              accessibilityLabel="Lock wallet"
              accessibilityRole="button"
              onPress={onLock}
              style={({ pressed }) => [styles.lockButton, pressed && styles.pressed]}
            >
              <Ionicons name="lock-closed-outline" size={16} color={theme.colors.mutedForeground} />
              <Text style={styles.lockButtonText}>Lock wallet</Text>
            </Pressable>
          </ScrollView>
        ) : destination === 'receive' ? (
          <ReceiveScreen
            network={network}
            onBack={() => setDestination('home')}
            wallet={wallet}
          />
        ) : destination === 'send' ? (
          reviewDraft ? (
            <TransactionReviewScreen
              activityService={activityService}
              createBroadcastDependency={createBroadcastDependency}
              createConstructionEngine={createConstructionEngine}
              createSigningDependency={createSigningDependency}
              draft={reviewDraft}
              network={network}
              networkRegistry={networkRegistry}
              onBack={() => setReviewDraft(null)}
              onConfirmed={(_result: PublicReviewConfirmationResult) => undefined}
              portfolio={portfolio}
              wallet={wallet}
            />
          ) : (
            <WalletSendScreen
              initialAsset={
                portfolio?.assets.find(
                  (asset) => assetIdentityKey(asset.identity) === sendAssetKey,
                ) ?? null
              }
              network={network}
              onBack={() => setDestination('home')}
              onComingSoon={onComingSoon}
              onNetworkPress={() => setNetworkSelectorVisible(true)}
              onReviewDraft={(draft) => {
                setSendAssetKey(assetIdentityKey(draft.selectedAssetIdentity));
                setReviewDraft(draft);
              }}
              portfolio={portfolio}
              portfolioState={portfolioState}
              wallet={wallet}
            />
          )
        ) : destination === 'assets' ? (
          <AssetsScreen
            errorMessage={portfolioError}
            model={portfolio}
            network={network}
            onAssetPress={(asset) => {
              setSendAssetKey(assetIdentityKey(asset.identity));
              setDestination('send');
            }}
            onBack={() => setDestination('home')}
            onRefresh={() => void loadPortfolio(true)}
            refreshing={refreshing}
            state={portfolioState}
          />
        ) : destination === 'activity' ? (
          <WalletActivityScreen
            accountId={account?.accountId ?? null}
            activityService={activityService}
            activityReadModelService={activityReadModelService ?? null}
            createBroadcastDependency={createBroadcastDependency}
            networkRegistry={networkRegistry}
            onBack={() => setDestination('home')}
          />
        ) : (
          <PlaceholderDestination
            destination={destination}
            onBack={() => setDestination('home')}
          />
        )}
      </View>
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {navigationItems.map((item) => {
          const selected = destination === item.key;
          return (
            <Pressable
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={item.key}
              onPress={() => {
                setReviewDraft(null);
                setDestination(item.key);
              }}
              style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
            >
              <Ionicons
                name={selected ? item.icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap : item.icon}
                size={20}
                color={selected ? theme.colors.accent : theme.colors.mutedForeground}
              />
              <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <AccountPanel
        onClose={() => setAccountPanelVisible(false)}
        onLock={onLock}
        visible={accountPanelVisible}
        wallet={wallet}
      />
      <NetworkSelector
        onClose={() => setNetworkSelectorVisible(false)}
        onSelect={onNetworkSelect}
        registry={networkRegistry}
        selectedNetwork={network}
        visible={networkSelectorVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.colors.background },
  shellContent: { flex: 1 },
  orbTop: { position: 'absolute', top: -150, right: -125, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(80, 217, 255, 0.07)' },
  orbBottom: { position: 'absolute', bottom: -170, left: -160, width: 380, height: 380, borderRadius: 190, backgroundColor: 'rgba(124, 140, 255, 0.07)' },
  homeHeader: { paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandMark: { width: 38, height: 38, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.55)' },
  brandIcon: { width: '100%', height: '100%' },
  brandName: { color: theme.colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 2 },
  brandProduct: { color: theme.colors.accent, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 2.8, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  receiveHeaderBack: { minHeight: 42, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  receiveHeaderBackText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  accountButton: { minHeight: 42, paddingHorizontal: 10, justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.88)', borderWidth: 1, borderColor: theme.colors.border },
  accountButtonLabel: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 11, textAlign: 'right' },
  accountButtonAddress: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, textAlign: 'right', marginTop: 2 },
  headerIconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 16, 0.72)' },
  accountSheet: { maxHeight: '88%', padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#0d152b', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  networkSheet: { maxHeight: '88%', padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#0d152b', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(126, 145, 191, 0.45)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25, lineHeight: 31, marginTop: 4 },
  sheetClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  sheetIntro: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 20 },
  accountStatusCard: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.22)' },
  accountStatusIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(80, 217, 255, 0.12)' },
  accountStatusCopy: { flex: 1, gap: 3 },
  accountStatusTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  accountStatusBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  fullAddressCard: { minHeight: 62, paddingHorizontal: theme.spacing.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.88)', borderWidth: 1, borderColor: theme.colors.border },
  fullAddressText: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  copyButton: { minHeight: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  copyButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  copyError: { color: theme.colors.destructive, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  accountDetailRow: { minHeight: 42, paddingHorizontal: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  accountDetailLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.9 },
  accountDetailValue: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  sheetLockButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.1)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.28)' },
  sheetLockText: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  selectionMessage: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.3)' },
  selectionMessageText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 17 },
  networkList: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  networkOption: { minHeight: 76, padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.72)', borderWidth: 1, borderColor: theme.colors.border },
  networkOptionSelected: { backgroundColor: 'rgba(80, 217, 255, 0.1)', borderColor: 'rgba(80, 217, 255, 0.55)' },
  networkOptionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(124, 140, 255, 0.16)', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.28)' },
  networkOptionIconSelected: { backgroundColor: 'rgba(80, 217, 255, 0.16)', borderColor: 'rgba(80, 217, 255, 0.46)' },
  networkOptionInitial: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 14 },
  networkOptionCopy: { flex: 1, minWidth: 0, gap: 3 },
  networkOptionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  networkOptionName: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  networkOptionMeta: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  networkOptionEnvironment: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.6 },
  previewBanner: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, padding: theme.spacing.md, flexDirection: 'row', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.35)' },
  previewBannerCopy: { flex: 1, gap: 3 },
  previewBannerTitle: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.1 },
  previewBannerBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 17 },
  homeScrollContent: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg },
  greeting: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing, lineHeight: theme.typography.eyebrow.lineHeight },
  heroTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  networkCard: { minHeight: 82, padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border },
  networkIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  networkCopy: { flex: 1, gap: 2 },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.25 },
  networkName: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  networkStatus: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  networkChevron: { width: 28, alignItems: 'center' },
  portfolioCard: { padding: theme.spacing.lg, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.9)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.24)', ...theme.shadows.panel },
  portfolioCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  portfolioTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 22, lineHeight: 28, marginTop: 4 },
  portfolioBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  refreshNotice: { color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  assetCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  assetCount: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 48, lineHeight: 54, letterSpacing: -1.5 },
  assetCountLabel: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  unavailableCard: { borderColor: 'rgba(244, 200, 107, 0.35)' },
  errorCard: { borderColor: 'rgba(255, 101, 132, 0.38)' },
  stateIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244, 200, 107, 0.1)' },
  refreshButton: { minHeight: 42, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  refreshButtonCompact: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  refreshText: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  actionsSection: { gap: theme.spacing.sm },
  actionsRow: { flexDirection: 'row', gap: theme.spacing.sm },
  actionButton: { flex: 1, minHeight: 88, paddingVertical: theme.spacing.sm, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.72)', borderWidth: 1, borderColor: theme.colors.border },
  actionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  actionLabel: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  assetSection: { gap: theme.spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 22, lineHeight: 28, marginTop: 4 },
  sectionCount: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  viewAllButton: { minHeight: 36, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewAllText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  assetList: { overflow: 'hidden', borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.78)', borderWidth: 1, borderColor: theme.colors.border },
  assetRow: { minHeight: 76, paddingHorizontal: theme.spacing.md, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  assetIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124, 140, 255, 0.16)', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.28)' },
  assetIconImage: { width: 25, height: 25, borderRadius: 8 },
  assetInitials: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  assetCopy: { flex: 1, minWidth: 0, gap: 2 },
  assetName: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  assetSymbol: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  assetBalance: { maxWidth: '42%', alignItems: 'flex-end', gap: 2 },
  assetAmount: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  assetStateRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  assetState: { fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.8 },
  assetMetadataState: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 8, letterSpacing: 0.5 },
  assetsScrollContent: { paddingHorizontal: theme.spacing.lg, paddingBottom: 112, gap: theme.spacing.md },
  assetsTopBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  assetsTopBarCopy: { flex: 1, gap: 2 },
  assetsTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 28, lineHeight: 34 },
  assetsIntro: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 20 },
  searchField: { minHeight: 48, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.82)', borderWidth: 1, borderColor: theme.colors.border },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 0, color: theme.colors.foreground, fontFamily: theme.typography.body.fontFamily, fontSize: 13 },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', gap: theme.spacing.sm },
  filterChip: { minHeight: 38, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: theme.radius.pill, backgroundColor: 'rgba(18, 29, 56, 0.72)', borderWidth: 1, borderColor: theme.colors.border },
  filterChipSelected: { backgroundColor: 'rgba(80, 217, 255, 0.16)', borderColor: 'rgba(80, 217, 255, 0.62)' },
  filterChipText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  filterChipTextSelected: { color: theme.colors.accent },
  filterChipCount: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  assetsLoadingCard: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border },
  assetsLoadingHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetsSkeletonRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(126, 145, 191, 0.14)' },
  skeletonCount: { width: 34, height: 10 },
  skeletonBalance: { width: 54, height: 11 },
  assetsStateCard: { padding: theme.spacing.lg, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.9)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.35)', ...theme.shadows.panel },
  errorStateIcon: { backgroundColor: 'rgba(255, 101, 132, 0.1)' },
  emptyCard: { padding: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.74)', borderWidth: 1, borderColor: theme.colors.border },
  emptyTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  emptyBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  skeletonLine: { borderRadius: theme.radius.pill, backgroundColor: 'rgba(126, 145, 191, 0.2)' },
  skeletonSmall: { width: 92, height: 10 },
  skeletonMedium: { width: 160, height: 12 },
  skeletonLarge: { width: 110, height: 42, marginVertical: 7 },
  skeletonAssetRow: { paddingTop: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  skeletonCircle: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(126, 145, 191, 0.2)' },
  skeletonAssetCopy: { flex: 1, gap: 8 },
  skeletonAssetTitle: { width: '45%', height: 11 },
  skeletonAssetSubtitle: { width: '26%', height: 9 },
  lockButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  lockButtonText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  placeholderScreen: { flex: 1, paddingHorizontal: theme.spacing.lg, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  placeholderIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.24)', ...theme.shadows.glow },
  placeholderTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25, lineHeight: 31, textAlign: 'center' },
  placeholderBody: { maxWidth: 320, color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  primaryButton: { minHeight: 52, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 9, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'rgba(7, 11, 25, 0.96)', borderTopWidth: 1, borderTopColor: 'rgba(126, 145, 191, 0.2)' },
  navItem: { minWidth: 58, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: theme.radius.sm },
  navLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 10 },
  navLabelSelected: { color: theme.colors.accent },
  pressed: { opacity: theme.states.pressedOpacity },
});