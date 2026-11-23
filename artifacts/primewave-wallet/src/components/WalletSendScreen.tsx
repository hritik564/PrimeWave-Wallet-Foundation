import { WalletLogo } from '@/src/design-system/components/WalletLogo';
import { GlassLayer } from '@/src/design-system/components/GlassLayer';
import { glassSurface } from '@/src/design-system/tokens/wallet-home';
import { walletHomeColors as palette } from '@/src/design-system/tokens/wallet-home';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import {
  WaveXAssetRow,
  WaveXBottomSheet,
  WaveXButton,
  WaveXSearchInput,
  WaveXStatusIndicator,
} from '@/src/design-system';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import type { Wallet } from '@/src/core/wallet/models';
import { pastePublicAddress } from './public-address-actions';
import {
  assetIdentityKey,
  createPublicSendDraft,
  formatMaxAmount,
  getSendableAssets,
  selectDefaultSendAsset,
  validateSendForm,
  validateRecipient,
  type PublicSendDraft,
} from './WalletSendScreen.logic';
import {
  assetDisplayName,
  assetDisplaySubtitle,
  assetMatchesSearch,
  assetStateLabel,
  shortPublicAddress,
} from './WalletHomeShell.logic';

type PortfolioState = 'loading' | 'available' | 'empty' | 'unavailable' | 'error';

