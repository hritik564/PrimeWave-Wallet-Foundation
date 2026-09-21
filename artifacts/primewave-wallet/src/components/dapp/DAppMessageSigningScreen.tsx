import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copyPublicAddress } from '@/src/components/public-address-actions';
import type { DAppMessageSigningRequest, DAppTypedDataSigningRequest } from '@/src/core/dapp';
import { theme } from '@/src/theme';
import type { DAppSigningStatus, DAppSigningViewModel } from './DAppMessageSigning.logic';

function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function DAppIcon({ name, iconUrl }: { name: string; iconUrl: string | null }) {
  const [failed, setFailed] = useState(iconUrl === null);
  return (
    <View style={styles.icon}>
      {!failed && iconUrl ? (
        <Image
          source={{ uri: iconUrl }}
          style={styles.iconImage}
          contentFit="cover"
          cachePolicy="none"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.iconText}>{name.slice(0, 1).toUpperCase() || '?'}</Text>
      )}
    </View>
  );
}

export function DAppMessageSigningScreen({
  request,
  model,
  status,
  error,
  onSign,
  onReject,
  onDone,
}: {
  request: DAppMessageSigningRequest | DAppTypedDataSigningRequest;
  model: DAppSigningViewModel;
  status: DAppSigningStatus;
  error: string | null;
  onSign: () => void;
  onReject: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const busy = status === 'signing' || status === 'rejecting';
  const ended = status === 'completed' || status === 'rejected' || status === 'expired' || status === 'stale';
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
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DAPP SIGNING</Text>
            <Text style={styles.title}>{status === 'completed' ? 'Signature sent' : 'Review signature'}</Text>
          </View>
          <Ionicons name="create-outline" size={28} color={theme.colors.accent} />
        </View>
        <View style={styles.identity}>
          <DAppIcon name={model.identity.name} iconUrl={model.identity.iconUrl} />
          <View style={styles.identityCopy}>
            <Text style={styles.name}>{model.identity.name}</Text>
            <Text style={styles.domain}>{model.identity.origin ?? model.identity.url}</Text>
            <Text style={styles.neutral}>Public metadata • not verified</Text>
          </View>
        </View>
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={20} color={theme.states.warning} />
          <Text style={styles.warningText}>
            This signature does not send a blockchain transaction, but signing unknown messages can have security implications.
          </Text>
        </View>
        {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
        <View style={styles.card}>
          <Text style={styles.eyebrow}>ACCOUNT</Text>
          <View style={styles.accountRow}>
            <Text style={styles.address}>{shortAddress(model.accountAddress)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy public wallet address" onPress={() => void handleCopy()}>
              <Text style={styles.copy}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
          </View>
          <Text style={styles.meta}>{model.networkId} • Chain ID {model.chainId.toString()}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{model.kind === 'personal' ? 'MESSAGE' : 'TYPED DATA'}</Text>
          <Text style={styles.method}>{model.method}</Text>
          {model.kind === 'personal' ? (
            <>
              <Text selectable style={styles.payload}>{model.message}</Text>
              {model.displayWasNormalized || model.displayWasTruncated ? (
                <Text style={styles.warningSmall}>
                  Display text was bounded or normalized for safety. The original bytes remain unchanged for signing.
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {(model.typedData?.domain ?? []).map((field) => (
                <View key={`domain-${field.label}`} style={styles.field}>
                  <Text style={styles.fieldLabel}>Domain · {field.label}</Text>
                  <Text selectable style={styles.fieldValue}>{field.value}</Text>
                </View>
              ))}
              {(model.typedData?.fields ?? []).map((field) => (
                <View key={`message-${field.label}`} style={styles.field}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text selectable style={styles.fieldValue}>{field.value}</Text>
                </View>
              ))}
              {(model.typedData?.warnings ?? []).map((warning) => (
                <Text key={warning} style={styles.warningSmall}>{warning}</Text>
              ))}
            </>
          )}
        </View>
        {ended ? (
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primary}>
            <Text style={styles.primaryText}>Return to wallet</Text>
          </Pressable>
        ) : (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onReject} style={[styles.secondary, busy && styles.disabled]}>
              {status === 'rejecting' ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Reject</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onSign} style={[styles.primary, busy && styles.disabled]}>
              {status === 'signing' ? <ActivityIndicator color={theme.colors.primaryForeground} /> : <Text style={styles.primaryText}>Sign</Text>}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background, position: 'relative' },
  orbTop: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: theme.colors.accent, opacity: 0.18, top: -150, right: -100 },
  content: { paddingHorizontal: 20, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', marginTop: 5 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  icon: { width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconImage: { width: '100%', height: '100%' },
  iconText: { color: theme.colors.primaryForeground, fontSize: 21, fontWeight: '700' },
  identityCopy: { flex: 1, gap: 3 },
  name: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  domain: { color: theme.colors.muted, fontSize: 13 },
  neutral: { color: theme.colors.muted, fontSize: 11 },
  warning: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: theme.colors.muted, borderWidth: 1, borderColor: theme.states.warning },
  warningText: { flex: 1, color: theme.colors.text, fontSize: 13, lineHeight: 19 },
  error: { padding: 13, borderRadius: 14, backgroundColor: theme.colors.muted, borderWidth: 1, borderColor: theme.colors.destructive },
  errorText: { color: theme.colors.destructive, lineHeight: 19 },
  card: { padding: 16, borderRadius: 18, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, gap: 10 },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  address: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
  copy: { color: theme.colors.accent, fontWeight: '700' },
  meta: { color: theme.colors.muted, fontSize: 13 },
  method: { color: theme.colors.accent, fontWeight: '700' },
  payload: { color: theme.colors.text, fontSize: 15, lineHeight: 22, maxHeight: 260 },
  field: { gap: 3 },
  fieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
  fieldValue: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  warningSmall: { color: theme.states.warning, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 12 },
  primary: { flex: 1, minHeight: 52, borderRadius: 15, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: theme.colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  secondary: { flex: 1, minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});