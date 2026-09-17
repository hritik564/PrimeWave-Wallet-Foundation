import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
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

type PortfolioState = 'loading' | 'available' | 'empty' | 'unavailable' | 'error';

function AssetIcon({ asset }: { asset: PortfolioAssetViewModel }) {
  return (
    <View style={styles.assetIcon}>
      <Text style={styles.assetInitials}>
        {(asset.symbol ?? asset.name ?? (asset.assetType === 'native' ? 'N' : 'T'))
          .slice(0, 3)
          .toUpperCase()}
      </Text>
    </View>
  );
}

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
  return (
    <>
      <Pressable
        accessibilityLabel="Select asset"
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.assetSelector, pressed && styles.pressed]}
      >
        {asset ? <AssetIcon asset={asset} /> : <View style={styles.assetIcon}><Ionicons name="layers-outline" size={20} color={theme.colors.mutedForeground} /></View>}
        <View style={styles.assetSelectorCopy}>
          <Text style={styles.cardEyebrow}>ASSET</Text>
          <Text style={styles.assetSelectorTitle}>{asset?.symbol ?? 'Select asset'}</Text>
          <Text style={styles.assetSelectorSubtitle}>{asset?.name ?? 'Choose from this network portfolio'}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={theme.colors.accent} />
      </Pressable>
      <Modal animationType="slide" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close asset selector" accessibilityRole="button" onPress={() => setVisible(false)} style={styles.modalBackdrop} />
          <View accessibilityViewIsModal style={styles.assetSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.cardEyebrow}>SEND ASSET</Text>
                <Text style={styles.sheetTitle}>Select asset</Text>
              </View>
              <Pressable accessibilityLabel="Close asset selector" accessibilityRole="button" onPress={() => setVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={theme.colors.foreground} />
              </Pressable>
            </View>
            {assets.length === 0 ? (
              <Text style={styles.sheetBody}>No native or ERC-20 assets are available for this network.</Text>
            ) : (
              assets.map((item) => (
                <Pressable
                  accessibilityLabel={`Select ${item.symbol ?? item.name ?? 'asset'}`}
                  accessibilityRole="button"
                  key={assetIdentityKey(item.identity)}
                  onPress={() => { onSelect(item); setVisible(false); }}
                  style={({ pressed }) => [styles.assetOption, pressed && styles.pressed]}
                >
                  <AssetIcon asset={item} />
                  <View style={styles.assetSelectorCopy}>
                    <Text style={styles.assetOptionTitle}>{item.name ?? item.symbol ?? 'Asset'}</Text>
                    <Text style={styles.assetSelectorSubtitle}>{item.symbol ?? 'Unknown symbol'} • {item.formattedBalance ?? 'Balance unavailable'}</Text>
                  </View>
                  {assetIdentityKey(item.identity) === assetIdentityKey(asset?.identity ?? { networkId: '', assetType: 'native', assetId: 'native' }) ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} />
                  ) : null}
                </Pressable>
              ))
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

export function WalletSendScreen({
  wallet,
  network,
  portfolio,
  portfolioState,
  initialAsset,
  onBack,
  onNetworkPress,
  onComingSoon,
  onReviewDraft,
}: {
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly portfolio: PortfolioReadModel | null;
  readonly portfolioState: PortfolioState;
  readonly initialAsset?: PortfolioAssetViewModel | null;
  readonly onBack: () => void;
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
    () => initialAsset && sendableAssets.some((item) => assetIdentityKey(item.identity) === assetIdentityKey(initialAsset.identity))
      ? initialAsset
      : selectDefaultSendAsset(sendableAssets, network),
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
          <Text style={styles.eyebrow}>SEND</Text>
          <Text style={styles.title}>Send assets</Text>
          <Text style={styles.body}>Prepare a public recipient and amount for the selected network. Review is read-only and stops before signing.</Text>
        </View>
        <Pressable accessibilityLabel={`Selected network ${network.displayName}`} accessibilityRole="button" onPress={onNetworkPress} style={({ pressed }) => [styles.networkContext, pressed && styles.pressed]}>
          <View style={styles.networkIcon}><Ionicons name="globe-outline" size={20} color={networkAvailable ? theme.colors.accent : theme.states.warning} /></View>
          <View style={styles.networkCopy}>
            <Text style={styles.cardEyebrow}>SELECTED NETWORK</Text>
            <Text style={styles.networkName}>{network.displayName}</Text>
            <Text style={styles.networkMeta}>{network.nativeCurrency.symbol} • {networkAvailable ? 'Configured' : 'Unavailable'}</Text>
          </View>
          <Ionicons name={networkAvailable ? 'checkmark-circle-outline' : 'warning-outline'} size={20} color={networkAvailable ? theme.states.success : theme.states.warning} />
        </Pressable>
        <AssetPicker asset={selectedAsset} assets={sendableAssets} onSelect={(next) => { setSelectedAssetKey(assetIdentityKey(next.identity)); setRecipient(''); setAmount(''); }} />
        <View style={styles.balanceCard}>
          <View>
            <Text style={styles.cardEyebrow}>AVAILABLE BALANCE</Text>
            <Text style={styles.balanceValue}>{selectedAsset?.formattedBalance ?? 'Unavailable'}</Text>
          </View>
          <Text style={styles.balanceSymbol}>{selectedAsset?.symbol ?? '—'}</Text>
          {selectedAsset?.assetType === 'native' ? <Text style={styles.balanceNote}>Current balance. Maximum spendable after gas may be lower.</Text> : null}
        </View>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Recipient Address</Text><Text style={styles.stateLabel}>{recipientState.state.toUpperCase()}</Text></View>
          <View style={[styles.inputShell, recipientState.state === 'invalid' && styles.inputError, recipientState.state === 'valid' || recipientState.state === 'normalized' ? styles.inputValid : null]}>
            <TextInput
              accessibilityLabel="Recipient Address"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setRecipient(value); setPasteState('idle'); }}
              placeholder="0x..."
              placeholderTextColor={theme.colors.mutedForeground}
              selectTextOnFocus={false}
              style={styles.input}
              value={recipient}
            />
            <View style={styles.inputActions}>
              <Pressable accessibilityLabel="Paste recipient address" accessibilityRole="button" onPress={() => void handlePaste()} style={styles.inputAction}><Ionicons name="clipboard-outline" size={18} color={theme.colors.accent} /></Pressable>
              <Pressable accessibilityLabel="Scan recipient address, coming soon" accessibilityRole="button" onPress={() => onComingSoon('QR scanning is coming soon.')} style={styles.inputAction}><Ionicons name="scan-outline" size={18} color={theme.colors.mutedForeground} /></Pressable>
            </View>
          </View>
          {recipientState.state === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{recipientState.message}</Text> : null}
          {recipientState.state === 'normalized' ? <Text style={styles.successText}>Address normalized locally. Syntax only; destination safety is not verified.</Text> : null}
          {pasteState === 'pasted' ? <Text style={styles.successText}>Address pasted from clipboard.</Text> : null}
          {pasteState === 'error' ? <Text style={styles.errorText}>Could not read the clipboard.</Text> : null}
          {recipientState.state === 'empty' ? <Text style={styles.helperText}>Use a public EVM address. No address lookup is performed.</Text> : null}
        </View>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Amount</Text><Text style={styles.amountUnit}>{selectedAsset?.symbol ?? ''}</Text></View>
          <View style={[styles.inputShell, validation.amount.state === 'invalid' && styles.inputError, validation.amount.state === 'valid' && styles.inputValid]}>
            <TextInput accessibilityLabel="Amount" autoCapitalize="none" autoCorrect={false} keyboardType="decimal-pad" onChangeText={setAmount} placeholder="0.00" placeholderTextColor={theme.colors.mutedForeground} style={styles.input} value={amount} />
            <Pressable accessibilityLabel="Use maximum available balance" accessibilityRole="button" disabled={!selectedAsset || selectedAsset.rawBalance === null} onPress={() => setAmount(formatMaxAmount(selectedAsset))} style={({ pressed }) => [styles.maxButton, pressed && styles.pressed]}>
              <Text style={styles.maxText}>MAX</Text>
            </Pressable>
          </View>
          {validation.amount.state === 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.amount.message}</Text> : null}
          {validation.amount.state === 'empty' ? <Text style={styles.helperText}>Up to {selectedAsset?.decimals ?? 0} decimal places. Exact balance math is used.</Text> : null}
        </View>
        {portfolioState === 'loading' ? <Text style={styles.helperText}>Loading public assets…</Text> : null}
        {portfolioState === 'empty' ? <Text style={styles.warningText}>No portfolio assets are available on this network.</Text> : null}
        {!networkAvailable || (selectedAsset && selectedAsset.availabilityState !== 'available') ? <Text accessibilityRole="alert" style={styles.warningText}>{validation.message ?? 'Sending is unavailable until public network data is available.'}</Text> : null}
        {validation.message && networkAvailable && selectedAsset?.availabilityState === 'available' && recipient.length > 0 && validation.recipient.state !== 'invalid' && validation.amount.state !== 'invalid' ? <Text accessibilityRole="alert" style={styles.errorText}>{validation.message}</Text> : null}
        <Pressable accessibilityLabel="Review Transaction" accessibilityRole="button" disabled={!validation.canReview} onPress={handleReview} style={({ pressed }) => [styles.primaryButton, !validation.canReview && styles.disabledButton, pressed && validation.canReview && styles.pressed]}>
          <Text style={styles.primaryButtonText}>Review Transaction</Text>
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
  assetSelector: { minHeight: 76, padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.28)' },
  assetIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(124, 140, 255, 0.2)' },
  assetInitials: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  assetSelectorCopy: { flex: 1, gap: 3 },
  assetSelectorTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  assetSelectorSubtitle: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  balanceCard: { padding: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.88)', borderWidth: 1, borderColor: theme.colors.border },
  balanceValue: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 27, marginTop: 5 },
  balanceSymbol: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 1 },
  balanceNote: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17, marginTop: 7 },
  fieldGroup: { gap: 7 },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: theme.colors.foreground, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 0.35 },
  stateLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 9, letterSpacing: 1 },
  amountUnit: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  inputShell: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  inputValid: { borderColor: 'rgba(101, 230, 166, 0.65)' },
  inputError: { borderColor: theme.colors.destructive },
  input: { flex: 1, minHeight: 56, paddingHorizontal: theme.spacing.md, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  inputActions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 },
  inputAction: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  maxButton: { minWidth: 52, minHeight: 40, marginRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  maxText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11, letterSpacing: 0.6 },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  successText: { color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  warningText: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent, ...theme.shadows.glow },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13, letterSpacing: 0.4 },
  disabledButton: { opacity: 0.4 },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: 'rgba(18, 29, 56, 0.65)' },
  secondaryButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  pressed: { opacity: theme.states.pressedOpacity },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3, 6, 15, 0.7)' },
  assetSheet: { padding: theme.spacing.lg, paddingBottom: 34, gap: theme.spacing.sm, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#101a34', borderTopWidth: 1, borderColor: theme.colors.border },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.mutedForeground, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 24, marginTop: 3 },
  sheetBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21, paddingVertical: 16 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: theme.colors.secondary },
  assetOption: { minHeight: 68, padding: 10, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(18, 29, 56, 0.8)', borderWidth: 1, borderColor: theme.colors.border },
  assetOptionTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
});