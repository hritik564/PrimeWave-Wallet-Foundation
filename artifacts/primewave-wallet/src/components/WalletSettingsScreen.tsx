import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork } from '@/src/core/networks';
import type { AuthenticationSettings, BiometricAvailability } from '@/src/core/security';
import type { Wallet } from '@/src/core/wallet/models';
import {
  createWalletSettingsSections,
  settingsVersionLabel,
  type WalletSettingsRowModel,
} from './WalletSettingsScreen.logic';
import { shortPublicAddress } from './WalletHomeShell.logic';

const rowIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  account: 'person-outline',
  network: 'globe-outline',
  lock: 'lock-closed-outline',
  pin: 'key-outline',
  biometric: 'finger-print-outline',
  'secure-storage': 'shield-checkmark-outline',
  recovery: 'document-lock-outline',
  'security-controls': 'settings-outline',
  notifications: 'notifications-outline',
  display: 'contrast-outline',
  product: 'wallet-outline',
  environment: 'flask-outline',
  privacy: 'document-text-outline',
  terms: 'reader-outline',
  support: 'help-circle-outline',
};

export function WalletSettingsScreen({
  wallet,
  network,
  previewMode,
  authenticationSettings,
  biometricAvailability,
  onAccountPress,
  onNetworkPress,
  onSecurityPress,
  onLock,
  onComingSoon,
}: {
  wallet: Wallet;
  network: EvmNetwork;
  previewMode: boolean;
  authenticationSettings: AuthenticationSettings;
  biometricAvailability: BiometricAvailability;
  onAccountPress: () => void;
  onNetworkPress: () => void;
  onSecurityPress?: () => void;
  onLock: () => void;
  onComingSoon: (message: string) => void;
}) {
  const account = wallet.accounts[0];
  const sections = createWalletSettingsSections({
    accountAddress: account?.address ?? null,
    accountIndex: account?.index ?? null,
    accountLabel: account ? `Account ${account.index + 1}` : 'Account unavailable',
    biometricAvailability,
    authenticationSettings,
    networkName: network.displayName,
    networkStatus:
      network.configurationStatus === 'configured' && network.chainId !== null
        ? 'Configured'
        : network.enabled
          ? 'Not configured'
          : 'Disabled',
    previewMode,
  });

  const handleRowPress = (row: WalletSettingsRowModel) => {
    if (row.action === 'account') onAccountPress();
    else if (row.action === 'network') onNetworkPress();
    else if (row.action === 'security') onSecurityPress?.();
    else if (row.action === 'lock') onLock();
    else if (row.action === 'coming-soon') {
      onComingSoon('Display preferences are not available yet.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>Control your wallet.</Text>
        <Text style={styles.body}>
          Review public account details, network context, security status, and
          available preferences.
        </Text>
      </View>

      <View accessibilityRole="summary" style={styles.identityCard}>
        <View style={styles.identityIcon}>
          <Ionicons name="settings-outline" size={22} color={theme.colors.accent} />
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.identityTitle}>WaveX Wallet</Text>
          <Text style={styles.identityBody}>
            {account ? shortPublicAddress(account.address) : 'Account unavailable'}
          </Text>
          <Text style={styles.identityVersion}>
            Version {settingsVersionLabel(
              Application.nativeApplicationVersion,
              Platform.OS,
            )}
          </Text>
        </View>
      </View>

      {sections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text style={styles.sectionLabel}>{section.title}</Text>
          <View style={styles.sectionCard}>
            {section.rows.map((row, index) => {
              const actionable =
                row.action === 'account' ||
                row.action === 'network' ||
                row.action === 'security' ||
                row.action === 'lock' ||
                row.action === 'coming-soon';
              const content = (
                <>
                  <View style={styles.rowIcon}>
                    <Ionicons
                      name={rowIcons[row.id] ?? 'information-circle-outline'}
                      size={18}
                      color={actionable ? theme.colors.accent : theme.colors.mutedForeground}
                    />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    <Text style={styles.rowBody}>{row.body}</Text>
                  </View>
                  <View style={styles.rowValue}>
                    <Text style={styles.rowValueText}>{row.value}</Text>
                    {actionable ? (
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={theme.colors.mutedForeground}
                      />
                    ) : null}
                  </View>
                </>
              );

              return actionable ? (
                <Pressable
                  accessibilityLabel={`Settings: ${row.title}`}
                  accessibilityRole="button"
                  key={row.id}
                  onPress={() => handleRowPress(row)}
                  style={({ pressed }) => [
                    styles.row,
                    index < section.rows.length - 1 && styles.rowDivider,
                    pressed && styles.pressed,
                  ]}
                  testID={`settings-${row.id}-row`}
                >
                  {content}
                </Pressable>
              ) : (
                <View
                  accessibilityLabel={`Settings: ${row.title}`}
                  key={row.id}
                  style={[styles.row, index < section.rows.length - 1 && styles.rowDivider]}
                  testID={`settings-${row.id}-row`}
                >
                  {content}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 112,
    gap: theme.spacing.lg,
  },
  intro: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.typography.eyebrow.fontFamily,
    fontSize: theme.typography.eyebrow.fontSize,
    letterSpacing: theme.typography.eyebrow.letterSpacing,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.typography.title.fontFamily,
    fontSize: 30,
    lineHeight: 36,
  },
  body: {
    color: theme.colors.mutedForeground,
    fontFamily: theme.typography.body.fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  identityCard: {
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  identityIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: theme.colors.secondary,
  },
  identityCopy: {
    flex: 1,
    gap: 3,
  },
  identityTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.typography.bodyMedium.fontFamily,
    fontSize: 15,
  },
  identityBody: {
    color: theme.colors.mutedForeground,
    fontFamily: theme.typography.body.fontFamily,
    fontSize: 12,
  },
  identityVersion: {
    color: theme.colors.accent,
    fontFamily: theme.typography.label.fontFamily,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 1.25,
  },
  sectionCard: {
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  row: {
    minHeight: 76,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: theme.colors.secondary,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.typography.bodyMedium.fontFamily,
    fontSize: 14,
  },
  rowBody: {
    color: theme.colors.mutedForeground,
    fontFamily: theme.typography.body.fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  rowValue: {
    maxWidth: '38%',
    alignItems: 'flex-end',
    gap: 3,
  },
  rowValueText: {
    color: theme.colors.accent,
    fontFamily: theme.typography.label.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'right',
  },
  pressed: {
    opacity: theme.states.pressedOpacity,
  },
});