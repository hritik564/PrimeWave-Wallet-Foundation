import { WalletLogo } from '@/src/design-system/components/WalletLogo';
import { GlassLayer } from '@/src/design-system/components/GlassLayer';
import { glassSurface } from '@/src/design-system/tokens/wallet-home';
import { walletHomeColors as palette } from '@/src/design-system/tokens/wallet-home';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import {
  WaveXAssetRow,
  WaveXButton,
  WaveXBottomNavigation,
  WaveXBottomSheet,
  WaveXErrorState,
  WaveXEmptyState,
  WaveXLoadingState,
  WaveXNetworkBadge,
  WaveXSearchInput,
  WaveXSegmentedControl,
  WaveXSectionHeader,
  WaveXSkeleton,
  WaveXStatusIndicator,
} from '@/src/design-system';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import { secureLogger } from '@/src/core/security/logging';
import {
  type PortfolioAssetViewModel,
  type PortfolioReadModel,
  type PortfolioReadModelService,
} from '@/src/core/portfolio';
import type { ActivityReadModelService } from '@/src/core/activity';
import type { SwapQuote, SwapQuoteService } from '@/src/core/swaps';
import type { SwapReviewApproval, SwapReviewSnapshot } from '@/src/core/swaps';
import type { Wallet } from '@/src/core/wallet/models';
import type { DAppSession } from '@/src/core/dapp';
import type {
  AuthenticationSettings,
  BiometricAvailability,
} from '@/src/core/security';
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
import { WalletSwapScreen } from './WalletSwapScreen';
import { WalletSwapReviewScreen } from './WalletSwapReviewScreen';
import { WalletSwapExecutionScreen } from './WalletSwapExecutionScreen';
import { assetIdentityKey, type PublicSendDraft } from './WalletSendScreen.logic';
import { copyPublicAddress } from './public-address-actions';
import { DAppSessionsScreen } from './dapp/DAppSessionsScreen';
import { WalletSettingsScreen } from './WalletSettingsScreen';
import {
  assetDisplayName,
  assetDisplaySubtitle,
  assetStateLabel,
  filterPortfolioAssets,
  filterRegisteredNetworks,
  type AssetFilter,
  getHomeBalancePresentation,
  getPortfolioState,
  portfolioForSelection,
  homeNavigationLabels,
  safePortfolioDiagnostic,
  safePortfolioMessage,
  shortPublicAddress,
} from './WalletHomeShell.logic';

const iconSource = require('../../assets/images/mark.png');

type Destination =
  | 'home'
  | 'assets'
  | 'asset-details'
  | 'receive'
  | 'send'
  | 'swap'
  | 'activity'
  | 'settings'
  | 'dapps';
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
  if (asset.availabilityState === 'available') return palette.cyan;
  if (asset.availabilityState === 'stale') return theme.states.warning;
  return palette.secondaryText;
}

