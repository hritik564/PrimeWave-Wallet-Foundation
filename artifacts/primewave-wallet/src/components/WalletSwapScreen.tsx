import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import {
  SwapQuoteService,
  type SwapQuote,
} from '@/src/core/swaps';
import type { Wallet } from '@/src/core/wallet/models';
import {
  createSwapQuoteRequest,
  formatMaxSwapAmount,
  formatSwapAmount,
  getSellAssets,
  getSwapAssets,
  quoteIsActive,
  selectDefaultBuyAsset,
  selectDefaultSellAsset,
  swapAssetKey,
  swapErrorMessage,
  swapQuoteContextKey,
  validateSwapForm,
} from './WalletSwapScreen.logic';

type PortfolioState = 'loading' | 'available' | 'empty' | 'unavailable' | 'error';

function assetLabel(asset: PortfolioAssetViewModel | null): string {
  return asset?.symbol ?? asset?.name ?? (asset?.assetType === 'native' ? 'Native' : 'Token');
}

function assetName(asset: PortfolioAssetViewModel | null): string {
  return asset?.name ?? asset?.symbol ?? (asset?.assetType === 'native' ? 'Native asset' : 'Token asset');
}

function assetIconLabel(asset: PortfolioAssetViewModel): string {
  return (asset.symbol ?? asset.name ?? (asset.assetType === 'native' ? 'N' : 'T'))
    .slice(0, 3)
    .toUpperCase();
}

function AssetIcon({ asset, size = 'regular' }: { asset: PortfolioAssetViewModel; size?: 'regular' | 'large' }) {
  const remoteIcon = asset.icon.status === 'available' && asset.icon.reference !== null;
  return (
    <View style={[styles.assetIcon, size === 'large' && styles.assetIconLarge]}>
      {remoteIcon ? (
        <Image contentFit="contain" source={{ uri: asset.icon.reference as string }} style={styles.assetIconImage} />
      ) : (
        <Text style={styles.assetInitials}>{assetIconLabel(asset)}</Text>
      )}
    </View>
  );
}

