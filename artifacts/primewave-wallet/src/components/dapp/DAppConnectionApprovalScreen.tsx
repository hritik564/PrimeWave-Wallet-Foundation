import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  dappCapabilityLabel,
  type DAppApprovalStatus,
  type DAppApprovalViewModel,
  type DAppSession,
} from '@/src/core/dapp';
import { copyPublicAddress } from '@/src/components/public-address-actions';
import { theme } from '@/src/theme';

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function DAppIcon({
  iconUrl,
  name,
}: {
  iconUrl: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(iconUrl === null);
  const fallback = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <View accessibilityLabel={`${name} icon`} style={styles.dappIcon}>
      {!failed && iconUrl ? (
        <Image
          accessibilityLabel={`${name} icon`}
          cachePolicy="none"
          contentFit="cover"
          onError={() => setFailed(true)}
          source={{ uri: iconUrl }}
          style={styles.dappIconImage}
        />
      ) : (
        <Text style={styles.dappIconFallback}>{fallback}</Text>
      )}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.actionButtonSecondary,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={secondary ? theme.colors.accent : theme.colors.primaryForeground}
          size="small"
        />
      ) : null}
      <Text
        style={[
          styles.actionButtonText,
          secondary && styles.actionButtonTextSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function DAppConnectionApprovalScreen({
  model,
  status,
  error,
  session,
  onConnect,
  onReject,
  onDisconnect,
  onDone,
}: {
  model: DAppApprovalViewModel;
  status: DAppApprovalStatus;
  error: string | null;
  session: DAppSession | null;
  onConnect: () => void;
  onReject: () => void;
  onDisconnect: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const connected = session !== null && status === 'approved';
  const expired = status === 'expired';
  const stale = status === 'stale';
  const busy = status === 'approving' || status === 'rejecting';
  const capabilityRows = useMemo(
    () => model.requestedCapabilities.map((capability) => ({
      capability,
      label: dappCapabilityLabel(capability),
      supported: model.unsupportedCapabilities.includes(capability) === false,
    })),
    [model.requestedCapabilities, model.unsupportedCapabilities],
  );

  const handleCopy = async () => {
    try {
      await copyPublicAddress(model.accountAddress);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, theme.spacing.lg) },
          { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DAPP CONNECTION</Text>
            <Text style={styles.title}>
              {connected ? 'Connected' : 'Review request'}
            </Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>WAVEX</Text>
          </View>
        </View>

        <View style={styles.identityCard}>
          <DAppIcon iconUrl={model.identity.iconUrl} name={model.identity.name} />
          <View style={styles.identityCopy}>
            <Text numberOfLines={2} style={styles.identityName}>
              {model.identity.name}
            </Text>
            <Text numberOfLines={1} style={styles.identityUrl}>
              {model.identity.origin ?? model.identity.url}
            </Text>
            <Text style={styles.neutralTrust}>Public metadata • not verified</Text>
          </View>
        </View>

        {!connected ? (
          <View style={styles.noticeCard}>
            <Ionicons name="link-outline" size={20} color={theme.colors.accent} />
            <Text style={styles.noticeText}>
              This DApp is requesting a connection to your public wallet.
              Connecting does not give it your private key or automatic signing authority.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={19} color={theme.colors.destructive} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {expired || stale ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Ionicons name="time-outline" size={19} color={theme.states.warning} />
            <Text style={styles.errorText}>
              {expired
                ? 'This connection request expired. Ask the DApp to send a new request.'
                : 'This request is no longer current. Review a fresh proposal instead.'}
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.cardEyebrow}>ACCOUNT</Text>
          <View style={styles.accountRow}>
            <View style={styles.accountBadge}>
              <Ionicons name="person-outline" size={19} color={theme.colors.accent} />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>WaveX account</Text>
              <Text style={styles.accountAddress}>{shortAddress(model.accountAddress)}</Text>
            </View>
            <Pressable
              accessibilityLabel="Copy public wallet address"
              accessibilityRole="button"
              onPress={() => void handleCopy()}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={theme.colors.accent} />
              <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            Only this public address is shared with the connected DApp.
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardEyebrow}>REQUESTED NETWORKS</Text>
          {model.requestedNetworks.map((network) => (
            <View key={network.networkId} style={styles.listRow}>
              <View style={styles.networkBadge}>
                <Text style={styles.networkBadgeText}>
                  {network.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.listCopy}>
                <Text style={styles.listTitle}>{network.displayName}</Text>
                <Text style={styles.listMeta}>
                  Chain ID {network.chainId.toString()} •{' '}
                  {network.enabled && network.configurationStatus === 'configured'
                    ? 'Configured'
                    : network.configurationStatus === 'placeholder'
                      ? 'Unavailable'
                      : 'Disabled'}
                </Text>
              </View>
              <Ionicons
                name={network.enabled && network.configurationStatus === 'configured' ? 'checkmark-circle' : 'alert-circle'}
                size={19}
                color={network.enabled && network.configurationStatus === 'configured' ? theme.states.success : theme.states.warning}
              />
            </View>
          ))}
          <Text style={styles.helperText}>
            Connection approval does not change your active WaveX network.
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardEyebrow}>REQUESTED ACCESS</Text>
          {capabilityRows.length === 0 ? (
            <Text style={styles.helperText}>No additional capabilities were requested.</Text>
          ) : (
            capabilityRows.map(({ capability, label, supported }) => (
              <View key={capability} style={styles.capabilityRow}>
                <Ionicons
                  name={supported ? 'checkmark-circle-outline' : 'remove-circle-outline'}
                  size={19}
                  color={supported ? theme.states.success : theme.states.warning}
                />
                <Text style={styles.capabilityText}>{label}</Text>
              </View>
            ))
          )}
        </View>

        {connected ? (
          <View style={styles.connectedCard}>
            <Ionicons name="checkmark-circle" size={22} color={theme.states.success} />
            <View style={styles.connectedCopy}>
              <Text style={styles.connectedTitle}>Connection active</Text>
              <Text style={styles.helperText}>
                {session.approvedNetworkIds.length} network(s) connected to {shortAddress(session.walletAddress)}.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          {connected ? (
            <>
              <ActionButton label="Disconnect" onPress={onDisconnect} secondary />
              <ActionButton label="Back to wallet" onPress={onDone} />
            </>
          ) : (
            <>
              <ActionButton
                disabled={busy || expired || stale}
                label="Connect"
                loading={status === 'approving'}
                onPress={onConnect}
              />
              <ActionButton
                disabled={busy || expired || stale}
                label="Reject"
                loading={status === 'rejecting'}
                onPress={onReject}
                secondary
              />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md },
  orbTop: { position: 'absolute', top: -120, right: -110, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(80, 217, 255, 0.08)' },
  orbBottom: { position: 'absolute', bottom: -160, left: -130, width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(124, 140, 255, 0.08)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { marginTop: 4, color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 29, lineHeight: 35 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: theme.radius.pill, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.18)' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.states.success },
  statusText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.1 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)', ...theme.shadows.panel },
  dappIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 20, backgroundColor: 'rgba(80, 217, 255, 0.12)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.35)' },
  dappIconImage: { width: '100%', height: '100%' },
  dappIconFallback: { color: theme.colors.accent, fontFamily: theme.typography.title.fontFamily, fontSize: 27 },
  identityCopy: { flex: 1, gap: 4 },
  identityName: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 17 },
  identityUrl: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 12 },
  neutralTrust: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.3 },
  noticeCard: { flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.2)' },
  noticeText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 19 },
  errorCard: { flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: 'rgba(255, 91, 122, 0.08)', borderWidth: 1, borderColor: theme.colors.destructive },
  errorText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  sectionCard: { gap: theme.spacing.sm, padding: theme.spacing.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.3 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  accountBadge: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(80, 217, 255, 0.12)' },
  accountCopy: { flex: 1, gap: 2 },
  accountLabel: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  accountAddress: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12, letterSpacing: 0.4 },
  copyButton: { minHeight: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  copyButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
  networkBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(124, 140, 255, 0.16)' },
  networkBadgeText: { color: theme.colors.secondaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  listCopy: { flex: 1, gap: 2 },
  listTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  listMeta: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  capabilityRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 3 },
  capabilityText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  connectedCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: 'rgba(101, 230, 166, 0.08)', borderWidth: 1, borderColor: 'rgba(101, 230, 166, 0.28)' },
  connectedCopy: { flex: 1, gap: 2 },
  connectedTitle: { color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  actions: { gap: theme.spacing.sm, paddingTop: theme.spacing.sm },
  actionButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary },
  actionButtonSecondary: { backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  actionButtonDisabled: { opacity: theme.states.disabledOpacity },
  actionButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  actionButtonTextSecondary: { color: theme.colors.secondaryForeground },
  pressed: { opacity: theme.states.pressedOpacity },
});