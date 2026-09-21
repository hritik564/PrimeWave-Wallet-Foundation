import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DAppSession } from '@/src/core/dapp';
import type { NetworkRegistry } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';
import { copyPublicAddress } from '@/src/components/public-address-actions';
import { theme } from '@/src/theme';

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function DAppIcon({
  iconUrl,
  name,
  size = 48,
}: {
  iconUrl: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(iconUrl === null);
  const fallback = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <View style={[styles.dappIcon, { width: size, height: size, borderRadius: size * 0.28 }]}>
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
        <Text style={[styles.dappIconFallback, { fontSize: size * 0.42 }]}>{fallback}</Text>
      )}
    </View>
  );
}

function statusLabel(session: DAppSession, now: number): string {
  if (session.status === 'active' && session.expiresAt !== null && session.expiresAt <= now) {
    return 'Expired';
  }
  return session.status === 'active'
    ? 'Connected'
    : session.status.charAt(0).toUpperCase() + session.status.slice(1);
}

export function DAppSessionsScreen({
  sessions,
  networkRegistry,
  wallet,
  available,
  onBack,
  onDisconnect,
}: {
  sessions: readonly DAppSession[];
  networkRegistry: NetworkRegistry;
  wallet: Wallet;
  available: boolean;
  onBack: () => void;
  onDisconnect: (sessionId: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DAppSession | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = wallet.accounts[0];
  const now = Date.now();
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (!needle) return true;
      return (
        session.identity.name.toLowerCase().includes(needle) ||
        (session.identity.origin ?? session.identity.url).toLowerCase().includes(needle)
      );
    });
  }, [query, sessions]);

  const confirmDisconnect = (session: DAppSession) => {
    Alert.alert(
      'Disconnect DApp?',
      `This removes the ${session.identity.name} session and invalidates its pending requests. It does not expose or delete wallet keys.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDisconnecting(true);
              setError(null);
              try {
                await onDisconnect(session.sessionId);
                setSelected(null);
              } catch (disconnectError) {
                setError(
                  disconnectError instanceof Error
                    ? disconnectError.message
                    : 'The DApp could not be disconnected.',
                );
              } finally {
                setDisconnecting(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, theme.spacing.lg), paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DAPP MANAGEMENT</Text>
            <Text style={styles.title}>Connected DApps</Text>
          </View>
          <Pressable
            accessibilityLabel="Back to Home"
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={20} color={theme.colors.accent} />
          <Text style={styles.noticeText}>
            DApps are external applications. A connection shares approved public wallet information only.
            Signatures and transactions remain explicit, request-by-request approvals.
          </Text>
        </View>

        {!available ? (
          <View style={styles.stateCard}>
            <Ionicons name="phone-portrait-outline" size={30} color={theme.colors.accent} />
            <Text style={styles.stateTitle}>DApp connections unavailable</Text>
            <Text style={styles.helperText}>
              Native provider transport is unavailable in Preview or before the wallet is ready. No sessions are being simulated.
            </Text>
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="link-outline" size={30} color={theme.colors.accent} />
            <Text style={styles.stateTitle}>No connected DApps</Text>
            <Text style={styles.helperText}>
              When a real provider connection is approved, it will appear here. DApp metadata is public and not verified by WAVEX.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={theme.colors.mutedForeground} />
              <TextInput
                accessibilityLabel="Search connected DApps"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Search name or domain"
                placeholderTextColor={theme.colors.mutedForeground}
                style={styles.searchInput}
                value={query}
              />
            </View>
            {filtered.length === 0 ? (
              <Text style={styles.helperText}>No connected DApps match this search.</Text>
            ) : (
              filtered.map((session) => (
                <Pressable
                  accessibilityLabel={`Open ${session.identity.name} session details`}
                  accessibilityRole="button"
                  key={session.sessionId}
                  onPress={() => setSelected(session)}
                  style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}
                >
                  <DAppIcon iconUrl={session.identity.iconUrl} name={session.identity.name} />
                  <View style={styles.sessionCopy}>
                    <Text numberOfLines={1} style={styles.sessionName}>{session.identity.name}</Text>
                    <Text numberOfLines={1} style={styles.sessionDomain}>
                      {session.identity.origin ?? session.identity.url}
                    </Text>
                    <Text style={styles.sessionMeta}>
                      {session.approvedNetworkIds.length} network(s) • {statusLabel(session, now)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </>
        )}

        {error ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.colors.destructive} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {selected ? (
        <View style={styles.detailOverlay}>
          <Pressable
            accessibilityLabel="Close DApp session details"
            accessibilityRole="button"
            onPress={() => setSelected(null)}
            style={styles.detailBackdrop}
          />
          <View style={styles.detailSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.detailHeader}>
              <DAppIcon iconUrl={selected.identity.iconUrl} name={selected.identity.name} size={60} />
              <View style={styles.detailIdentity}>
                <Text style={styles.detailTitle}>{selected.identity.name}</Text>
                <Text numberOfLines={2} style={styles.sessionDomain}>
                  {selected.identity.origin ?? selected.identity.url}
                </Text>
                <Text style={styles.neutralText}>Public metadata • not verified</Text>
              </View>
            </View>
            <Text style={styles.cardEyebrow}>ACCOUNT</Text>
            <Text style={styles.detailValue}>
              {account ? `Account ${account.index + 1} • ${shortAddress(selected.walletAddress)}` : shortAddress(selected.walletAddress)}
            </Text>
            <Text style={styles.cardEyebrow}>CONNECTED NETWORKS</Text>
            <View style={styles.networkList}>
              {selected.approvedNetworkIds.map((networkId, index) => {
                const network = networkRegistry.getById(networkId);
                return (
                  <View key={`${networkId}-${selected.approvedChainIds[index]?.toString()}`} style={styles.networkRow}>
                    <Ionicons name="globe-outline" size={17} color={theme.colors.accent} />
                    <Text style={styles.detailValue}>
                      {network?.displayName ?? networkId} • Chain {selected.approvedChainIds[index]?.toString() ?? 'unavailable'}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.cardEyebrow}>PERMISSIONS</Text>
            <Text style={styles.helperText}>
              {selected.approvedCapabilities.map((capability) =>
                capability === 'transaction-signing' || capability === 'message-signing'
                  ? `${capability === 'transaction-signing' ? 'Transaction signing' : 'Message signing'} remains explicit per request.`
                  : capability === 'account-access'
                    ? 'Public account access.'
                    : 'Approved network information access.',
              ).join(' ')}
            </Text>
            {selected.expiresAt !== null ? (
              <Text style={styles.helperText}>
                Session expiry: {new Date(selected.expiresAt).toLocaleString()}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: disconnecting }}
              disabled={disconnecting}
              onPress={() => confirmDisconnect(selected)}
              style={({ pressed }) => [styles.disconnectButton, pressed && !disconnecting && styles.pressed]}
            >
              {disconnecting ? <ActivityIndicator color={theme.colors.destructive} size="small" /> : <Ionicons name="unlink-outline" size={18} color={theme.colors.destructive} />}
              <Text style={styles.disconnectText}>Disconnect DApp</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(null)}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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
  backButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  backText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  notice: { flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.2)' },
  noticeText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  stateCard: { alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.xl, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  stateTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 17, textAlign: 'center' },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  searchInput: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.body.fontFamily, fontSize: 14 },
  sessionCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  dappIcon: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: 'rgba(80, 217, 255, 0.12)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.35)' },
  dappIconImage: { width: '100%', height: '100%' },
  dappIconFallback: { color: theme.colors.accent, fontFamily: theme.typography.title.fontFamily },
  sessionCopy: { flex: 1, gap: 3 },
  sessionName: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  sessionDomain: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 11 },
  sessionMeta: { color: theme.states.success, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 0.3 },
  errorCard: { flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: 'rgba(255, 91, 122, 0.08)', borderWidth: 1, borderColor: theme.colors.destructive },
  errorText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  detailOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  detailBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  detailSheet: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: 28, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: theme.colors.border },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  detailIdentity: { flex: 1, gap: 4 },
  detailTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 18 },
  neutralText: { color: theme.states.warning, fontFamily: theme.typography.label.fontFamily, fontSize: 10 },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.3 },
  detailValue: { color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, lineHeight: 19 },
  networkList: { gap: theme.spacing.xs },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  disconnectButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(255, 91, 122, 0.1)', borderWidth: 1, borderColor: theme.colors.destructive },
  disconnectText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  closeButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.secondary },
  closeText: { color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  pressed: { opacity: theme.states.pressedOpacity },
});