function NetworkContext({ network, onPress }: { network: EvmNetwork; onPress: () => void }) {
  const configured = network.enabled && network.configurationStatus === 'configured' && network.chainId !== null;
  return (
    <Pressable
      accessibilityLabel={`Selected network ${network.displayName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.networkContext, pressed && styles.pressed]}
    >
      <View style={styles.networkIcon}>
        <Ionicons name="globe-outline" size={20} color={configured ? theme.colors.accent : theme.states.warning} />
      </View>
      <View style={styles.networkCopy}>
        <Text style={styles.cardEyebrow}>SELECTED NETWORK</Text>
        <Text numberOfLines={1} style={styles.networkName}>{network.displayName}</Text>
        <Text style={styles.networkMeta}>{network.nativeCurrency.symbol} • {configured ? `Chain ${network.chainId}` : 'Unavailable'}</Text>
      </View>
      <Ionicons name={configured ? 'chevron-forward' : 'warning-outline'} size={18} color={configured ? theme.colors.accent : theme.states.warning} />
    </Pressable>
  );
}

function AssetSelector({
  label,
  asset,
  assets,
  onSelect,
}: {
  label: string;
  asset: PortfolioAssetViewModel | null;
  assets: readonly PortfolioAssetViewModel[];
  onSelect: (asset: PortfolioAssetViewModel) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter((item) =>
      `${item.name ?? ''} ${item.symbol ?? ''} ${item.contractAddress ?? ''}`.toLowerCase().includes(query),
    );
  }, [assets, search]);

  const close = () => {
    setSearch('');
    setVisible(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={`${label}: ${assetLabel(asset)}`}
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.assetSelector, pressed && styles.pressed]}
      >
        {asset ? <AssetIcon asset={asset} /> : <View style={styles.assetIcon}><Ionicons name="layers-outline" size={20} color={theme.colors.mutedForeground} /></View>}
        <View style={styles.assetSelectorCopy}>
          <Text style={styles.cardEyebrow}>{label}</Text>
          <Text numberOfLines={1} style={styles.assetSelectorTitle}>{assetLabel(asset)}</Text>
          <Text numberOfLines={1} style={styles.assetSelectorSubtitle}>{asset ? assetName(asset) : 'Choose from this network'}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={theme.colors.accent} />
      </Pressable>
      <Modal animationType="slide" onRequestClose={close} transparent visible={visible}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close asset selector" accessibilityRole="button" onPress={close} style={styles.modalBackdrop} />
          <View accessibilityViewIsModal style={styles.assetSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.cardEyebrow}>{label}</Text>
                <Text style={styles.sheetTitle}>Select asset</Text>
              </View>
              <Pressable accessibilityLabel="Close asset selector" accessibilityRole="button" onPress={close} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={theme.colors.foreground} />
              </Pressable>
            </View>
            <View style={styles.searchShell}>
              <Ionicons name="search-outline" size={18} color={theme.colors.mutedForeground} />
              <TextInput
                accessibilityLabel="Search swap assets"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearch}
                placeholder="Search name, symbol, or address"
                placeholderTextColor={theme.colors.mutedForeground}
                style={styles.searchInput}
                value={search}
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.assetOptionsScroll}>
              {filteredAssets.length === 0 ? (
                <View style={styles.sheetEmpty}>
                  <Ionicons name="search-outline" size={22} color={theme.colors.mutedForeground} />
                  <Text style={styles.sheetBody}>No assets match this search on the selected network.</Text>
                </View>
              ) : (
                filteredAssets.map((item) => (
                  <Pressable
                    accessibilityLabel={`Select ${assetLabel(item)}`}
                    accessibilityRole="button"
                    key={swapAssetKey(item.identity)}
                    onPress={() => { onSelect(item); close(); }}
                    style={({ pressed }) => [styles.assetOption, pressed && styles.pressed]}
                  >
                    <AssetIcon asset={item} />
                    <View style={styles.assetSelectorCopy}>
                      <Text numberOfLines={1} style={styles.assetOptionTitle}>{assetName(item)}</Text>
                      <Text numberOfLines={1} style={styles.assetSelectorSubtitle}>
                        {assetLabel(item)} • {item.formattedBalance ?? 'Balance unavailable'}
                      </Text>
                    </View>
                    {asset && swapAssetKey(item.identity) === swapAssetKey(asset.identity) ? (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} />
                    ) : null}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function TokenWarning({ asset }: { asset: PortfolioAssetViewModel | null }) {
  if (!asset || asset.assetType !== 'fungible_token' || asset.verificationStatus === 'verified') return null;
  return (
    <View style={styles.tokenWarning}>
      <Ionicons name="warning-outline" size={17} color={theme.states.warning} />
      <Text style={styles.tokenWarningText}>
        This token is not verified by WaveX. Metadata and symbols are public chain data, not a safety guarantee.
      </Text>
    </View>
  );
}

function QuoteCard({
  quote,
  buyAsset,
  sellAsset,
  network,
  now,
}: {
  quote: SwapQuote;
  buyAsset: PortfolioAssetViewModel | null;
  sellAsset: PortfolioAssetViewModel | null;
  network: EvmNetwork;
  now: number;
}) {
  const seconds = Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));
  const output = formatSwapAmount(quote.expectedBuyAmount, buyAsset?.decimals ?? null);
  const minimum = formatSwapAmount(quote.minimumBuyAmount, buyAsset?.decimals ?? null);
  const gasFee = quote.gasFee
    ? formatSwapAmount(
        quote.gasFee.amount,
        quote.gasFee.asset.assetType === 'native'
          ? network.nativeCurrency.decimals
          : buyAsset?.assetType === 'fungible_token' && buyAsset.identity.assetId === quote.gasFee.asset.assetId
            ? buyAsset.decimals
            : null,
      )
    : null;
  const routeLabel = quote.route.state === 'available'
    ? quote.route.hops.map((hop) => hop.protocol || hop.poolOrVenue).join(' → ')
    : 'Route details unavailable';

  return (
    <View style={styles.quoteCard}>
      <View style={styles.quoteHeader}>
        <View>
          <Text style={styles.cardEyebrow}>LIVE QUOTE</Text>
          <Text style={styles.quoteTitle}>Estimated receive</Text>
        </View>
        <View style={styles.quoteTimer}>
          <Ionicons name="time-outline" size={14} color={seconds < 10 ? theme.states.warning : theme.states.success} />
          <Text style={[styles.quoteTimerText, seconds < 10 && styles.quoteTimerWarning]}>{seconds}s</Text>
        </View>
      </View>
      <View style={styles.quoteOutputRow}>
        <Text numberOfLines={1} style={styles.quoteOutput}>{output ?? 'Amount unavailable'}</Text>
        <Text style={styles.quoteOutputSymbol}>{assetLabel(buyAsset)}</Text>
      </View>
      <View style={styles.quoteRows}>
        <View style={styles.quoteRow}><Text style={styles.quoteKey}>Minimum received</Text><Text style={styles.quoteValue}>{minimum ? `${minimum} ${assetLabel(buyAsset)}` : 'Unavailable'}</Text></View>
        <View style={styles.quoteRow}><Text style={styles.quoteKey}>Price impact</Text><Text style={styles.quoteValue}>{quote.priceImpact.state === 'available' ? `${(quote.priceImpact.bps / 100).toFixed(2)}%` : 'Unavailable'}</Text></View>
        <View style={styles.quoteRow}><Text style={styles.quoteKey}>Network fee</Text><Text style={styles.quoteValue}>{gasFee ? `${gasFee} ${quote.gasFee?.asset.assetType === 'native' ? assetLabel(sellAsset) : 'token'}` : 'Unavailable'}</Text></View>
        <View style={styles.quoteRow}><Text style={styles.quoteKey}>Route</Text><Text numberOfLines={1} style={styles.quoteValue}>{routeLabel}</Text></View>
        <View style={styles.quoteRow}><Text style={styles.quoteKey}>Provider</Text><Text numberOfLines={1} style={styles.quoteValue}>{quote.providerId}</Text></View>
      </View>
      {quote.allowanceRequirement ? (
        <View style={styles.quoteNotice}>
          <Ionicons name="information-circle-outline" size={16} color={theme.states.warning} />
          <Text style={styles.quoteNoticeText}>An approval may be required. Review and approval are handled in a later phase.</Text>
        </View>
      ) : null}
    </View>
  );
}

export function WalletSwapScreen({
  wallet,
  network,
  portfolio,
  portfolioState,
  quoteService,
  onBack,
  onNetworkPress,
  onComingSoon,
}: {
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly portfolio: PortfolioReadModel | null;
  readonly portfolioState: PortfolioState;
  readonly quoteService: SwapQuoteService | null;
  readonly onBack: () => void;
  readonly onNetworkPress: () => void;
  readonly onComingSoon: (message: string) => void;
}) {
  const account = wallet.accounts[0];
  const swapAssets = useMemo(() => getSwapAssets(portfolio?.assets ?? [], network), [network, portfolio?.assets]);
  const sellAssets = useMemo(() => getSellAssets(portfolio?.assets ?? [], network), [network, portfolio?.assets]);
  const defaultSellAsset = useMemo(() => selectDefaultSellAsset(portfolio?.assets ?? [], network), [network, portfolio?.assets]);
  const [sellKey, setSellKey] = useState('');
  const [buyKey, setBuyKey] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.50');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'requesting' | 'failed'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestVersion = useRef(0);

  const sellAsset = sellAssets.find((item) => swapAssetKey(item.identity) === sellKey) ?? defaultSellAsset;
  const defaultBuyAsset = useMemo(
    () => selectDefaultBuyAsset(portfolio?.assets ?? [], network, sellAsset),
    [network, portfolio?.assets, sellAsset],
  );
  const buyAsset = swapAssets.find((item) => swapAssetKey(item.identity) === buyKey) ?? defaultBuyAsset;
  const validation = useMemo(
    () => validateSwapForm({
      accountId: account?.accountId ?? '',
      senderAddress: account?.address ?? '',
      network,
      sellAsset,
      buyAsset,
      amount,
      slippage,
    }),
    [account?.accountId, account?.address, amount, buyAsset, network, sellAsset, slippage],
  );
  const contextKey = useMemo(
    () => swapQuoteContextKey({
      accountId: account?.accountId ?? '',
      senderAddress: account?.address ?? '',
      network,
      sellAsset,
      buyAsset,
      amount,
      slippage,
    }),
    [account?.accountId, account?.address, amount, buyAsset, network, sellAsset, slippage],
  );
  const expired = quote !== null && !quoteIsActive(quote, now);
  const canReview = quote !== null && !expired && validation.canQuote;

  useEffect(() => {
    setSellKey('');
    setBuyKey('');
    setAmount('');
    setQuote(null);
    setQuoteError(null);
    setQuoteStatus('idle');
  }, [network.id]);

  useEffect(() => {
    if (!quote) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setQuote(null);
    setQuoteError(null);
    setQuoteStatus('idle');
    quoteService?.clear();

    if (!validation.canQuote || !sellAsset || !buyAsset || !validation.amount.rawAmount || validation.slippage.state !== 'valid') {
      return undefined;
    }
    if (!quoteService) {
      setQuoteStatus('failed');
      setQuoteError('Swap quotes are not configured for this build.');
      return undefined;
    }

    const rawAmount = validation.amount.rawAmount;
    const slippageBps = validation.slippage.bps;
    if (rawAmount === null || slippageBps === null) return undefined;

    const timer = setTimeout(() => {
      setQuoteStatus('requesting');
      const request = createSwapQuoteRequest({
        accountId: account?.accountId ?? '',
        senderAddress: account?.address ?? '',
        network,
        sellAsset,
        buyAsset,
        amount: rawAmount,
        slippageBps,
      });
      void quoteService.getQuote(request).then((nextQuote) => {
        if (requestVersion.current !== version) return;
        setQuote(nextQuote);
        setNow(Date.now());
        setQuoteStatus('idle');
      }).catch((error: unknown) => {
        if (requestVersion.current !== version) return;
        setQuoteError(swapErrorMessage(error));
        setQuoteStatus('failed');
      });
    }, 550);
    return () => clearTimeout(timer);
  }, [account?.accountId, account?.address, buyAsset, contextKey, network, quoteService, refreshNonce, sellAsset, validation]);

  const swapPair = useCallback(() => {
    if (!sellAsset || !buyAsset) return;
    setSellKey(swapAssetKey(buyAsset.identity));
    setBuyKey(swapAssetKey(sellAsset.identity));
    setAmount('');
  }, [buyAsset, sellAsset]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardContainer}>
      <ScrollView
        accessibilityLabel="Swap screen"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>SWAP</Text>
          <Text style={styles.title}>Exchange assets</Text>
          <Text style={styles.body}>Get a live exact-input quote for the selected network. Nothing is signed or broadcast from this screen.</Text>
        </View>
        <NetworkContext network={network} onPress={onNetworkPress} />
        <View style={styles.tradeCard}>
          <View style={styles.tradeLabelRow}>
            <Text style={styles.cardEyebrow}>YOU SELL</Text>
            <Text style={styles.balanceLabel}>{sellAsset?.formattedBalance ? `Balance ${sellAsset.formattedBalance}` : 'Balance unavailable'}</Text>
          </View>
          <AssetSelector asset={sellAsset} assets={sellAssets} label="SELL ASSET" onSelect={(next) => {
            setSellKey(swapAssetKey(next.identity));
            if (buyAsset && swapAssetKey(buyAsset.identity) === swapAssetKey(next.identity)) setBuyKey('');
            setAmount('');
          }} />
          <View style={styles.amountShell}>
            <TextInput
              accessibilityLabel="Sell amount"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={theme.colors.mutedForeground}
              style={styles.amountInput}
              value={amount}
            />
            <Pressable accessibilityLabel="Use maximum sell balance" accessibilityRole="button" disabled={!sellAsset} onPress={() => setAmount(formatMaxSwapAmount(sellAsset))} style={({ pressed }) => [styles.maxButton, pressed && styles.pressed]}>
              <Text style={styles.maxText}>MAX</Text>
            </Pressable>
          </View>
          {validation.amount.state !== 'valid' && amount.length > 0 ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.amount.message}</Text> : null}
        </View>
        <Pressable accessibilityLabel="Reverse swap pair" accessibilityRole="button" disabled={!sellAsset || !buyAsset} onPress={swapPair} style={({ pressed }) => [styles.reverseButton, pressed && styles.pressed]}>
          <Ionicons name="swap-vertical-outline" size={20} color={theme.colors.accent} />
        </Pressable>
        <View style={styles.tradeCard}>
          <View style={styles.tradeLabelRow}>
            <Text style={styles.cardEyebrow}>YOU RECEIVE</Text>
            <Text style={styles.balanceLabel}>{quote && !expired ? 'Estimated output' : 'Output after quote'}</Text>
          </View>
          <AssetSelector asset={buyAsset} assets={swapAssets} label="RECEIVE ASSET" onSelect={(next) => {
            if (sellAsset && swapAssetKey(sellAsset.identity) === swapAssetKey(next.identity)) setSellKey('');
            setBuyKey(swapAssetKey(next.identity));
          }} />
          <View style={styles.outputShell}>
            <Text numberOfLines={1} style={styles.outputValue}>
              {quote && !expired ? formatSwapAmount(quote.expectedBuyAmount, buyAsset?.decimals ?? null) ?? '—' : '—'}
            </Text>
            <Text style={styles.outputSymbol}>{assetLabel(buyAsset)}</Text>
          </View>
        </View>
        <TokenWarning asset={sellAsset} />
        <TokenWarning asset={buyAsset} />
        <View style={styles.slippageCard}>
          <View style={styles.slippageHeader}>
            <View>
              <Text style={styles.cardEyebrow}>SLIPPAGE TOLERANCE</Text>
              <Text style={styles.slippageTitle}>Protect the minimum receive</Text>
            </View>
            <Text style={styles.slippageValue}>{validation.slippage.state === 'valid' ? `${(validation.slippage.bps / 100).toFixed(2)}%` : 'Invalid'}</Text>
          </View>
          <View style={styles.slippageControls}>
            {['0.50', '1.00', '3.00'].map((preset) => (
              <Pressable key={preset} accessibilityLabel={`Set slippage to ${preset}%`} accessibilityRole="button" onPress={() => setSlippage(preset)} style={({ pressed }) => [styles.slippageChip, slippage === preset && styles.slippageChipSelected, pressed && styles.pressed]}>
                <Text style={[styles.slippageChipText, slippage === preset && styles.slippageChipTextSelected]}>{preset}%</Text>
              </Pressable>
            ))}
            <TextInput accessibilityLabel="Custom slippage percentage" keyboardType="decimal-pad" onChangeText={setSlippage} placeholder="Custom" placeholderTextColor={theme.colors.mutedForeground} style={styles.slippageInput} value={slippage === '0.50' || slippage === '1.00' || slippage === '3.00' ? '' : slippage} />
          </View>
          {validation.slippage.state === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.slippage.message}</Text> : null}
          {validation.slippage.state === 'valid' && validation.slippage.bps >= 1000 ? <Text style={styles.warningText}>High slippage can result in materially worse execution.</Text> : null}
        </View>
        {portfolioState === 'loading' ? <View style={styles.statusRow}><ActivityIndicator color={theme.colors.accent} size="small" /><Text style={styles.helperText}>Loading public assets…</Text></View> : null}
        {portfolioState === 'empty' || swapAssets.length === 0 ? <Text style={styles.warningText}>No supported swap assets are available on this network.</Text> : null}
        {!validation.canQuote && validation.message ? <Text accessibilityRole="alert" style={styles.helperText}>{validation.message}</Text> : null}
        {quoteStatus === 'requesting' ? <View style={styles.statusRow}><ActivityIndicator color={theme.colors.accent} size="small" /><Text style={styles.helperText}>Requesting a fresh quote…</Text></View> : null}
        {quoteStatus === 'failed' && quoteError ? (
          <View style={styles.errorPanel}>
            <Ionicons name="cloud-offline-outline" size={18} color={theme.states.warning} />
            <View style={styles.errorPanelCopy}><Text style={styles.errorPanelTitle}>Quote unavailable</Text><Text style={styles.errorPanelBody}>{quoteError}</Text></View>
            <Pressable accessibilityLabel="Refresh swap quote" accessibilityRole="button" disabled={!validation.canQuote} onPress={() => { setQuoteError(null); setQuoteStatus('idle'); setRefreshNonce((value) => value + 1); }} style={styles.refreshButton}><Ionicons name="refresh-outline" size={18} color={theme.colors.accent} /></Pressable>
          </View>
        ) : null}
        {quote && !expired ? <QuoteCard buyAsset={buyAsset} network={network} now={now} quote={quote} sellAsset={sellAsset} /> : null}
        {expired ? (
          <View style={styles.expiredPanel}>
            <Ionicons name="time-outline" size={18} color={theme.states.warning} />
            <Text style={styles.expiredText}>This quote expired. Refresh to request a current quote.</Text>
          </View>
        ) : null}
        <Pressable accessibilityLabel="Review Swap" accessibilityRole="button" disabled={!canReview} onPress={() => onComingSoon('Swap review and approval will be available in Phase 6.4.')} style={({ pressed }) => [styles.primaryButton, !canReview && styles.disabledButton, pressed && canReview && styles.pressed]}>
          <Text style={styles.primaryButtonText}>Review Swap</Text>
          <Ionicons name="arrow-forward-outline" size={18} color={theme.colors.primaryForeground} />
        </Pressable>
        <Pressable accessibilityLabel="Back to Home" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.secondaryButtonText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: { flex: 1 },
  content: { paddingHorizontal: theme.spacing.lg, paddingBottom: 132, gap: theme.spacing.md },
  heading: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 32, lineHeight: 39 },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.15 },
  networkContext: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.76)', borderWidth: 1, borderColor: theme.colors.border },
  networkIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  networkCopy: { flex: 1, gap: 3 },
  networkName: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  networkMeta: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  tradeCard: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.9)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.2)', ...theme.shadows.panel },
  tradeLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  assetSelector: { minHeight: 68, padding: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(7, 11, 25, 0.44)', borderWidth: 1, borderColor: theme.colors.border },
  assetIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(124, 140, 255, 0.2)' },
  assetIconLarge: { width: 48, height: 48, borderRadius: 16 },
  assetIconImage: { width: '68%', height: '68%' },
  assetInitials: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  assetSelectorCopy: { flex: 1, gap: 3 },
  assetSelectorTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  assetSelectorSubtitle: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  amountShell: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  amountInput: { flex: 1, minHeight: 56, paddingHorizontal: theme.spacing.md, color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25 },
  maxButton: { minWidth: 52, minHeight: 40, marginRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  maxText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11, letterSpacing: 0.6 },
  outputShell: { minHeight: 58, paddingHorizontal: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(7, 11, 25, 0.44)', borderWidth: 1, borderColor: theme.colors.border },
  outputValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 25 },
  outputSymbol: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 0.7 },
  reverseButton: { alignSelf: 'center', width: 42, height: 42, marginVertical: -8, zIndex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#101a34', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.45)' },
  tokenWarning: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.25)' },
  tokenWarningText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  slippageCard: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.78)', borderWidth: 1, borderColor: theme.colors.border },
  slippageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slippageTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, marginTop: 4 },
  slippageValue: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 14 },
  slippageControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  slippageChip: { minHeight: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: 'rgba(7, 11, 25, 0.44)', borderWidth: 1, borderColor: theme.colors.border },
  slippageChipSelected: { backgroundColor: 'rgba(80, 217, 255, 0.14)', borderColor: 'rgba(80, 217, 255, 0.6)' },
  slippageChipText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  slippageChipTextSelected: { color: theme.colors.accent },
  slippageInput: { flex: 1, minHeight: 36, paddingHorizontal: 8, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, textAlign: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  warningText: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  statusRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorPanel: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.28)' },
  errorPanelCopy: { flex: 1, gap: 3 },
  errorPanelTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  errorPanelBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  refreshButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  quoteCard: { padding: theme.spacing.md, gap: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.94)', borderWidth: 1, borderColor: 'rgba(101, 230, 166, 0.35)', ...theme.shadows.panel },
  quoteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quoteTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15, marginTop: 4 },
  quoteTimer: { minHeight: 28, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: theme.radius.pill, backgroundColor: 'rgba(101, 230, 166, 0.1)' },
  quoteTimerText: { color: theme.states.success, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  quoteTimerWarning: { color: theme.states.warning },
  quoteOutputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  quoteOutput: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 30 },
  quoteOutputSymbol: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  quoteRows: { gap: 9, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(126, 145, 191, 0.16)' },
  quoteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  quoteKey: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  quoteValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, textAlign: 'right' },
  quoteNotice: { padding: theme.spacing.sm, flexDirection: 'row', gap: 7, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)' },
  quoteNoticeText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  expiredPanel: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.28)' },
  expiredText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent, ...theme.shadows.glow },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13, letterSpacing: 0.4 },
  disabledButton: { opacity: 0.4 },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: 'rgba(18, 29, 56, 0.65)' },
  secondaryButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  pressed: { opacity: theme.states.pressedOpacity },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 15, 0.7)' },
  assetSheet: { maxHeight: '88%', padding: theme.spacing.lg, paddingBottom: 34, gap: theme.spacing.sm, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#101a34', borderTopWidth: 1, borderColor: theme.colors.border },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.mutedForeground, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24, marginTop: 3 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: theme.colors.secondary },
  searchShell: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  searchInput: { flex: 1, minHeight: 44, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  assetOptionsScroll: { maxHeight: 390 },
  assetOption: { minHeight: 68, marginBottom: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.8)', borderWidth: 1, borderColor: theme.colors.border },
  assetOptionTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  sheetEmpty: { paddingVertical: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm },
  sheetBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});