function AssetPicker({
  asset,
  assets,
  onSelect,
}: {
  asset: PortfolioAssetViewModel | null;
  assets: readonly PortfolioAssetViewModel[];
  onSelect: (next: PortfolioAssetViewModel) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const filteredAssets = useMemo(
    () => assets.filter((item) => assetMatchesSearch(item, query)),
    [assets, query],
  );
  return (
    <>
      <Pressable
        accessibilityLabel="Select asset"
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.assetSelector, pressed && styles.pressed]}
      >
      <GlassLayer />
        {asset ? <WalletLogo asset={asset.identity} /> : <View style={styles.assetIcon}><Ionicons name="layers-outline" size={20} color={palette.secondaryText} /></View>}
        <View style={styles.assetSelectorCopy}>
          <Text style={styles.cardEyebrow}>SENDING ASSET</Text>
          <Text style={styles.assetSelectorTitle}>{asset?.symbol ?? 'Select asset'}</Text>
          <Text style={styles.assetSelectorSubtitle}>{asset?.name ?? 'Choose from this network portfolio'}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={palette.cyan} />
      </Pressable>
      <WaveXBottomSheet onClose={() => setVisible(false)} title="Select Token" visible={visible}>
        <WaveXSearchInput
          onChangeText={setQuery}
          placeholder="Search tokens..."
          value={query}
        />
        {filteredAssets.length === 0 ? (
          <Text style={styles.sheetBody}>
            {assets.length === 0
              ? 'No native or ERC-20 assets are available for this network.'
              : 'No matching tokens.'}
          </Text>
        ) : (
          filteredAssets.map((item) => {
            const selected = assetIdentityKey(item.identity) === assetIdentityKey(
              asset?.identity ?? { networkId: '', assetType: 'native', assetId: 'native' },
            );
            return (
              <WaveXAssetRow
                amount={item.formattedBalance ?? 'Unavailable'}
                logo={<WalletLogo asset={item.identity} />}
                key={assetIdentityKey(item.identity)}
                onPress={() => {
                  onSelect(item);
                  setVisible(false);
                  setQuery('');
                }}
                status={selected ? `Selected • ${assetStateLabel(item)}` : assetStateLabel(item)}
                subtitle={`${assetDisplaySubtitle(item)} • ${item.networkId}`}
                title={assetDisplayName(item)}
                trailing={
                  selected ? (
                    <Ionicons
                      accessibilityLabel="Selected token"
                      name="checkmark-circle"
                      size={18}
                      color={palette.cyan}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </WaveXBottomSheet>
    </>
  );
}

export function WalletSendScreen({
  wallet,
  network,
  portfolio,
  portfolioState,
  initialAsset,
  onNetworkPress,
  onComingSoon,
  onReviewDraft,
}: {
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly portfolio: PortfolioReadModel | null;
  readonly portfolioState: PortfolioState;
  readonly initialAsset?: PortfolioAssetViewModel | null;
  readonly onNetworkPress: () => void;
  readonly onComingSoon: (message: string) => void;
  readonly onReviewDraft: (draft: PublicSendDraft) => void;
}) {
  const account = wallet.accounts[0];
  const sendableAssets = useMemo(
    () => getSendableAssets(portfolio?.assets ?? [], network),
    [network, portfolio?.assets],
  );
  const defaultAsset = useMemo(
    () => sendableAssets.find(item => initialAsset && assetIdentityKey(item.identity) === assetIdentityKey(initialAsset.identity))
      ?? selectDefaultSendAsset(sendableAssets, network),
    [initialAsset, network, sendableAssets],
  );
  const [selectedAssetKey, setSelectedAssetKey] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [pasteState, setPasteState] = useState<'idle' | 'pasted' | 'error'>('idle');

  const selectedAsset =
    sendableAssets.find((item) => assetIdentityKey(item.identity) === selectedAssetKey) ??
    defaultAsset;
  const validation = validateSendForm({ network, asset: selectedAsset, recipient, amount });
  const maxAmount = formatMaxAmount(selectedAsset);
  const recipientState = validateRecipient(recipient);
  const networkAvailable =
    network.enabled && network.configurationStatus === 'configured' && network.chainId !== null;

  useEffect(() => {
    setSelectedAssetKey(defaultAsset ? assetIdentityKey(defaultAsset.identity) : '');
  }, [defaultAsset]);

  useEffect(() => {
    setRecipient('');
    setAmount('');
    setPasteState('idle');
  }, [network.id]);

  const handlePaste = async () => {
    try {
      const value = await pastePublicAddress();
      setRecipient(value);
      setPasteState('pasted');
    } catch {
      setPasteState('error');
    }
  };

  const handleReview = () => {
    if (!account || !selectedAsset || !validation.canReview) return;
    try {
      onReviewDraft(createPublicSendDraft({
        accountId: account.accountId,
        senderPublicAddress: account.address,
        network,
        asset: selectedAsset,
        recipient,
        amount,
      }));
    } catch {
      onComingSoon('The transaction review could not be prepared.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardContainer}>
      <ScrollView
        accessibilityLabel="Send screen"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Send</Text>
        </View>
        <Pressable accessibilityLabel={`Selected network ${network.displayName}`} accessibilityRole="button" onPress={onNetworkPress} style={styles.contextRow}>
          <View style={styles.networkCopy}>
            <Text style={styles.networkName}>{account ? `Account ${account.index + 1}` : 'Account unavailable'}</Text>
            <Text style={styles.networkMeta}>{account && shortPublicAddress(account.address)}</Text>
          </View>
          <Text style={styles.networkName}>{network.displayName}</Text>
          <Ionicons name="chevron-down" size={16} color={palette.secondaryText} />
        </Pressable>
        <AssetPicker asset={selectedAsset} assets={sendableAssets} onSelect={(next) => { setSelectedAssetKey(assetIdentityKey(next.identity)); setRecipient(''); setAmount(''); }} />
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Recipient address</Text>
            <WaveXStatusIndicator
              label={recipientState.state === 'empty' ? 'Required' : recipientState.state}
              tone={
                recipientState.state === 'invalid'
                  ? 'error'
                  : recipientState.state === 'valid' || recipientState.state === 'normalized'
                    ? 'success'
                    : 'neutral'
              }
            />
          </View>
          <View style={[styles.inputShell, recipientState.state === 'invalid' && styles.inputError, recipientState.state === 'valid' || recipientState.state === 'normalized' ? styles.inputValid : null]}>
            <TextInput
              multiline
              accessibilityLabel="Recipient Address"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setRecipient(value); setPasteState('idle'); }}
              placeholder="0x..."
              placeholderTextColor={palette.secondaryText}
              selectTextOnFocus={false}
              style={styles.input}
              value={recipient}
            />
            <View style={styles.inputActions}>
              <Pressable accessibilityLabel="Paste recipient address" accessibilityRole="button" onPress={() => void handlePaste()} style={styles.inputAction}><Ionicons name="clipboard-outline" size={18} color={palette.cyan} /></Pressable>
            </View>
          </View>
          {recipientState.state === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{recipientState.message}</Text> : null}
          {recipientState.state === 'normalized' || recipientState.state === 'valid' ? <Text style={styles.successText}>Valid address format. Verify the recipient before sending.</Text> : null}
          {pasteState === 'pasted' ? <Text style={styles.successText}>Address pasted from clipboard.</Text> : null}
          {pasteState === 'error' ? <Text style={styles.errorText}>Could not read the clipboard.</Text> : null}
          {recipientState.state === 'empty' ? <Text style={styles.helperText}>Enter or paste a public EVM address.</Text> : null}
        </View>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Amount</Text><Text style={styles.amountUnit}>{selectedAsset?.symbol ?? ''}</Text></View>
          <View style={[styles.inputShell, validation.amount.state === 'invalid' && styles.inputError, validation.amount.state === 'valid' && styles.inputValid]}>
            <TextInput accessibilityLabel="Amount" autoCapitalize="none" autoCorrect={false} keyboardType="decimal-pad" onChangeText={setAmount} placeholder="0.00" placeholderTextColor={palette.secondaryText} style={styles.input} value={amount} />
            <Pressable accessibilityLabel="Use maximum available balance" accessibilityRole="button" disabled={!maxAmount} accessibilityState={{ disabled: !maxAmount }} onPress={() => setAmount(maxAmount)} style={({ pressed }) => [styles.maxButton, pressed && styles.pressed]}>
              <Text style={[styles.maxText, !maxAmount && styles.helperText]}>Max</Text>
            </Pressable>
          </View>
          {validation.amount.state === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.amount.message}</Text> : null}
          <Text accessibilityLiveRegion="polite" style={styles.helperText}>
            {portfolioState === 'error' ? 'Balance read failed. Refresh from Home.'
              : portfolioState === 'loading' ? 'Loading balance…'
              : selectedAsset?.availabilityState === 'available' && selectedAsset.formattedBalance != null
                ? `Balance: ${selectedAsset.formattedBalance} ${selectedAsset.symbol ?? ''}`
                : 'Balance unavailable'}
          </Text>
          {selectedAsset?.assetType === 'native' && <Text style={styles.helperText}>Leave funds for the network fee. Max is unavailable before fee estimation.</Text>}
        </View>
        {portfolioState === 'empty' ? <Text style={styles.warningText}>No portfolio assets are available on this network.</Text> : null}
        {!networkAvailable || (selectedAsset && selectedAsset.availabilityState !== 'available') ? <Text accessibilityRole="alert" style={styles.warningText}>{validation.message ?? 'Sending is unavailable until public network data is available.'}</Text> : null}
        {validation.message && networkAvailable && selectedAsset?.availabilityState === 'available' && recipient.length > 0 && validation.recipient.state !== 'invalid' && validation.amount.state !== 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.message}</Text> : null}
        <WaveXButton
          disabled={!account || !validation.canReview}
          icon="arrow-forward-outline"
          label="Review Transaction"
          onPress={handleReview}
        />

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  contextRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyboardContainer: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  heading: { marginTop: 8, gap: 4 },
  eyebrow: { color: palette.cyan, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 27, lineHeight: 34 },
  body: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  cardEyebrow: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.15 },
  networkContext: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  networkIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.surface },
  networkCopy: { flex: 1, gap: 3 },
  networkName: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  networkMeta: { color: palette.secondaryText, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  fromCard: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: palette.divider },
  fromIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: palette.surface },
  assetSelector: { minHeight: 54, padding: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, ...glassSurface },
  assetIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.surface },
  assetInitials: { color: palette.text, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  assetSelectorCopy: { flex: 1, gap: 3 },
  assetSelectorTitle: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  assetSelectorSubtitle: { color: palette.secondaryText, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  balanceCard: { padding: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  balanceValue: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 27, marginTop: 5 },
  balanceSymbol: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 1 },
  balanceNote: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17, marginTop: 7 },
  fieldGroup: { gap: 7 },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: palette.text, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 0.35 },
  stateLabel: { color: palette.secondaryText, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 1 },
  amountUnit: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  inputShell: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  inputValid: { borderColor: 'rgba(101, 230, 166, 0.65)' },
  inputError: { borderColor: theme.colors.destructive },
  input: { flex: 1, minHeight: 48, paddingHorizontal: theme.spacing.md, color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  inputActions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 },
  inputAction: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  maxButton: { minWidth: 52, minHeight: 40, marginRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: palette.surface },
  maxText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11, letterSpacing: 0.6 },
  helperText: { color: palette.secondaryText, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  successText: { color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  warningText: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: palette.cyan, ...theme.shadows.glow },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13, letterSpacing: 0.4 },
  disabledButton: { opacity: 0.4 },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, borderWidth: 1, borderColor: palette.divider, backgroundColor: palette.surface },
  secondaryButtonText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  pressed: { opacity: theme.states.pressedOpacity },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 15, 0.7)' },
  assetSheet: { padding: theme.spacing.lg, paddingBottom: 34, gap: theme.spacing.sm, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#101a34', borderTopWidth: 1, borderColor: palette.divider },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: palette.secondaryText, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 24, marginTop: 3 },
  sheetBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21, paddingVertical: 16 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.surface },
  assetOption: { minHeight: 68, padding: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  assetOptionTitle: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
});