import { GlassLayer } from '@/src/design-system/components/GlassLayer';
import { glassSurface } from '@/src/design-system/tokens/wallet-home';
import { walletHomeColors as palette } from '@/src/design-system/tokens/wallet-home';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';
import { shortPublicAddress } from './WalletHomeShell.logic';
import {
  createReceiveQrPayload,
  RECEIVE_QR_ERROR_CORRECTION,
  RECEIVE_QR_QUIET_ZONE,
  RECEIVE_QR_SIZE,
  receiveNetworkStatus,
} from './receive.logic';
import {
  copyPublicAddress,
  createPublicAddressShareMessage,
  sharePublicAddress,
  type ShareResult,
} from './public-address-actions';

type ActionState = 'idle' | 'copied' | 'shared' | 'cancelled' | 'unavailable';

export function ReceiveScreen({
  wallet,
  network,
  onBack,
  onNetworkPress,
}: {
  wallet: Wallet;
  network: EvmNetwork;
  onBack: () => void;
  onNetworkPress: () => void;
}) {
  const account = wallet.accounts[0];
  const address = account?.address.trim() ?? '';
  const qrPayload = createReceiveQrPayload(address);
  const shortAddress = shortPublicAddress(address);
  const [copyState, setCopyState] = useState<ActionState>('idle');
  const [shareState, setShareState] = useState<ActionState>('idle');
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    setCopyState('idle');
    setShareState('idle');
    setQrFailed(false);
  }, [address, network.id]);

  const { configured, label: networkStatus } = receiveNetworkStatus(network);
  const shareMessage = useMemo(
    () => createPublicAddressShareMessage(network, address),
    [address, network],
  );

  const handleCopy = async () => {
    if (!address) {
      setCopyState('unavailable');
      return;
    }
    try {
      await copyPublicAddress(address);
      setCopyState('copied');
    } catch {
      setCopyState('unavailable');
    }
  };

  const handleShare = async () => {
    if (!address) {
      setShareState('unavailable');
      return;
    }
    const result: ShareResult = await sharePublicAddress(shareMessage);
    setShareState(result);
  };

  return (
    <ScrollView
      accessibilityLabel="Receive screen"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Receive</Text>
      </View>

      <Pressable
        accessibilityLabel={`Network ${network.displayName}, ${networkStatus}`}
        accessibilityRole="button"
        onPress={onNetworkPress}
        style={({ pressed }) => [styles.networkContext, pressed && styles.pressed]}
      >
        <View style={styles.networkIcon}>
          <Ionicons
            name="globe-outline"
            size={20}
            color={configured ? palette.cyan : theme.states.warning}
          />
        </View>
        <View style={styles.networkCopy}>
          <Text style={styles.cardEyebrow}>SELECTED NETWORK</Text>
          <Text style={styles.networkName}>{network.displayName}</Text>
          {!configured && <Text style={styles.warningTitle}>Unavailable · Choose another network</Text>}
        </View>
        <Ionicons
          name="chevron-down"
          size={20}
          color={palette.secondaryText}
        />
      </Pressable>

      <Text accessibilityRole="alert" style={styles.warningBody}>
        {configured ? `Only send assets on ${network.displayName} to this address.` : 'Choose a configured network before receiving funds.'}
      </Text>
      <View style={styles.receiveCard}>
      <GlassLayer />
        <View
          accessible
          accessibilityLabel={configured && qrPayload && !qrFailed ? `QR code for wallet address ${shortAddress}` : 'QR unavailable'}
          style={styles.qrFrame}
        >
          {configured && qrPayload && !qrFailed ? (
            <QRCode
              backgroundColor="#ffffff"
              color="#07111f"
              ecl={RECEIVE_QR_ERROR_CORRECTION}
              onError={() => setQrFailed(true)}
              quietZone={RECEIVE_QR_QUIET_ZONE}
              size={RECEIVE_QR_SIZE}
              value={qrPayload}
            />
          ) : (
            <View style={styles.qrFallback}>
              <Ionicons
                name="qr-code-outline"
                size={46}
                color={palette.secondaryText}
              />
              <Text style={styles.qrFallbackText}>
                {!configured ? 'Network unavailable' : address ? 'QR unavailable' : 'Public address unavailable'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.accountHeading}>
          <View>
            <Text style={styles.cardEyebrow}>PUBLIC ACCOUNT</Text>
            <Text style={styles.accountName}>
              {account ? `Account ${account.index + 1}` : 'Account unavailable'}
            </Text>
          </View>
          <Ionicons name="person-circle-outline" size={28} color={palette.cyan} />
        </View>
        <Text
          accessibilityLabel="Full public address"
          selectable
          style={styles.fullAddress}
        >
          {address || 'Unavailable'}
        </Text>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Copy address"
            accessibilityRole="button"
            disabled={!address}
            onPress={() => void handleCopy()}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            <Ionicons
              name={copyState === 'copied' ? 'checkmark' : 'copy-outline'}
              size={18}
              color={copyState === 'copied' ? theme.states.success : palette.cyan}
            />
            <Text style={styles.actionText}>
              {copyState === 'copied' ? 'Copied' : 'Copy Address'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Share address"
            accessibilityRole="button"
            disabled={!address || !configured}
            onPress={() => void handleShare()}
            style={({ pressed }) => [styles.actionButton, styles.shareButton, pressed && styles.pressed]}
          >
            <Ionicons name="share-outline" size={18} color={palette.text} />
            <Text style={styles.shareText}>Share Address</Text>
          </Pressable>
        </View>
        {copyState === 'unavailable' ? (
          <Text style={styles.actionNotice}>Could not copy the public address. Try again.</Text>
        ) : null}
        {shareState === 'shared' ? (
          <Text style={styles.actionNoticeSuccess}>Public address ready to share.</Text>
        ) : null}
        {shareState === 'cancelled' ? (
          <Text style={styles.actionNotice}>Sharing was cancelled.</Text>
        ) : null}
        {shareState === 'unavailable' ? (
          <Text style={styles.actionNotice}>
            Sharing is unavailable in this preview. Use Copy Address instead.
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel="Back to Home"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back-outline" size={17} color={palette.cyan} />
        <Text style={styles.backText}>Back to Home</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 120,
    gap: theme.spacing.md,
  },
  heading: { marginTop: 8, gap: 4 },
  eyebrow: { color: palette.cyan, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 27, lineHeight: 34 },
  body: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  networkContext: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  networkIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.surface },
  networkCopy: { flex: 1, gap: 3 },
  cardEyebrow: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.05 },
  networkName: { color: palette.text, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  networkMeta: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  receiveCard: { padding: 12, gap: 8, borderRadius: 16, ...glassSurface },
  qrFrame: { alignSelf: 'center', padding: 8, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: palette.divider },
  qrFallback: { width: 224, height: 224, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: '#f5f8ff' },
  qrFallbackText: { color: '#40506e', fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  accountHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountName: { color: palette.text, fontFamily: theme.typography.title.fontFamily, fontSize: 21, marginTop: 4 },
  shortAddress: { color: palette.cyan, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 22, letterSpacing: 0.4 },
  fullAddress: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  actionButton: { flex: 1, minHeight: 48, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: theme.radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  shareButton: { backgroundColor: palette.surface, borderColor: palette.divider },
  actionText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  shareText: { color: palette.text, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  actionNotice: { color: theme.states.warning, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  actionNoticeSuccess: { color: theme.states.success, fontFamily: theme.typography.body.fontFamily, fontSize: 11, lineHeight: 16 },
  warningCard: { padding: theme.spacing.md, flexDirection: 'row', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.3)' },
  warningIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(244, 200, 107, 0.12)' },
  warningCopy: { flex: 1, gap: 4 },
  warningTitle: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  warningBody: { color: palette.secondaryText, fontFamily: theme.typography.body.fontFamily, fontSize: 12, lineHeight: 18 },
  warningStatus: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.3 },
  backButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  backText: { color: palette.cyan, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  pressed: { opacity: 0.76 },
});