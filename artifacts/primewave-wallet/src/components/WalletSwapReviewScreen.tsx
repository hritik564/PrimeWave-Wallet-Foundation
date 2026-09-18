import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type { PortfolioReadModel } from '@/src/core/portfolio';
import {
  formatSwapReviewAmount,
  SwapReviewError,
  SwapReviewService,
  type SwapReviewApproval,
  type SwapReviewSnapshot,
  type SwapQuote,
  type SwapQuoteLifecycleState,
} from '@/src/core/swaps';
import type { SwapQuoteService } from '@/src/core/swaps';
import type { Wallet } from '@/src/core/wallet/models';
import {
  AssetIcon,
  assetLabel,
  assetName,
} from './WalletSwapScreen';
import {
  findReviewPortfolioAsset,
  formatReviewFee,
  formatReviewImpact,
  formatReviewSlippage,
  reviewFeeAssetLabel,
  reviewRouteLabel,
} from './WalletSwapReviewScreen.logic';

type ReviewScreenState = 'loading' | 'ready' | 'error' | 'approved';

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function SectionCard({
  eyebrow,
  children,
  warning = false,
}: {
  readonly eyebrow: string;
  readonly children: React.ReactNode;
  readonly warning?: boolean;
}) {
  return (
    <View style={[styles.card, warning && styles.warningCard]}>
      <Text style={styles.cardEyebrow}>{eyebrow}</Text>
      {children}
    </View>
  );
}

function ReviewAssetRow({
  label,
  amount,
  asset,
  portfolioAsset,
}: {
  readonly label: string;
  readonly amount: string;
  readonly asset: SwapReviewSnapshot['sellAsset'];
  readonly portfolioAsset: NonNullable<ReturnType<typeof findReviewPortfolioAsset>>;
}) {
  return (
    <View style={styles.assetRow}>
      <AssetIcon asset={portfolioAsset} size="large" />
      <View style={styles.assetCopy}>
        <Text style={styles.cardEyebrow}>{label}</Text>
        <Text numberOfLines={1} style={styles.assetAmount}>{amount} {asset.symbol ?? assetName(portfolioAsset)}</Text>
        <Text numberOfLines={1} style={styles.assetName}>{assetName(portfolioAsset)} • {asset.networkId}</Text>
      </View>
    </View>
  );
}