function Header({
  wallet,
  detailMode,
  onBack,
  onAccountPress,
  onSettingsPress,
}: {
  wallet: Wallet;
  detailMode: 'receive' | 'send' | 'swap' | 'activity' | 'dapps' | 'asset-details' | null;
  onBack: () => void;
  onAccountPress: () => void;
  onSettingsPress: () => void;
}) {
  const account = wallet.accounts[0];
  const accountLabel = account ? `Account ${account.index + 1}` : 'Account';
  return (
    <View style={styles.homeHeader}>
      {detailMode && <View style={styles.brandLockup}>
        <View style={styles.brandMark}>
          <Image contentFit="contain" source={iconSource} style={styles.brandIcon} />
        </View>
        <View>
          <Text style={styles.brandName}>WAVEX</Text>
          <Text style={styles.brandProduct}>{detailMode ? detailMode.toUpperCase() : 'WALLET'}</Text>
        </View>
      </View>}
      {detailMode ? (
        <Pressable
          accessibilityLabel="Back to Home"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.receiveHeaderBack, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back-outline" size={18} color={palette.cyan} />
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
            <Image contentFit="contain" accessibilityLabel="WaveX" source={iconSource} style={styles.headerLogo} />
            <View>
            <Text style={styles.accountButtonLabel}>{accountLabel}</Text>
            <Text style={styles.accountButtonAddress}>
              {account ? shortPublicAddress(account.address) : 'Unavailable'}
            </Text>
            </View>
            <Ionicons name="chevron-down" size={14} color={palette.secondaryText} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            onPress={onSettingsPress}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
          >
            <Ionicons name="settings-outline" size={19} color={palette.text} />
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
  onSelect,
}: {
  visible: boolean;
  wallet: Wallet;
  onClose: () => void;
  onLock: () => void;
  onSelect: (accountId: string) => void;
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
    <WaveXBottomSheet onClose={onClose} title="Accounts" visible={visible}>
      <View style={styles.accountList}>
        {wallet.accounts.map((candidate) => {
          const selected = candidate.accountId === account?.accountId;
          return (
            <Pressable
              accessibilityLabel={`${candidate.index === 0 ? 'Account 1' : `Account ${candidate.index + 1}`}, ${shortPublicAddress(candidate.address)}${selected ? ', selected' : ''}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={candidate.accountId}
              onPress={() => { onSelect(candidate.accountId); onClose(); }}
              style={({ pressed }) => [
                styles.accountOption,

                pressed && styles.pressed,
              ]}
            >
              <View style={styles.accountOptionIcon}>
                <Ionicons name="person-outline" size={17} color={palette.cyan} />
              </View>
              <View style={styles.accountOptionCopy}>
                <Text style={styles.accountOptionTitle}>
                  Account {candidate.index + 1}
                </Text>
                <Text style={styles.accountOptionAddress}>
                  {shortPublicAddress(candidate.address)}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={18} color={palette.cyan} />
              ) : (
                <Ionicons name="chevron-forward" size={17} color={palette.secondaryText} />
              )}
            </Pressable>
          );
        })}
      </View>
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
          color={copyState === 'copied' ? theme.states.success : palette.cyan}
        />
        <Text style={styles.copyButtonText}>
          {copyState === 'copied' ? 'Copied public address' : 'Copy public address'}
        </Text>
      </Pressable>
      {copyState === 'error' ? (
        <Text style={styles.copyError}>Could not copy the public address. Try again.</Text>
      ) : null}
      <Pressable
        accessibilityLabel="Lock wallet"
        accessibilityRole="button"
        onPress={onLock}
        style={({ pressed }) => [styles.sheetLockButton, pressed && styles.pressed]}
      >
        <Ionicons name="lock-closed-outline" size={18} color={theme.states.warning} />
        <Text style={styles.sheetLockText}>Lock wallet</Text>
      </Pressable>
    </WaveXBottomSheet>
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
  const [search, setSearch] = useState('');
  const networks = filterRegisteredNetworks(registry.listNetworks(), search);

  useEffect(() => {
    if (visible) {
      setSelectionMessage(null);
      setSearch('');
    }
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
    <WaveXBottomSheet onClose={onClose} title="Select network" visible={visible}>
      <WaveXSearchInput placeholder="Search networks" value={search} onChangeText={setSearch} />
      {networks.length === 0 && <Text style={styles.sheetIntro}>No matching networks</Text>}
      {selectionMessage ? (
        <View accessibilityRole="alert" style={styles.selectionMessage}>
          <Ionicons name="information-circle-outline" size={18} color={theme.states.warning} />
          <Text style={styles.selectionMessageText}>{selectionMessage}</Text>
        </View>
      ) : null}
      <View style={styles.networkList}>
        {networks.map((candidate) => {
          const selected = selectedNetwork.id === candidate.id;
          const configured = candidate.configurationStatus === 'configured';
          const available = candidate.enabled && configured && candidate.chainId !== null;
          const status = available ? (selected ? 'Selected' : 'Available')
            : candidate.isPrimary ? 'Planned · Unavailable' : 'Unavailable';
          return (
            <Pressable
              accessibilityLabel={`${candidate.displayName}, ${status}${selected ? ', selected' : ''}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected && available, disabled: !available }}
              disabled={!available}
              key={candidate.id}
              onPress={() => selectNetwork(candidate)}
              style={({ pressed }) => [
                styles.networkOption,


                pressed && styles.pressed,
              ]}
            >
              <WalletLogo networkId={candidate.id} />
              <View style={styles.networkOptionCopy}>
                <View style={styles.networkOptionTitleRow}>
                  <Text numberOfLines={1} style={styles.networkOptionName}>
                    {candidate.displayName}
                  </Text>
                  {selected && available ? (
                    <Ionicons name="checkmark-circle" size={16} color={palette.cyan} />
                  ) : null}
                </View>
                <Text style={styles.networkOptionMeta}>{candidate.environment === 'testnet' ? `Testnet · ${status}` : status}</Text>
              </View>
              {!available ? (
                <Ionicons name="lock-closed-outline" size={16} color={theme.states.warning} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </WaveXBottomSheet>
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
        <WalletLogo networkId={network.id} size={24} />
      </View>
      <View style={styles.networkCopy}>
        <Text style={styles.networkName}>{network.displayName}</Text>
        {!configured && <Text style={styles.networkStatus}>
          Planned · Unavailable
        </Text>}
      </View>
      <View style={styles.networkChevron}>
        <Ionicons name="chevron-down" size={17} color={palette.secondaryText} />
      </View>
    </Pressable>
  );
}

function ActionButton({
  label,
  icon,
  comingSoon = false,
  available = true,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  comingSoon?: boolean;
  available?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={
        !available
          ? `${label}. Unavailable`
          : comingSoon
            ? `${label}. Coming soon`
            : label
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        !available && styles.actionButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.actionIcon]}>
        <Ionicons
          name={icon}
          size={20}
          color={available ? (label === 'Send' ? palette.cyan : palette.text) : palette.secondaryText}
        />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      {!available ? <Text style={styles.actionUnavailable}>Unavailable</Text> : null}
    </Pressable>
  );
}

function PortfolioSkeleton() {
  return (
    <View accessibilityLabel="Loading portfolio" style={styles.portfolioCard}>
      <WaveXSkeleton width={112} height={10} />
      <WaveXSkeleton width={176} height={42} />
      <WaveXSkeleton width={142} height={12} />
      <View style={styles.skeletonAssetRow}>
        <WaveXSkeleton width={42} height={42} />
        <View style={styles.skeletonAssetCopy}>
          <WaveXSkeleton width={96} height={12} />
          <WaveXSkeleton width={132} height={10} />
        </View>
      </View>
    </View>
  );
}

function PortfolioSummary({
  state,
  model,
  errorMessage,
  diagnosticEnabled,
  onRefresh,
  refreshing,
  networkConfigured,
  onChooseNetwork,
}: {
  state: PortfolioState;
  model: PortfolioReadModel | null;
  errorMessage: string | null;
  diagnosticEnabled: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  networkConfigured: boolean;
  onChooseNetwork: () => void;
}) {
  if (state === 'loading') return <PortfolioSkeleton />;

  if (state === 'unavailable') {
    return (
      <View style={[styles.portfolioCard, styles.unavailableCard]}>
        <WaveXErrorState
          body={
            networkConfigured
              ? 'Check your connection and try again.'
              : 'Mainnet configuration is pending. Choose a configured network to view balances.'
          }
          onAction={networkConfigured ? onRefresh : onChooseNetwork}
          actionLabel={networkConfigured ? "Retry" : "Choose network"}
          title="Balance unavailable"
        />
        {diagnosticEnabled && errorMessage ? (
          <Text style={styles.refreshNotice}>Preview diagnostic: {errorMessage}</Text>
        ) : null}
        {refreshing ? <WaveXLoadingState label="Refreshing portfolio" /> : null}
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[styles.portfolioCard, styles.errorCard]}>
        <WaveXErrorState
          body="Check your connection and try again."
          onAction={onRefresh}
          actionLabel="Retry"
          title="Couldn't load your balance."
        />
        {diagnosticEnabled && errorMessage ? (
          <Text style={styles.refreshNotice}>Preview diagnostic: {errorMessage}</Text>
        ) : null}
        {refreshing ? <WaveXLoadingState label="Refreshing portfolio" /> : null}
      </View>
    );
  }

  const balance = getHomeBalancePresentation(state, model);
  return (
    <View style={styles.portfolioCard}>
      <GlassLayer />
      <View style={styles.portfolioCardHeader}>
        <View>
          <Text style={styles.cardEyebrow}>NATIVE BALANCE</Text>
        </View>
        <RefreshButton onPress={onRefresh} refreshing={refreshing} compact />
      </View>
      <Text accessibilityLabel={`Portfolio balance ${balance.value} ${balance.detail}`} style={styles.balanceValue}>
        {balance.value} <Text style={styles.balanceUnit}>{balance.detail}</Text>
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
        <ActivityIndicator color={palette.cyan} size="small" />
      ) : (
        <>
          <Ionicons name="refresh-outline" size={16} color={palette.cyan} />
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
  const subtitle = [
    assetDisplaySubtitle(asset),
    asset.networkId,
    asset.verificationStatus === 'verified' ? 'Verified' : null,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <WaveXAssetRow
      amount={amount}
      logo={<WalletLogo asset={asset.identity} size={36} />}
      onPress={onPress}
      status={asset.balanceState === 'positive' && asset.availabilityState === 'available' ? undefined : assetStateLabel(asset)}
      subtitle={subtitle}
      title={assetDisplayName(asset)}
    />
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
          <Text style={styles.sectionTitle}>Your assets</Text>
        </View>
        <Pressable
          accessibilityLabel="View all assets"
          accessibilityRole="button"
          onPress={onViewAll}
          style={({ pressed }) => [styles.viewAllButton, pressed && styles.pressed]}
        >
          <Text style={styles.viewAllText}>View all</Text>
          <Ionicons name="chevron-forward" size={14} color={palette.cyan} />
        </Pressable>
      </View>
      {assets.length === 0 ? (
        <View style={styles.emptyCard}>
          <WaveXEmptyState
            body="Assets will appear here when a configured network returns public balance data."
            title="No assets yet"
          />
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

function AssetDetailsScreen({
  asset,
  network,
  onBack,
  onReceive,
  onSend,
  onSwap,
}: {
  asset: PortfolioAssetViewModel | null;
  network: EvmNetwork;
  onBack: () => void;
  onReceive: () => void;
  onSend: () => void;
  onSwap: () => void;
}) {
  if (!asset) {
    return (
      <View style={styles.assetDetailsMissing}>
        <WaveXErrorState
          body="The selected asset is no longer available in this portfolio snapshot."
          title="Couldn't open asset details."
        />
        <WaveXButton label="Back to Assets" onPress={onBack} variant="outline" />
      </View>
    );
  }

  const explorerUrl =
    asset.assetType === 'fungible_token' &&
    asset.contractAddress &&
    network.explorer.addressUrlTemplate
      ? network.explorer.addressUrlTemplate.replace('{address}', asset.contractAddress)
      : null;
  const amount = asset.formattedBalance ?? 'Unavailable';
  const statusTone =
    asset.availabilityState === 'available'
      ? asset.balanceState === 'zero'
        ? 'neutral'
        : 'success'
      : 'warning';

  return (
    <ScrollView
      accessibilityLabel="Asset details screen"
      contentContainerStyle={styles.assetDetailsContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.assetDetailsTopBar}>
        <Pressable
          accessibilityLabel="Back to assets"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <View style={styles.assetDetailsTopBarCopy}>
          <Text style={styles.cardEyebrow}>ASSET DETAILS</Text>
          <Text numberOfLines={1} style={styles.assetDetailsTopBarTitle}>
            {assetDisplayName(asset)}
          </Text>
        </View>
        <WaveXNetworkBadge name={network.displayName} symbol={network.nativeCurrency.symbol} />
      </View>

      <View style={[styles.assetDetailsHero, glassSurface]}>
          <GlassLayer />
        <WalletLogo asset={asset.identity} size={52} />
        <Text style={styles.assetDetailsName}>{assetDisplayName(asset)}</Text>
        <Text style={styles.assetDetailsSymbol}>{assetDisplaySubtitle(asset)}</Text>
        <WaveXStatusIndicator
          label={assetStateLabel(asset)}
          tone={statusTone}
        />
        <Text accessibilityLabel={`Asset balance ${amount}`} style={styles.assetDetailsBalance}>
          {amount}
        </Text>
        <Text style={styles.assetDetailsFiat}>Fiat value unavailable</Text>
      </View>

      <View style={styles.assetDetailsActions}>
        <WaveXButton icon="arrow-up-outline" label="Send" onPress={onSend} />
        <WaveXButton icon="arrow-down-outline" label="Receive" onPress={onReceive} variant="secondary" />
        <WaveXButton icon="swap-horizontal-outline" label="Swap" onPress={onSwap} variant="outline" />
      </View>

      <View style={styles.assetDetailsCard}>
        <WaveXSectionHeader eyebrow="ASSET INFORMATION" title="Details" />
        <View style={styles.assetDetailRow}>
          <Text style={styles.assetDetailLabel}>Network</Text>
          <Text style={styles.assetDetailValue}>{asset.networkId}</Text>
        </View>
        <View style={styles.assetDetailRow}>
          <Text style={styles.assetDetailLabel}>Contract</Text>
          <Text selectable style={styles.assetDetailValue}>
            {asset.assetType === 'native' ? 'Native Asset' : asset.contractAddress ?? 'Unavailable'}
          </Text>
        </View>
        <View style={styles.assetDetailRow}>
          <Text style={styles.assetDetailLabel}>Metadata</Text>
          <Text style={styles.assetDetailValue}>{asset.metadataStatus}</Text>
        </View>
        <View style={styles.assetDetailRow}>
          <Text style={styles.assetDetailLabel}>Verification</Text>
          <Text style={styles.assetDetailValue}>{asset.verificationStatus}</Text>
        </View>
      </View>

      {explorerUrl ? (
        <WaveXButton
          icon="open-outline"
          label={`View on ${network.explorer.name ?? 'Explorer'}`}
          onPress={() => void Linking.openURL(explorerUrl)}
          variant="outline"
        />
      ) : null}
    </ScrollView>
  );
}

function AssetStatusPanel({
  state,
  errorMessage,
  diagnosticEnabled,
  networkConfigured,
  onRefresh,
  refreshing,
}: {
  state: PortfolioState;
  errorMessage: string | null;
  diagnosticEnabled: boolean;
  networkConfigured: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (state === 'loading') {
    return (
      <View accessibilityLabel="Loading assets" style={styles.assetsLoadingCard}>
        <WaveXSkeleton width={112} height={11} />
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.assetsSkeletonRow}>
            <WaveXSkeleton width={40} height={40} />
            <View style={styles.skeletonAssetCopy}>
              <WaveXSkeleton width={100} height={12} />
              <WaveXSkeleton width={140} height={10} />
            </View>
            <WaveXSkeleton width={56} height={12} />
          </View>
        ))}
      </View>
    );
  }

  if (state === 'unavailable' || state === 'error') {
    const isError = state === 'error';
    return (
      <View style={[styles.assetsStateCard, isError && styles.errorCard]}>
        <WaveXErrorState
          body={
            networkConfigured
              ? 'Check your connection and try again.'
              : 'This network is not configured yet. Choose another network or try again.'
          }
          onAction={onRefresh}
          actionLabel="Retry"
          title="Couldn't load your assets."
        />
        {diagnosticEnabled && errorMessage ? (
          <Text style={styles.refreshNotice}>Preview diagnostic: {errorMessage}</Text>
        ) : null}
        {refreshing ? <WaveXLoadingState label="Refreshing assets" /> : null}
      </View>
    );
  }

  return null;
}

function AssetsBalanceSummary({
  model,
  state,
}: {
  model: PortfolioReadModel | null;
  state: PortfolioState;
}) {
  const balance = getHomeBalancePresentation(state, model);
  return (
    <View style={[styles.assetsBalanceCard, glassSurface]}>
          <GlassLayer />
      <Text style={styles.cardEyebrow}>NATIVE BALANCE</Text>
      <Text accessibilityLabel={`Portfolio value ${balance.value}`} style={styles.assetsBalanceValue}>
        {balance.value}
      </Text>
      <WaveXStatusIndicator
        label={balance.detail}
        tone={balance.zero ? 'neutral' : balance.available ? 'info' : 'warning'}
      />
      <Text style={styles.assetsBalanceBody}>{balance.supporting}</Text>
    </View>
  );
}

function AssetsScreen({
  previewMode,
  state,
  model,
  errorMessage,
  network,
  onBack,
  onRefresh,
  onAssetPress,
  refreshing,
}: {
  previewMode: boolean;
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
      <AssetsBalanceSummary model={model} state={state} />
      <View style={styles.assetsSearchRow}>
        <View style={styles.assetsSearchInputWrap}>
          <WaveXSearchInput
            onChangeText={setSearchQuery}
            placeholder="Search assets..."
            value={searchQuery}
          />
        </View>
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel="Clear asset search"
            accessibilityRole="button"
            onPress={() => setSearchQuery('')}
            style={({ pressed }) => [styles.searchClear, pressed && styles.pressed]}
          >
            <Ionicons name="close-circle" size={17} color={theme.colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <WaveXSegmentedControl
        options={[
          { value: 'all', label: `All ${counts.all}` },
          { value: 'visible', label: `Visible ${counts.visible}` },
          { value: 'hidden', label: `Hidden ${counts.hidden}` },
        ]}
        onChange={(value) => setFilter(value as AssetFilter)}
        value={filter}
      />
      <AssetStatusPanel
        diagnosticEnabled={previewMode}
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
            <WaveXEmptyState
              body={
                assets.length === 0
                  ? 'Assets will appear here when a configured network returns public balance data.'
                  : 'Try another search or visibility filter.'
              }
              title={
                assets.length === 0
                  ? 'No assets yet'
                  : searchQuery.length > 0
                    ? 'No matching assets'
                    : filter === 'hidden'
                      ? 'No hidden assets'
                      : 'No visible assets'
              }
            />
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
  destination: Exclude<Destination, 'home' | 'assets' | 'asset-details' | 'receive' | 'send' | 'dapps'>;
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

type ShellProps = {
  wallet: Wallet;
  previewMode: boolean;
  network: EvmNetwork;
  networkRegistry: NetworkRegistry;
  readModelService: Pick<PortfolioReadModelService, 'getPortfolio'>;
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
  authenticationSettings: AuthenticationSettings;
  biometricAvailability: BiometricAvailability;
  swapQuoteService?: SwapQuoteService | null;
  dappSessions?: readonly DAppSession[];
  dappAvailable?: boolean;
  onDAppDisconnect?: (sessionId: string) => Promise<void>;
  onNetworkSelect: (networkId: string) => NetworkSelectionResult;
  onSecurity?: () => void;
  onLock: () => void;
  onComingSoon: (label: string) => void;
};

export function WalletHomeShell(props: ShellProps) {
  const [selection, setSelection] = useState<string | null>(null);
  const account = props.wallet.accounts.find(item => item.accountId === selection) ?? props.wallet.accounts[0];
  const wallet = useMemo(() => {
    if (!account || account === props.wallet.accounts[0]) return props.wallet;
    return { ...props.wallet, accounts: [account, ...props.wallet.accounts.filter(item => item !== account)] };
  }, [props.wallet, account]);

  return <AccountHome key={JSON.stringify([wallet.walletId, account?.accountId])}
    {...props} wallet={wallet} onSelectAccount={setSelection} />;
}

function AccountHome({
  onSelectAccount,
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
  authenticationSettings,
  biometricAvailability,
  swapQuoteService,
  dappSessions = [],
  dappAvailable = false,
  onDAppDisconnect = async () => undefined,
  onNetworkSelect,
  onSecurity,
  onLock,
  onComingSoon,
}: ShellProps & { onSelectAccount: (accountId: string) => void }) {
  const insets = useSafeAreaInsets();
  const [destination, setDestination] = useState<Destination>('home');
  const [accountPanelVisible, setAccountPanelVisible] = useState(false);
  const [networkSelectorVisible, setNetworkSelectorVisible] = useState(false);
  const [loadedState, setPortfolioState] = useState<PortfolioState>('loading');
  const [loadedPortfolio, setPortfolio] = useState<PortfolioReadModel | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<PublicSendDraft | null>(null);
  const [swapReviewQuote, setSwapReviewQuote] = useState<SwapQuote | null>(null);
  const [swapReview, setSwapReview] = useState<SwapReviewSnapshot | null>(null);
  const [swapApproval, setSwapApproval] = useState<SwapReviewApproval | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sendAssetKey, setSendAssetKey] = useState<string | null>(null);
  const [assetDetailsOrigin, setAssetDetailsOrigin] = useState<'home' | 'assets'>('assets');
  const portfolioRequestRef = useRef(0);
  const account = wallet.accounts[0];
  const previewDiagnosticsEnabled =
    previewMode && typeof __DEV__ !== 'undefined' && __DEV__;

  const accountQuery = useMemo(
    () => ({
      accountId: account?.accountId ?? '',
      accountAddress: account?.address ?? '',
      networkId: network.id,
      includeHidden: true,
    }),
    [account?.accountId, account?.address, network.id],
  );

  // A selection can change during render, before the request effect invalidates old reads.
  const portfolio = portfolioForSelection(loadedPortfolio, accountQuery);
  const portfolioState = loadedPortfolio && !portfolio ? 'loading' : loadedState;

  const loadPortfolio = useCallback(
    async (isRefresh = false) => {
      const requestId = ++portfolioRequestRef.current;
      if (previewDiagnosticsEnabled) {
        secureLogger.debug('Preview portfolio request started in Home shell', {
          requestId,
          isRefresh,
          accountId: accountQuery.accountId,
          address: accountQuery.accountAddress,
          networkId: accountQuery.networkId,
        });
      }
      if (!account) {
        if (previewDiagnosticsEnabled) {
          secureLogger.warning('Preview portfolio request skipped without account', {
            requestId,
            isRefresh,
            networkId: accountQuery.networkId,
          });
        }
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
        if (requestId !== portfolioRequestRef.current) {
          if (previewDiagnosticsEnabled) {
            secureLogger.debug('Preview portfolio result ignored as stale', {
              requestId,
              currentRequestId: portfolioRequestRef.current,
              networkId: accountQuery.networkId,
            });
          }
          return;
        }
        const nextState = getPortfolioState(next.assets.length);
        if (previewDiagnosticsEnabled) {
          secureLogger.debug('Preview portfolio result accepted in Home shell', {
            requestId,
            networkId: next.networkId,
            chainId: next.chainId,
            assetCount: next.assets.length,
            state: nextState,
          });
        }
        setPortfolio(next);
        setPortfolioState(next.state === 'unavailable' ? 'unavailable' : nextState);
      } catch (error) {
        if (requestId !== portfolioRequestRef.current) {
          if (previewDiagnosticsEnabled) {
            secureLogger.debug('Preview portfolio error ignored as stale', {
              requestId,
              currentRequestId: portfolioRequestRef.current,
              networkId: accountQuery.networkId,
              errorCode: safePortfolioDiagnostic(error),
            });
          }
          return;
        }
        const message =
          previewDiagnosticsEnabled
            ? safePortfolioDiagnostic(error) ?? safePortfolioMessage(error)
            : safePortfolioMessage(error);
        if (previewDiagnosticsEnabled) {
          secureLogger.warning('Preview portfolio request failed in Home shell', {
            requestId,
            networkId: accountQuery.networkId,
            address: accountQuery.accountAddress,
            errorCode: safePortfolioDiagnostic(error),
            isRefresh,
          });
        }
        setPortfolioError(message);
        setPortfolio(null);
        setPortfolioState(network.configurationStatus === 'configured' ? 'error' : 'unavailable');
      } finally {
        if (requestId === portfolioRequestRef.current) {
          if (previewDiagnosticsEnabled) {
            secureLogger.debug('Preview portfolio request finished in Home shell', {
              requestId,
              networkId: accountQuery.networkId,
              refreshing: false,
            });
          }
          setRefreshing(false);
        } else if (previewDiagnosticsEnabled) {
          secureLogger.debug('Preview portfolio finalization ignored as stale', {
            requestId,
            currentRequestId: portfolioRequestRef.current,
            networkId: accountQuery.networkId,
          });
        }
      }
    },
    [account, accountQuery, network.configurationStatus, previewDiagnosticsEnabled, readModelService],
  );

  const refreshPortfolio = useCallback(() => {
    if (previewDiagnosticsEnabled) {
      secureLogger.debug('Preview portfolio refresh press received', {
        requestId: portfolioRequestRef.current,
        accountId: accountQuery.accountId,
        address: accountQuery.accountAddress,
        networkId: accountQuery.networkId,
        refreshing,
      });
    }
    void loadPortfolio(true);
  }, [
    accountQuery,
    loadPortfolio,
    previewDiagnosticsEnabled,
    refreshing,
  ]);

  useEffect(() => {
    const invalidatedRequestId = ++portfolioRequestRef.current;
    if (previewDiagnosticsEnabled) {
      secureLogger.debug('Preview portfolio effect starting initial read', {
        requestId: invalidatedRequestId,
        networkId: accountQuery.networkId,
        accountId: accountQuery.accountId,
        address: accountQuery.accountAddress,
      });
    }
    void loadPortfolio();
    return () => {
      portfolioRequestRef.current += 1;
      if (previewDiagnosticsEnabled) {
        secureLogger.debug('Preview portfolio effect invalidated', {
          requestId: portfolioRequestRef.current,
          networkId: accountQuery.networkId,
        });
      }
    };
  }, [
    accountQuery,
    loadPortfolio,
    previewDiagnosticsEnabled,
  ]);

  useEffect(() => {
    if (!previewDiagnosticsEnabled) return;
    secureLogger.debug('Preview portfolio UI state rendered', {
      requestId: portfolioRequestRef.current,
      networkId: network.id,
      state: portfolioState,
      refreshing,
      hasPortfolio: portfolio !== null,
      hasError: portfolioError !== null,
    });
  }, [
    network.id,
    portfolio,
    portfolioError,
    portfolioState,
    previewDiagnosticsEnabled,
    refreshing,
  ]);

  useEffect(() => {
    if (reviewDraft && reviewDraft.networkId !== network.id) {
      setReviewDraft(null);
      setDestination('send');
    }
  }, [network.id, reviewDraft]);

  useEffect(() => {
    setSwapReviewQuote(null);
    setSwapReview(null);
    setSwapApproval(null);
  }, [network.id]);

  const focused = destination === 'send' || destination === 'receive';
  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (reviewDraft) setReviewDraft(null);
      else setDestination('home');
      return true;
    });
    return () => subscription.remove();
  }, [focused, reviewDraft]);

  return (
    <View style={styles.shell}>
      <View style={[styles.shellContent, { paddingTop: insets.top + 8, paddingBottom: focused ? insets.bottom : 0 }]}>
        {!(destination === 'send' && reviewDraft) && <Header
          onBack={() => setDestination('home')}
          wallet={wallet}
          detailMode={
            destination === 'receive'
              ? 'receive'
              : destination === 'send'
                ? 'send'
                : destination === 'swap'
                  ? 'swap'
                : destination === 'activity'
                  ? 'activity'
                  : destination === 'dapps'
                    ? 'dapps'
                  : destination === 'asset-details'
                    ? 'asset-details'
                  : null
          }
          onAccountPress={() => setAccountPanelVisible(true)}
          onSettingsPress={() => setDestination('settings')}
        />}
        <PreviewBanner previewMode={previewMode} />
        {destination === 'home' ? (
          <ScrollView
            contentContainerStyle={[
              styles.homeScrollContent,
              { paddingBottom: theme.spacing.lg },
            ]}
            refreshControl={
              <RefreshControl
                colors={[palette.cyan]}
                onRefresh={refreshPortfolio}
                refreshing={refreshing}
                tintColor={palette.cyan}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            <NetworkCard
              network={network}
              onPress={() => setNetworkSelectorVisible(true)}
            />
            <PortfolioSummary
              onChooseNetwork={() => setNetworkSelectorVisible(true)}
              diagnosticEnabled={previewMode}
              errorMessage={portfolioError}
              model={portfolio}
              networkConfigured={
                network.configurationStatus === 'configured' &&
                network.chainId !== null
              }
              onRefresh={refreshPortfolio}
              refreshing={refreshing}
              state={portfolioState}
            />
            <View style={styles.actionsSection}>
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
                <ActionButton
                  comingSoon={false}
                  icon="swap-horizontal-outline"
                  label="Swap"
                  onPress={() => setDestination('swap')}
                />

              </View>
            </View>
            <AssetPreview
              model={portfolio}
              onAssetPress={(asset) => {
                setSendAssetKey(assetIdentityKey(asset.identity));
                setAssetDetailsOrigin('home');
                setReviewDraft(null);
                setDestination('asset-details');
              }}
              onViewAll={() => setDestination('assets')}
              state={portfolioState}
            />
          </ScrollView>
        ) : destination === 'asset-details' ? (
          <AssetDetailsScreen
            asset={
              portfolio?.assets.find(
                (asset) => assetIdentityKey(asset.identity) === sendAssetKey,
              ) ?? null
            }
            network={network}
            onBack={() => setDestination(assetDetailsOrigin)}
            onReceive={() => setDestination('receive')}
            onSend={() => setDestination('send')}
            onSwap={() => setDestination('swap')}
          />
        ) : destination === 'receive' ? (
          <ReceiveScreen registry={networkRegistry} wallet={wallet} />
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
              setAssetDetailsOrigin('assets');
              setDestination('asset-details');
            }}
            onBack={() => setDestination('home')}
            onRefresh={refreshPortfolio}
            previewMode={previewMode}
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
        ) : destination === 'swap' ? (
          swapReviewQuote && swapReview && swapApproval ? (
            <WalletSwapExecutionScreen
              approval={swapApproval}
              createBroadcastDependency={createBroadcastDependency}
              createConstructionEngine={createConstructionEngine}
              createSigningDependency={createSigningDependency}
              network={network}
              networkRegistry={networkRegistry}
              onBack={() => {
                setSwapReview(null);
                setSwapApproval(null);
              }}
              portfolio={portfolio}
              previewMode={previewMode}
              quote={swapReviewQuote}
              quoteService={swapQuoteService ?? null}
              review={swapReview}
              wallet={wallet}
            />
          ) : swapReviewQuote ? (
            <WalletSwapReviewScreen
              network={network}
              networkRegistry={networkRegistry}
              onApproved={(nextApproval, nextReview) => {
                setSwapApproval(nextApproval);
                setSwapReview(nextReview);
              }}
              onBack={() => {
                setSwapReviewQuote(null);
                setSwapReview(null);
                setSwapApproval(null);
              }}
              portfolio={portfolio}
              previewMode={previewMode}
              quote={swapReviewQuote}
              quoteService={swapQuoteService ?? null}
              wallet={wallet}
            />
          ) : (
            <WalletSwapScreen
              network={network}
              onBack={() => setDestination('home')}
              onNetworkPress={() => setNetworkSelectorVisible(true)}
              onReview={(quote) => setSwapReviewQuote(quote)}
              portfolio={portfolio}
              portfolioState={portfolioState}
              quoteService={swapQuoteService ?? null}
              wallet={wallet}
            />
          )
        ) : destination === 'dapps' ? (
          <DAppSessionsScreen
            available={dappAvailable}
            networkRegistry={networkRegistry}
            onBack={() => setDestination('home')}
            onDisconnect={onDAppDisconnect}
            sessions={dappSessions}
            wallet={wallet}
          />
        ) : destination === 'settings' ? (
          <WalletSettingsScreen
            authenticationSettings={authenticationSettings}
            biometricAvailability={biometricAvailability}
            network={network}
            onAccountPress={() => setAccountPanelVisible(true)}
            onComingSoon={onComingSoon}
            onLock={onLock}
            onNetworkPress={() => setNetworkSelectorVisible(true)}
            onSecurityPress={onSecurity}
            previewMode={previewMode}
            wallet={wallet}
          />
        ) : (
          <PlaceholderDestination destination={destination} onBack={() => setDestination('home')} />
        )}
      </View>
      {!focused && <View style={{ paddingBottom: insets.bottom }}>
      <WaveXBottomNavigation
        items={navigationItems}
        selectedKey={destination === 'asset-details' ? assetDetailsOrigin : ['receive', 'send'].includes(destination) ? 'home' : destination === 'dapps' ? 'settings' : destination}
        onSelect={(key) => {
          setReviewDraft(null);
          setSwapReviewQuote(null);
          setDestination(key as Destination);
        }}
      />
      </View>}
      <AccountPanel
        onClose={() => setAccountPanelVisible(false)}
        onLock={onLock}
        onSelect={onSelectAccount}
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
  shell: { flex: 1, backgroundColor: palette.background },
  headerLogo: { width: 32, height: 32, borderRadius: 9 },
  balanceUnit: { fontSize: 19, color: palette.secondaryText },
  shellContent: { flex: 1 },
  orbTop: { position: 'absolute', top: -150, right: -125, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(80, 217, 255, 0.07)' },
  orbBottom: { position: 'absolute', bottom: -170, left: -160, width: 380, height: 380, borderRadius: 190, backgroundColor: 'rgba(124, 140, 255, 0.07)' },
  homeHeader: { paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandMark: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.55)' },
  brandIcon: { width: '100%', height: '100%' },
  brandName: { color: palette.text, fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 2 },
  brandProduct: { color: palette.cyan, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 2.8, marginTop: 2 },
  headerActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receiveHeaderBack: { minHeight: 42, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  receiveHeaderBackText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  accountButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountButtonLabel: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 17 },
  accountButtonAddress: { color: palette.secondaryText, fontSize: 12 },
  headerIconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  accountList: { gap: 0 },
  accountOption: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider },
  accountOptionSelected: { backgroundColor: 'rgba(80, 217, 255, 0.1)', borderColor: theme.colors.borderActive },
  accountOptionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
  accountOptionCopy: { flex: 1, gap: 2 },
  accountOptionTitle: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  accountOptionAddress: { color: palette.secondaryText, fontFamily: theme.typography.caption.fontFamily, fontSize: 11 },
  accountActions: { gap: theme.spacing.xs },
  accountAction: { minHeight: 48, paddingHorizontal: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.muted },
  accountActionText: { flex: 1, color: theme.colors.textSecondary, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 16, 0.72)' },
  accountSheet: { maxHeight: '88%', padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#0d152b', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  networkSheet: { maxHeight: '88%', padding: theme.spacing.lg, gap: theme.spacing.md, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#0d152b', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)', ...theme.shadows.panel },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(126, 145, 191, 0.45)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 25, lineHeight: 31, marginTop: 4 },
  sheetClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  sheetIntro: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 20 },
  accountStatusCard: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.22)' },
  accountStatusIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(80, 217, 255, 0.12)' },
  accountStatusCopy: { flex: 1, gap: 3 },
  accountStatusTitle: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  accountStatusBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  fullAddressCard: { minHeight: 62, paddingHorizontal: theme.spacing.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.88)', borderWidth: 1, borderColor: theme.colors.border },
  fullAddressText: { flex: 1, color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  copyButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  copyButtonText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  copyError: { color: theme.colors.destructive, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  accountDetailRow: { minHeight: 42, paddingHorizontal: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  accountDetailLabel: { color: palette.secondaryText, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.9 },
  accountDetailValue: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  sheetLockButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetLockText: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  selectionMessage: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.3)' },
  selectionMessageText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 17 },
  networkList: { gap: 0 },
  networkOption: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider },
  networkOptionSelected: { backgroundColor: 'rgba(80, 217, 255, 0.1)', borderColor: 'rgba(80, 217, 255, 0.55)' },
  networkOptionDisabled: { opacity: theme.states.disabledOpacity },
  networkOptionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
  networkOptionIconSelected: { backgroundColor: palette.background },
  networkOptionInitial: { color: palette.secondaryText, fontSize: 14 },
  networkOptionCopy: { flex: 1, minWidth: 0, gap: 3 },
  networkOptionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  networkOptionName: { flex: 1, color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  networkOptionMeta: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  networkOptionEnvironment: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 0.6 },
  previewBanner: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, padding: theme.spacing.md, flexDirection: 'row', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.35)' },
  previewBannerCopy: { flex: 1, gap: 3 },
  previewBannerTitle: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.1 },
  previewBannerBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 17 },
  homeScrollContent: { paddingHorizontal: 20, gap: 12 },
  dappEntryCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  dappEntryIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(80, 217, 255, 0.12)' },
  dappEntryCopy: { flex: 1, gap: 3 },
  dappEntryTitle: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  dappEntryBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  greeting: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: palette.cyan, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing, lineHeight: theme.typography.eyebrow.lineHeight },
  heroTitle: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
  body: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  networkCard: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  networkIcon: { alignItems: 'center', justifyContent: 'center', width: 24 },
  networkCopy: { gap: 1 },
  cardEyebrow: { color: palette.secondaryText, fontSize: 11, letterSpacing: 1 },
  networkName: { color: palette.secondaryText, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  networkStatus: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  networkChevron: { width: 28, alignItems: 'center' },
  portfolioCard: { paddingHorizontal: 16, paddingVertical: 12, gap: 1, borderRadius: 14, ...glassSurface },
  portfolioCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  portfolioTitle: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 22, lineHeight: 28, marginTop: 4 },
  portfolioBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  refreshNotice: { color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 17 },
  balanceValue: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 36, lineHeight: 44, letterSpacing: -1 },
  balanceDetailRow: { flexDirection: 'row', alignItems: 'center' },
  assetCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  assetCount: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 48, lineHeight: 54, letterSpacing: -1.5 },
  assetCountLabel: { color: palette.cyan, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  unavailableCard: { borderColor: 'rgba(244, 200, 107, 0.35)' },
  errorCard: { borderColor: 'rgba(255, 101, 132, 0.38)' },
  stateIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244, 200, 107, 0.1)' },
  refreshButton: { minHeight: 42, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  refreshButtonCompact: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: palette.text, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  actionsSection: { gap: theme.spacing.sm },
  actionsRow: { flexDirection: 'row', gap: theme.spacing.sm },
  actionButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 60, gap: 4 },
  actionButtonDisabled: { opacity: theme.states.disabledOpacity },
  actionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: palette.surface },
  actionLabel: { color: palette.text, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  actionUnavailable: { color: palette.secondaryText, fontFamily: theme.typography.micro.fontFamily, fontSize: 9 },
  assetSection: { gap: theme.spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionTitle: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 18 },
  sectionCount: { color: palette.secondaryText, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  viewAllButton: { minHeight: 36, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewAllText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  assetList: { paddingHorizontal: 4 },
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
  assetsBalanceCard: { padding: theme.spacing.lg, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.9)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.24)', ...theme.shadows.panel },
  assetsBalanceValue: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 38, lineHeight: 44, letterSpacing: -1.1 },
  assetsBalanceBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  assetsSearchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  assetsSearchInputWrap: { flex: 1 },
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
  assetDetailsContent: { paddingHorizontal: theme.spacing.lg, paddingBottom: 112, gap: theme.spacing.md },
  assetDetailsMissing: { flex: 1, paddingHorizontal: theme.spacing.lg, justifyContent: 'center', gap: theme.spacing.md },
  assetDetailsTopBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  assetDetailsTopBarCopy: { flex: 1, gap: 2 },
  assetDetailsTopBarTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 19 },
  assetDetailsHero: { paddingVertical: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.84)', borderWidth: 1, borderColor: theme.colors.border },
  assetDetailsName: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24, lineHeight: 30 },
  assetDetailsSymbol: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  assetDetailsBalance: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 34, lineHeight: 40, marginTop: theme.spacing.sm },
  assetDetailsFiat: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12 },
  assetDetailsActions: { flexDirection: 'row', gap: theme.spacing.sm },
  assetDetailsCard: { padding: theme.spacing.md, gap: theme.spacing.xs, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.84)', borderWidth: 1, borderColor: theme.colors.border },
  assetDetailRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  assetDetailLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.8 },
  assetDetailValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, textAlign: 'right' },
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