export function WalletSwapReviewScreen({
  quote,
  quoteService,
  wallet,
  network,
  networkRegistry,
  portfolio,
  previewMode,
  onBack,
  onApproved,
}: {
  readonly quote: SwapQuote;
  readonly quoteService: SwapQuoteService | null;
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly networkRegistry: NetworkRegistry;
  readonly portfolio: PortfolioReadModel | null;
  readonly previewMode: boolean;
  readonly onBack: () => void;
  readonly onApproved: (approval: SwapReviewApproval) => void;
}) {
  const account = wallet.accounts[0];
  const reviewService = useMemo(() => new SwapReviewService(networkRegistry), [networkRegistry]);
  const sellAsset = useMemo(
    () => portfolio?.assets.find((asset) => asset.identity.networkId === quote.sellAsset.networkId && asset.identity.assetType === quote.sellAsset.assetType && asset.identity.assetId === quote.sellAsset.assetId) ?? null,
    [portfolio, quote.sellAsset],
  );
  const buyAsset = useMemo(
    () => portfolio?.assets.find((asset) => asset.identity.networkId === quote.buyAsset.networkId && asset.identity.assetType === quote.buyAsset.assetType && asset.identity.assetId === quote.buyAsset.assetId) ?? null,
    [portfolio, quote.buyAsset],
  );
  const input = useMemo(() => ({
    quote,
    quoteLifecycleState: (quoteService?.getLifecycle().state ?? 'quoted') as SwapQuoteLifecycleState,
    account: {
      accountId: account?.accountId ?? '',
      address: account?.address ?? '',
    },
    network,
    registeredNetwork: networkRegistry.getById(network.id),
    activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? network.id,
    sellAsset,
    buyAsset,
    portfolio,
  }), [account?.accountId, account?.address, buyAsset, network, networkRegistry, portfolio, quote, quoteService, sellAsset]);
  const [state, setState] = useState<ReviewScreenState>('loading');
  const [review, setReview] = useState<SwapReviewSnapshot | null>(null);
  const [approval, setApproval] = useState<SwapReviewApproval | null>(null);
  const [advancedVisible, setAdvancedVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setReview(null);
    setApproval(null);
    setErrorMessage(null);
    try {
      const nextReview = reviewService.createReview(input);
      if (!cancelled) {
        setReview(nextReview);
        setState('ready');
      }
    } catch (error: unknown) {
      if (!cancelled) {
        setState('error');
        setErrorMessage(error instanceof SwapReviewError ? error.message : 'Swap review is unavailable. Return to Swap.');
      }
    }
    return () => {
      cancelled = true;
    };
  }, [input, reviewService]);

  const handleApprove = () => {
    if (!review || state !== 'ready') return;
    if (previewMode) {
      setErrorMessage('Preview Test Mode cannot produce swap approvals. Use a native wallet session for a real public review.');
      return;
    }
    try {
      const nextApproval = reviewService.approveReview({ review, current: input });
      setApproval(nextApproval);
      setState('approved');
      onApproved(nextApproval);
    } catch (error: unknown) {
      setErrorMessage(error instanceof SwapReviewError ? error.message : 'The reviewed swap is no longer current.');
    }
  };

  if (state === 'loading') {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
        <Text style={styles.stateTitle}>Preparing swap review</Text>
        <Text style={styles.stateBody}>Rechecking the quote, transaction, network, and public balances.</Text>
      </View>
    );
  }

  if (state === 'error' || !review || !sellAsset || !buyAsset) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>SWAP REVIEW</Text>
        <Text style={styles.title}>Review unavailable</Text>
        <Text style={styles.body}>{errorMessage ?? 'The selected quote cannot be reviewed in the current wallet context.'}</Text>
        <Pressable accessibilityLabel="Return to Swap" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.primaryForeground} />
          <Text style={styles.primaryButtonText}>Return to Swap</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (state === 'approved' && approval) {
    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>APPROVED FOR SIGNING</Text>
          <Text style={styles.title}>Swap approval recorded</Text>
          <Text style={styles.body}>The exact public transaction context was approved for a future signing phase. Nothing was signed, approved on-chain, or broadcast.</Text>
        </View>
        <SectionCard eyebrow="REVIEW BINDING">
          <DetailRow label="Review digest" value={approval.reviewDigest} />
          <DetailRow label="Quote" value={`${approval.providerId} • ${approval.quoteId}`} />
          <DetailRow label="Network" value={`${approval.networkId} • Chain ${approval.chainId.toString()}`} />
          <DetailRow label="Sender" value={shortAddress(approval.senderAddress)} />
        </SectionCard>
        <View style={styles.successPanel}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.states.success} />
          <Text style={styles.successText}>Ready for a later signing phase. This screen has not requested authentication or accessed wallet secrets.</Text>
        </View>
        <Pressable accessibilityLabel="Return to Swap" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.secondaryButtonText}>Return to Swap</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const gasFee = formatReviewFee(review.gasFee, network, review.sellAsset, review.buyAsset);
  const gasAsset = reviewFeeAssetLabel(review.gasFee, network, review.sellAsset, review.buyAsset);
  const protocolFee = formatReviewFee(review.protocolFee, network, review.sellAsset, review.buyAsset);
  const providerFee = formatReviewFee(review.providerFee, network, review.sellAsset, review.buyAsset);
  const totalNativeCost = review.sellAsset.assetType === 'native' && review.gasFee
    ? formatSwapReviewAmount(review.sellAmount + review.gasFee.amount, network.nativeCurrency.decimals)
    : null;
  const previewBlocksApproval = previewMode;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>SWAP REVIEW</Text>
        <Text style={styles.title}>Check every detail</Text>
        <Text style={styles.body}>WaveX never treats an external provider quote as signing authorization. Review the exact public transaction context before approving it for a later signing phase.</Text>
      </View>
      <SectionCard eyebrow="YOU PAY">
        <ReviewAssetRow amount={review.sellAmountDisplay} asset={review.sellAsset} label="SELL ASSET" portfolioAsset={sellAsset} />
      </SectionCard>
      <View style={styles.swapMarker}><Ionicons name="arrow-down-outline" size={20} color={theme.colors.accent} /></View>
      <SectionCard eyebrow="YOU RECEIVE">
        <ReviewAssetRow amount={`~${review.expectedBuyAmountDisplay}`} asset={review.buyAsset} label="RECEIVE ASSET" portfolioAsset={buyAsset} />
        <View style={styles.minimumPanel}>
          <Text style={styles.detailLabel}>Minimum received</Text>
          <Text style={styles.minimumValue}>{review.minimumBuyAmountDisplay} {review.buyAsset.symbol ?? assetLabel(buyAsset)}</Text>
        </View>
      </SectionCard>
      <SectionCard eyebrow="QUOTE DETAILS">
        <DetailRow label="Slippage tolerance" value={formatReviewSlippage(review.slippageBps)} />
        <DetailRow label="Price impact" value={formatReviewImpact(review)} />
        <DetailRow label="Route" value={reviewRouteLabel(review)} />
        <DetailRow label="Quote provider" value={review.providerId} />
        <DetailRow label="Quote expires" value={new Date(quote.expiresAt).toLocaleTimeString()} />
      </SectionCard>
      <SectionCard eyebrow="COSTS">
        <DetailRow label="Network fee" value={gasFee ? `${gasFee} ${gasAsset}` : 'Unavailable'} />
        <DetailRow label="Protocol fee" value={protocolFee ? `${protocolFee} ${reviewFeeAssetLabel(review.protocolFee, network, review.sellAsset, review.buyAsset)}` : 'Unavailable'} />
        <DetailRow label="Provider fee" value={providerFee ? `${providerFee} ${reviewFeeAssetLabel(review.providerFee, network, review.sellAsset, review.buyAsset)}` : 'Unavailable'} />
        {totalNativeCost ? <DetailRow label="Total native cost" value={`${totalNativeCost} ${network.nativeCurrency.symbol}`} /> : null}
        {review.sellAsset.assetType === 'fungible_token' ? <Text style={styles.helperText}>You must retain sufficient {network.nativeCurrency.symbol} for the network fee.</Text> : null}
      </SectionCard>
      {review.allowanceRequirement ? (
        <SectionCard eyebrow="APPROVAL REQUIRED" warning>
          <Text style={styles.warningTitle}>Token approval required before the swap</Text>
          <Text style={styles.warningText}>WaveX will not execute, sign, or broadcast this approval in Phase 6.4.</Text>
          <DetailRow label="Spender" value={shortAddress(review.allowanceRequirement.spender)} />
          <DetailRow label="Exact required amount" value={`${review.sellAmountDisplay} ${review.sellAsset.symbol ?? 'token'}`} />
          <DetailRow label="Current allowance" value={review.allowanceRequirement.actualAmount === null ? 'Unavailable' : `${formatSwapReviewAmount(review.allowanceRequirement.actualAmount, review.sellAsset.decimals ?? 0)} ${review.sellAsset.symbol ?? 'token'}`} />
        </SectionCard>
      ) : null}
      <View style={styles.contractWarning}>
        <Ionicons name="information-circle-outline" size={19} color={theme.states.warning} />
        <Text style={styles.warningText}>Swap transactions interact with smart contracts. Valid calldata syntax does not by itself establish that the contract interaction is safe.</Text>
      </View>
      {review.blockers.length > 0 ? (
        <View style={styles.blockerPanel}>
          <Ionicons name="lock-closed-outline" size={19} color={theme.states.warning} />
          <View style={styles.blockerCopy}>
            <Text style={styles.warningTitle}>Approval unavailable</Text>
            {review.blockers.map((blocker) => <Text key={blocker.code} style={styles.warningText}>{blocker.message}</Text>)}
          </View>
        </View>
      ) : null}
      {previewBlocksApproval ? (
        <View style={styles.blockerPanel}>
          <Ionicons name="flask-outline" size={19} color={theme.states.warning} />
          <View style={styles.blockerCopy}>
            <Text style={styles.warningTitle}>Preview approval disabled</Text>
            <Text style={styles.warningText}>Preview Test Mode can display public review state but cannot produce a successful swap approval.</Text>
          </View>
        </View>
      ) : null}
      {errorMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text> : null}
      <Pressable accessibilityLabel={advancedVisible ? 'Hide advanced swap details' : 'Show advanced swap details'} accessibilityRole="button" onPress={() => setAdvancedVisible((visible) => !visible)} style={({ pressed }) => [styles.advancedButton, pressed && styles.pressed]}>
        <Text style={styles.advancedButtonText}>{advancedVisible ? 'Hide advanced details' : 'Show advanced details'}</Text>
        <Ionicons name={advancedVisible ? 'chevron-up' : 'chevron-down'} size={17} color={theme.colors.accent} />
      </Pressable>
      {advancedVisible ? (
        <SectionCard eyebrow="ADVANCED DETAILS">
          <DetailRow label="Network" value={`${review.networkId} • Chain ${review.chainId.toString()}`} />
          <DetailRow label="Sender" value={shortAddress(review.senderAddress)} />
          <DetailRow label="Quote ID" value={review.quoteId} />
          <DetailRow label="Review digest" value={review.reviewDigest} />
          <DetailRow label="Transaction target" value={shortAddress(review.transactionRequest.to)} />
          <DetailRow label="Transaction value" value={`${formatSwapReviewAmount(review.transactionRequest.value, network.nativeCurrency.decimals)} ${network.nativeCurrency.symbol}`} />
          <DetailRow label="Calldata" value={`${(review.transactionRequest.data.length - 2) / 2} bytes`} />
          <DetailRow label="Gas estimate" value={review.gasEstimate === null ? 'Unavailable' : review.gasEstimate.toString()} />
        </SectionCard>
      ) : null}
      <Text style={styles.irreversibleText}>Once signed and broadcast, blockchain transactions generally cannot be reversed.</Text>
      <Pressable accessibilityLabel="Approve Swap" accessibilityRole="button" disabled={!review.canApprove || previewBlocksApproval} onPress={handleApprove} style={({ pressed }) => [styles.primaryButton, (!review.canApprove || previewBlocksApproval) && styles.disabledButton, pressed && review.canApprove && !previewBlocksApproval && styles.pressed]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primaryForeground} />
        <Text style={styles.primaryButtonText}>Approve Swap</Text>
      </Pressable>
      <Pressable accessibilityLabel="Back to Swap" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
        <Text style={styles.secondaryButtonText}>Back to Swap</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingBottom: 132, gap: theme.spacing.md },
  heading: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 30, lineHeight: 37 },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  card: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.panel },
  warningCard: { borderColor: 'rgba(244, 200, 107, 0.34)', backgroundColor: 'rgba(42, 35, 40, 0.84)' },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.15 },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  assetCopy: { flex: 1, gap: 4 },
  assetAmount: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24 },
  assetName: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  swapMarker: { alignSelf: 'center', width: 42, height: 42, marginVertical: -8, zIndex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#101a34', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.45)' },
  minimumPanel: { padding: theme.spacing.sm, gap: 4, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.08)' },
  minimumValue: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  detailRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  detailLabel: { flex: 1, color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  detailValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, textAlign: 'right' },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  warningTitle: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  warningText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  contractWarning: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.25)' },
  blockerPanel: { padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: theme.radius.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.25)' },
  blockerCopy: { flex: 1, gap: 4 },
  successPanel: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(87, 224, 151, 0.08)', borderWidth: 1, borderColor: 'rgba(87, 224, 151, 0.3)' },
  successText: { flex: 1, color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, lineHeight: 19 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, lineHeight: 19 },
  irreversibleText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  advancedButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
  advancedButtonText: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  primaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  secondaryButtonText: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  disabledButton: { opacity: 0.42 },
  pressed: { opacity: 0.78 },
  centerState: { flex: 1, minHeight: 520, paddingHorizontal: theme.spacing.lg, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  stateTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 20, textAlign: 'center' },
  stateBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});