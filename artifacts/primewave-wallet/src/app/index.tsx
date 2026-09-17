import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import {
  AuthenticationError,
  getWalletAccessManager,
  screenPrivacyController,
  sanitizeError,
  type AuthenticationSettings,
  type AutoLockPolicy,
  type BiometricAvailability,
  type WalletAccessManager,
} from '@/src/core/security';
import type { WalletSetupResult } from '@/src/core/wallet/contracts';
import type { Wallet } from '@/src/core/wallet/models';

const iconSource = require('../../assets/images/icon.png');
const confirmationPositions = [4, 9, 12];

type ViewName =
  | 'loading'
  | 'unavailable'
  | 'welcome'
  | 'warning'
  | 'phrase'
  | 'phrase-confirm'
  | 'import'
  | 'import-confirm'
  | 'pin'
  | 'biometric'
  | 'locked'
  | 'wallet'
  | 'security'
  | 'recovery';

function safeMessage(error: unknown): string {
  if (error instanceof AuthenticationError && error.code === 'INVALID_PIN') {
    return error.message;
  }
  return sanitizeError(error).message;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function AppButton({
  label,
  onPress,
  secondary = false,
  danger = false,
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        danger && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={secondary ? theme.colors.accent : theme.colors.primaryForeground} /> : null}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary, danger && styles.buttonTextDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        secureTextEntry={secureTextEntry}
        spellCheck={false}
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
      />
    </View>
  );
}

function Header({ onBack }: { onBack?: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandLockup}>
        <View style={styles.brandMark}>
          <Image source={iconSource} style={styles.brandIcon} />
        </View>
        <View>
          <Text style={styles.brandName}>PRIMEWAVE</Text>
          <Text style={styles.brandProduct}>WALLET</Text>
        </View>
      </View>
      {onBack ? (
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={onBack} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.foreground} />
        </Pressable>
      ) : (
        <View style={styles.statusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>OFFLINE</Text>
        </View>
      )}
    </View>
  );
}

function Screen({
  children,
  onBack,
  sensitive = true,
}: {
  children: React.ReactNode;
  onBack?: () => void;
  sensitive?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <LinearGradient colors={theme.gradients.background} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + theme.spacing.lg,
              paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : theme.spacing.lg),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <Header onBack={onBack} />
          {sensitive ? <View style={styles.sensitiveMarker} /> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function SectionTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <Screen sensitive={false}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>LOCAL • NON-CUSTODIAL • OFFLINE</Text>
        <Text style={styles.heroTitle}>
          Your keys stay{'\n'}
          <Text style={styles.heroAccent}>with you.</Text>
        </Text>
        <Text style={styles.body}>
          PrimeWave Wallet gives you a private, device-local foundation for managing your own recovery material.
        </Text>
      </View>
      <View style={styles.panel}>
        <View style={styles.panelIcon}>
          <Ionicons name="shield-checkmark-outline" size={24} color={theme.colors.accent} />
        </View>
        <Text style={styles.panelTitle}>Start with a secure local vault</Text>
        <Text style={styles.panelBody}>
          There is no account to create and no recovery service. Your recovery phrase is the only way to restore access.
        </Text>
        <AppButton icon="add" label="Create new wallet" onPress={onCreate} />
        <AppButton icon="download-outline" label="Import existing wallet" onPress={onImport} secondary />
      </View>
      <Text style={styles.footerNote}>PrimeWave cannot recover a lost recovery phrase.</Text>
    </Screen>
  );
}

function Warning({ onContinue }: { onContinue: () => void }) {
  return (
    <Screen>
      <SectionTitle
        eyebrow="BEFORE YOU CONTINUE"
        title="Protect your recovery phrase."
        body="Your phrase is the master backup for this wallet. Anyone who sees it can control the wallet."
      />
      <View style={styles.warningPanel}>
        <Ionicons name="warning-outline" size={25} color={theme.states.warning} />
        <Text style={styles.warningTitle}>Write it down offline</Text>
        <Text style={styles.warningBody}>
          Never screenshot it, send it to anyone, or store it in cloud notes. PrimeWave cannot recover it if it is lost.
        </Text>
      </View>
      <AppButton label="I understand — show my phrase" onPress={onContinue} icon="arrow-forward" />
    </Screen>
  );
}

function PhraseDisplay({ draft, onContinue }: { draft: WalletSetupResult; onContinue: () => void }) {
  const words = draft.recoveryPhrase.split(' ');
  return (
    <Screen>
      <SectionTitle
        eyebrow="PRIVATE BACKUP"
        title="Your recovery phrase"
        body="Write these 12 words down in order. This screen is protected where the platform supports screen privacy."
      />
      <View style={styles.warningPanel}>
        <Ionicons name="lock-closed-outline" size={22} color={theme.colors.accent} />
        <Text style={styles.warningBody}>Do not copy or share this phrase. Anyone with it can control your wallet.</Text>
      </View>
      <View style={styles.wordGrid}>
        {words.map((word, index) => (
          <View key={`${index}-${word}`} style={styles.wordCell}>
            <Text style={styles.wordIndex}>{index + 1}</Text>
            <Text style={styles.wordText}>{word}</Text>
          </View>
        ))}
      </View>
      <AppButton label="I wrote it down" onPress={onContinue} icon="checkmark" />
    </Screen>
  );
}

function PhraseConfirm({
  draft,
  values,
  onChange,
  onConfirm,
}: {
  draft: WalletSetupResult;
  values: string[];
  onChange: (index: number, value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <Screen>
      <SectionTitle
        eyebrow="BACKUP CONFIRMATION"
        title="Prove your backup is ready."
        body="Enter the requested words from your written backup. The full phrase will not be shown again."
      />
      <View style={styles.confirmCard}>
        {confirmationPositions.map((position, index) => (
          <Field
            key={position}
            label={`Word #${position}`}
            onChangeText={(value) => onChange(index, value)}
            placeholder="Enter word"
            value={values[index]}
          />
        ))}
      </View>
      <AppButton label="Confirm backup" onPress={onConfirm} icon="shield-checkmark-outline" />
    </Screen>
  );
}

function ImportScreen({ value, onChange, onContinue }: { value: string; onChange: (value: string) => void; onContinue: () => void }) {
  return (
    <Screen>
      <SectionTitle
        eyebrow="RESTORE LOCALLY"
        title="Import a wallet."
        body="Enter your BIP-39 recovery phrase on this device. It is validated and processed locally; it is never sent anywhere."
      />
      <Field
        autoCapitalize="sentences"
        label="Recovery phrase"
        multiline
        onChangeText={onChange}
        placeholder="Enter the words in order"
        value={value}
      />
      <Text style={styles.helperText}>Use the original words in their original order. Private-key import is not supported.</Text>
      <AppButton label="Validate phrase" onPress={onContinue} icon="arrow-forward" />
    </Screen>
  );
}

function ImportConfirm({ wallet, onConfirm }: { wallet: Wallet; onConfirm: () => void }) {
  const account = wallet.accounts[0];
  return (
    <Screen>
      <SectionTitle
        eyebrow="IMPORT REVIEW"
        title="Confirm this wallet."
        body="The first public address derived from your phrase is shown below. Confirm it before the local vault is created."
      />
      <View style={styles.addressCard}>
        <Text style={styles.cardEyebrow}>ACCOUNT 01 • EVM</Text>
        <Text selectable style={styles.addressText}>{account ? account.address : 'Unavailable'}</Text>
        <Text style={styles.addressPath}>{account?.derivationPath}</Text>
      </View>
      <AppButton label="Confirm and secure wallet" onPress={onConfirm} icon="lock-closed-outline" />
    </Screen>
  );
}

function PinSetup({ existing, pin, confirmPin, setPin, setConfirmPin, onContinue }: {
  existing: boolean;
  pin: string;
  confirmPin: string;
  setPin: (value: string) => void;
  setConfirmPin: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <Screen>
      <SectionTitle
        eyebrow="AUTHENTICATION SETUP"
        title={existing ? 'Secure your wallet.' : 'Create a wallet PIN.'}
        body={`Choose a ${6}-digit PIN. It protects access on this device and is never stored as plaintext.`}
      />
      <View style={styles.panel}>
        <Field keyboardType="number-pad" label="Enter PIN" onChangeText={setPin} placeholder="6 digits" secureTextEntry value={pin} />
        <Field keyboardType="number-pad" label="Confirm PIN" onChangeText={setConfirmPin} placeholder="Repeat your PIN" secureTextEntry value={confirmPin} />
        <Text style={styles.helperText}>A short retry backoff protects against rapid guessing. There is no permanent lockout.</Text>
      </View>
      <AppButton label="Set wallet PIN" onPress={onContinue} icon="key-outline" />
    </Screen>
  );
}

function BiometricSetup({ availability, onEnable, onSkip }: { availability: BiometricAvailability; onEnable: () => void; onSkip: () => void }) {
  const label = availability.type === 'face' ? 'Face ID' : availability.type === 'fingerprint' ? 'Touch ID / fingerprint' : 'device biometrics';
  return (
    <Screen>
      <SectionTitle
        eyebrow="OPTIONAL CONVENIENCE"
        title="Unlock with biometrics?"
        body={availability.available ? `Use ${label} through your operating system. PrimeWave never receives biometric data.` : 'Biometric hardware is not available or not enrolled on this device. You can always use your PIN.'}
      />
      <View style={styles.biometricIcon}>
        <Ionicons name={availability.available ? 'scan-outline' : 'phone-portrait-outline'} size={45} color={theme.colors.accent} />
      </View>
      {availability.available ? <AppButton label={`Enable ${label}`} onPress={onEnable} icon="finger-print-outline" /> : null}
      <AppButton label="Continue with PIN" onPress={onSkip} secondary />
    </Screen>
  );
}

function Locked({ biometricEnabled, onUnlock, onBiometric, onReset }: { biometricEnabled: boolean; onUnlock: (pin: string) => void; onBiometric: () => void; onReset: () => void }) {
  const [pin, setPin] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  return (
    <Screen>
      <View style={styles.lockHero}>
        <View style={styles.lockIcon}><Ionicons name="lock-closed-outline" size={34} color={theme.colors.accent} /></View>
        <Text style={styles.eyebrow}>PRIMEWAVE WALLET</Text>
        <Text style={styles.title}>Wallet locked</Text>
        <Text style={styles.body}>Authenticate to access your local wallet. Sensitive material stays hidden while locked.</Text>
      </View>
      {biometricEnabled ? <AppButton label="Unlock with biometrics" onPress={onBiometric} icon="finger-print-outline" /> : null}
      <Field keyboardType="number-pad" label="Wallet PIN" onChangeText={setPin} placeholder="6 digits" secureTextEntry value={pin} />
      <AppButton label="Unlock wallet" onPress={() => { onUnlock(pin); setPin(''); }} icon="arrow-forward" />
      {__DEV__ ? (
        resetRequested ? (
          <View style={styles.resetPreviewPanel}>
            <Text style={styles.resetPreviewTitle}>Erase this local preview?</Text>
            <Text style={styles.resetPreviewBody}>The preview wallet and its PIN will be permanently removed from this device. You can then create a new wallet.</Text>
            <AppButton label="Erase and restart" onPress={onReset} danger secondary icon="trash-outline" />
            <Pressable accessibilityRole="button" onPress={() => setResetRequested(false)} style={styles.resetCancelButton}>
              <Text style={styles.resetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <AppButton label="Reset local preview" onPress={() => setResetRequested(true)} secondary icon="refresh-outline" />
        )
      ) : null}
    </Screen>
  );
}

function WalletHome({ wallet, onSecurity, onLock }: { wallet: Wallet; onSecurity: () => void; onLock: () => void }) {
  const account = wallet.accounts[0];
  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>WALLET AVAILABLE • DEVICE LOCAL</Text>
        <Text style={styles.title}>Welcome back.</Text>
        <Text style={styles.body}>Your vault is unlocked. No network connection is required for this local foundation.</Text>
      </View>
      <View style={styles.addressCard}>
        <View style={styles.cardRow}>
          <Text style={styles.cardEyebrow}>PRIMARY ACCOUNT</Text>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>UNLOCKED</Text></View>
        </View>
        <Text selectable style={styles.addressText}>{account?.address}</Text>
        <Text style={styles.addressPath}>{account?.derivationPath}</Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Security controls</Text>
        <Text style={styles.panelBody}>Manage authentication, background locking, and recovery status.</Text>
        <AppButton label="Open security" onPress={onSecurity} icon="shield-checkmark-outline" secondary />
        <AppButton label="Lock wallet now" onPress={onLock} icon="lock-closed-outline" />
      </View>
      <Text style={styles.footerNote}>Phase 1B-2 is offline only. Network, transaction, and signing features are not enabled.</Text>
    </Screen>
  );
}

function Security({
  settings,
  biometricAvailability,
  securityPin,
  setSecurityPin,
  newPin,
  setNewPin,
  onChangePin,
  onToggleBiometric,
  onAutoLock,
  onReveal,
  onLock,
  onBack,
}: {
  settings: AuthenticationSettings;
  biometricAvailability: BiometricAvailability;
  securityPin: string;
  setSecurityPin: (value: string) => void;
  newPin: string;
  setNewPin: (value: string) => void;
  onChangePin: () => void;
  onToggleBiometric: () => void;
  onAutoLock: (policy: AutoLockPolicy) => void;
  onReveal: () => void;
  onLock: () => void;
  onBack: () => void;
}) {
  return (
    <Screen onBack={onBack}>
      <SectionTitle eyebrow="SECURITY" title="Protect this wallet." body="Changes require your current wallet PIN. Recovery material is never shown by default." />
      <View style={styles.settingsCard}>
        <Text style={styles.cardEyebrow}>AUTHENTICATION</Text>
        <View style={styles.settingRow}><Text style={styles.settingLabel}>Biometric unlock</Text><Text style={styles.settingValue}>{settings.biometricEnabled ? 'ON' : 'OFF'}</Text></View>
        {biometricAvailability.available ? <AppButton label={settings.biometricEnabled ? 'Disable biometrics' : 'Enable biometrics'} onPress={onToggleBiometric} secondary icon="finger-print-outline" /> : <Text style={styles.helperText}>No enrolled platform biometric is available. PIN fallback remains active.</Text>}
      </View>
      <View style={styles.settingsCard}>
        <Text style={styles.cardEyebrow}>AUTO-LOCK</Text>
        <Text style={styles.helperText}>Current: {settings.autoLockPolicy === 0 ? 'Immediately on background' : `After ${settings.autoLockPolicy / 60} minutes`}</Text>
        <View style={styles.choiceRow}>
          {[0, 30, 300, 900].map((policy) => (
            <Pressable key={policy} onPress={() => onAutoLock(policy as AutoLockPolicy)} style={[styles.choice, settings.autoLockPolicy === policy && styles.choiceSelected]}>
              <Text style={[styles.choiceText, settings.autoLockPolicy === policy && styles.choiceTextSelected]}>{policy === 0 ? 'Now' : policy < 60 ? '30s' : `${policy / 60}m`}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.settingsCard}>
        <Text style={styles.cardEyebrow}>CHANGE PIN</Text>
        <Field keyboardType="number-pad" label="Current PIN" onChangeText={setSecurityPin} placeholder="6 digits" secureTextEntry value={securityPin} />
        <Field keyboardType="number-pad" label="New PIN" onChangeText={setNewPin} placeholder="6 digits" secureTextEntry value={newPin} />
        <AppButton label="Update PIN" onPress={onChangePin} icon="key-outline" secondary />
      </View>
      <View style={styles.settingsCard}>
        <Text style={styles.cardEyebrow}>BACKUP STATUS</Text>
        <View style={styles.settingRow}><Text style={styles.settingLabel}>Recovery phrase</Text><Text style={styles.settingValue}>BACKED UP</Text></View>
        <Text style={styles.helperText}>Viewing it again requires PIN authentication and an explicit warning.</Text>
        <AppButton label="View recovery phrase" onPress={onReveal} icon="eye-outline" secondary />
      </View>
      <AppButton label="Lock wallet now" onPress={onLock} danger icon="lock-closed-outline" />
    </Screen>
  );
}

function Recovery({ phrase, onClose }: { phrase: string; onClose: () => void }) {
  return (
    <Screen>
      <SectionTitle eyebrow="AUTHENTICATED BACKUP" title="Recovery phrase" body="Anyone who has these words can control the wallet. Do not screenshot, copy, or share them." />
      <View style={styles.warningPanel}><Ionicons name="warning-outline" size={23} color={theme.states.warning} /><Text style={styles.warningBody}>PrimeWave cannot recover this wallet if you lose this phrase.</Text></View>
      <View style={styles.wordGrid}>
        {phrase.split(' ').map((word, index) => <View key={`${index}-${word}`} style={styles.wordCell}><Text style={styles.wordIndex}>{index + 1}</Text><Text style={styles.wordText}>{word}</Text></View>)}
      </View>
      <AppButton label="Hide recovery phrase" onPress={onClose} icon="eye-off-outline" />
    </Screen>
  );
}

function Loading() {
  return <Screen sensitive={false}><View style={styles.loading}><Ionicons name="shield-checkmark-outline" size={34} color={theme.colors.accent} /><Text style={styles.title}>Preparing local vault</Text><Text style={styles.body}>Checking platform-secure storage.</Text></View></Screen>;
}

function Unavailable() {
  return (
    <Screen sensitive={false}>
      <View style={styles.loading}>
        <View style={styles.lockIcon}><Ionicons name="phone-portrait-outline" size={34} color={theme.colors.accent} /></View>
        <Text style={styles.title}>Native storage required</Text>
        <Text style={styles.body}>PrimeWave Wallet does not use browser storage for wallet secrets. Open the native iOS or Android app with platform-secure storage and authentication enabled.</Text>
      </View>
    </Screen>
  );
}

export default function FoundationScreen() {
  const access = useMemo<WalletAccessManager>(() => getWalletAccessManager(), []);
  const [view, setView] = useState<ViewName>('loading');
  const [draft, setDraft] = useState<WalletSetupResult | null>(null);
  const [importedWallet, setImportedWallet] = useState<Wallet | null>(null);
  const [importPhrase, setImportPhrase] = useState('');
  const [confirmWords, setConfirmWords] = useState(['', '', '']);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinForBiometric, setPinForBiometric] = useState('');
  const [securityPin, setSecurityPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [revealedPhrase, setRevealedPhrase] = useState('');
  const [settings, setSettings] = useState<AuthenticationSettings>({ biometricEnabled: false, autoLockPolicy: 0, pinConfigured: false });
  const [biometricAvailability, setBiometricAvailability] = useState<BiometricAvailability>({ available: false, type: null });
  const [error, setError] = useState('');
  const [backgrounded, setBackgrounded] = useState(false);
  const appState = useRef(AppState.currentState);

  const refreshSettings = async () => {
    try {
      setSettings(await access.getAuthenticationSettings());
      setBiometricAvailability(await access.getBiometricAvailability());
    } catch (operationError) {
      setError(safeMessage(operationError));
    }
  };

  useEffect(() => {
    let mounted = true;
    void access.initialize().then(async (status) => {
      if (!mounted) return;
      if (status === 'onboarding') setView('welcome');
      else if (status === 'authentication-setup') setView('pin');
      else if (status === 'locked') { setView('locked'); await refreshSettings(); }
      else setView('unavailable');
    });
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appState.current !== 'active';
      appState.current = nextState;
      if (nextState === 'background' || nextState === 'inactive') {
        setBackgrounded(true);
        void screenPrivacyController.maskSensitiveContent();
        void access.handleAppStateChange(nextState).then(() => {
          if (access.getStatus() === 'locked') setView('locked');
        });
      } else if (nextState === 'active') {
        setBackgrounded(false);
        void screenPrivacyController.restoreSensitiveContent();
        if (wasBackground && access.getStatus() === 'locked') setView('locked');
      }
    });
    return () => { mounted = false; subscription.remove(); };
  }, [access]);

  useEffect(() => {
    if (view !== 'welcome' && view !== 'loading') void screenPrivacyController.enterSensitiveScreen('wallet-security-settings');
    else void screenPrivacyController.exitSensitiveScreen('wallet-security-settings');
    return () => { void screenPrivacyController.restoreSensitiveContent(); };
  }, [view]);

  const run = async (operation: () => Promise<void>) => {
    setError('');
    try { await operation(); } catch (operationError) { setError(safeMessage(operationError)); }
  };

  const currentWallet = access.getStatus() === 'unlocked' ? (() => { try { return access.getWallet(); } catch { return null; } })() : null;

  let content: React.ReactNode;
  if (view === 'loading') content = <Loading />;
  else if (view === 'unavailable') content = <Unavailable />;
  else if (view === 'welcome') content = <Welcome onCreate={() => setView('warning')} onImport={() => { setError(''); setView('import'); }} />;
  else if (view === 'warning') content = <Warning onContinue={() => void run(async () => { setDraft(await access.prepareNewWallet()); setView('phrase'); })} />;
  else if (view === 'phrase' && draft) content = <PhraseDisplay draft={draft} onContinue={() => setView('phrase-confirm')} />;
  else if (view === 'phrase-confirm' && draft) content = <PhraseConfirm draft={draft} values={confirmWords} onChange={(index, value) => setConfirmWords((current) => current.map((entry, i) => i === index ? value : entry))} onConfirm={() => void run(async () => {
    const words = draft.recoveryPhrase.split(' ');
    const matches = confirmationPositions.every((position, index) => words[position - 1] === confirmWords[index].trim().toLowerCase());
    if (!matches) { setError('The selected words do not match your backup.'); return; }
    await access.persistPreparedWallet();
    setDraft(null); setConfirmWords(['', '', '']); setView('pin');
  })} />;
  else if (view === 'import') content = <ImportScreen value={importPhrase} onChange={setImportPhrase} onContinue={() => void run(async () => { const wallet = await access.prepareImportWallet(importPhrase); setImportedWallet(wallet); setImportPhrase(''); setView('import-confirm'); })} />;
  else if (view === 'import-confirm' && importedWallet) content = <ImportConfirm wallet={importedWallet} onConfirm={() => void run(async () => { await access.persistPreparedWallet(); setImportedWallet(null); setView('pin'); })} />;
  else if (view === 'pin') content = <PinSetup existing={!draft && !importedWallet} pin={pin} confirmPin={confirmPin} setPin={setPin} setConfirmPin={setConfirmPin} onContinue={() => void run(async () => {
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { setError('Choose exactly 6 digits for your PIN.'); return; }
    if (pin !== confirmPin) { setError('PIN entries do not match.'); return; }
    await access.configurePin(pin);
    setPinForBiometric(pin); setPin(''); setConfirmPin(''); await refreshSettings(); setView('biometric');
  })} />;
  else if (view === 'biometric') content = <BiometricSetup availability={biometricAvailability} onEnable={() => void run(async () => { await access.enableBiometricUnlock(true, pinForBiometric); setPinForBiometric(''); await refreshSettings(); setView('wallet'); })} onSkip={() => { setPinForBiometric(''); setView('wallet'); }} />;
  else if (view === 'locked') content = <Locked biometricEnabled={settings.biometricEnabled} onUnlock={(value) => void run(async () => { const result = await access.unlockWithPin(value); if (!result.authenticated) { setError('Authentication failed. Try again or use your PIN fallback.'); return; } await refreshSettings(); setView('wallet'); })} onBiometric={() => void run(async () => { const result = await access.unlockWithBiometrics(); if (!result.authenticated) { setError(result.reason === 'cancelled' ? 'Biometric authentication was cancelled. Use your PIN.' : 'Biometric authentication was not available. Use your PIN.'); return; } setView('wallet'); })} onReset={() => void run(async () => { await access.resetLocalWallet(); setSettings({ biometricEnabled: false, autoLockPolicy: 0, pinConfigured: false }); setPin(''); setConfirmPin(''); setView('welcome'); })} />;
  else if (view === 'wallet' && currentWallet) content = <WalletHome wallet={currentWallet} onSecurity={() => { setError(''); setView('security'); }} onLock={() => void run(async () => { await access.lockWallet(); setView('locked'); })} />;
  else if (view === 'security') content = <Security settings={settings} biometricAvailability={biometricAvailability} securityPin={securityPin} setSecurityPin={setSecurityPin} newPin={newPin} setNewPin={setNewPin} onChangePin={() => void run(async () => { if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) { setError('Choose exactly 6 digits for your new PIN.'); return; } const result = await access.changePin(securityPin, newPin); if (!result.authenticated) { setError('Current PIN was not accepted.'); return; } setSecurityPin(''); setNewPin(''); await refreshSettings(); setError('PIN updated.'); })} onToggleBiometric={() => void run(async () => { const result = await access.enableBiometricUnlock(!settings.biometricEnabled, securityPin); if (!result.authenticated) { setError('Current PIN was not accepted.'); return; } setSecurityPin(''); await refreshSettings(); })} onAutoLock={(policy) => void run(async () => { await access.setAutoLockPolicy(policy); await refreshSettings(); if (policy === 0) setView('locked'); })} onReveal={() => void run(async () => { if (!securityPin) { setError('Enter your current PIN first.'); return; } setRevealedPhrase(await access.revealRecoveryPhrase(securityPin)); setSecurityPin(''); setView('recovery'); })} onLock={() => void run(async () => { await access.lockWallet(); setView('locked'); })} onBack={() => { setError(''); setView('wallet'); }} />;
  else if (view === 'recovery' && revealedPhrase) content = <Recovery phrase={revealedPhrase} onClose={() => { setRevealedPhrase(''); setView('security'); }} />;
  else content = <Loading />;

  return (
    <>
      {content}
      {error ? <View accessibilityRole="alert" style={styles.errorToast}><Ionicons name="alert-circle-outline" size={17} color={theme.colors.destructive} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => setError('')}><Ionicons name="close" size={18} color={theme.colors.mutedForeground} /></Pressable></View> : null}
      {backgrounded ? <View pointerEvents="auto" style={styles.privacyOverlay}><Ionicons name="lock-closed" size={30} color={theme.colors.accent} /><Text style={styles.privacyTitle}>PrimeWave Wallet</Text><Text style={styles.privacyBody}>Wallet content hidden</Text></View> : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  keyboardContainer: { flex: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg },
  orbTop: { position: 'absolute', top: -120, right: -100, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(80, 217, 255, 0.08)' },
  orbBottom: { position: 'absolute', bottom: -160, left: -140, width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(124, 140, 255, 0.08)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandMark: { width: 38, height: 38, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.55)' },
  brandIcon: { width: '100%', height: '100%' },
  brandName: { color: theme.colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 2 },
  brandProduct: { color: theme.colors.accent, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 2.8, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: theme.radius.pill, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.18)' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.states.success },
  statusText: { color: theme.colors.accent, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.1 },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.secondary },
  sensitiveMarker: { height: 0 },
  hero: { marginTop: theme.spacing.xl, gap: theme.spacing.md },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing, lineHeight: theme.typography.eyebrow.lineHeight },
  heroTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 39, lineHeight: 45, letterSpacing: -1.4 },
  heroAccent: { color: theme.colors.accent },
  title: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: theme.typography.title.fontSize, letterSpacing: theme.typography.title.letterSpacing, lineHeight: theme.typography.title.lineHeight },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: theme.typography.body.fontSize, lineHeight: theme.typography.body.lineHeight },
  sectionTitle: { marginTop: theme.spacing.xl, gap: theme.spacing.md },
  panel: { borderRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: 'rgba(124, 140, 255, 0.25)', ...theme.shadows.panel },
  panelIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.24)' },
  panelTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 17, lineHeight: 23 },
  panelBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: theme.typography.bodyMedium.fontSize, lineHeight: 21 },
  button: { minHeight: 54, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.accent, borderWidth: 1, borderColor: theme.colors.accent },
  buttonSecondary: { backgroundColor: theme.colors.secondary, borderColor: theme.colors.border },
  buttonDanger: { backgroundColor: 'transparent', borderColor: theme.colors.destructive },
  buttonDisabled: { opacity: theme.states.disabledOpacity },
  resetPreviewPanel: { borderRadius: theme.radius.md, padding: theme.spacing.md, gap: theme.spacing.sm, backgroundColor: 'rgba(255, 101, 132, 0.08)', borderWidth: 1, borderColor: 'rgba(255, 101, 132, 0.35)' },
  resetPreviewTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15, lineHeight: 20 },
  resetPreviewBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 19 },
  resetCancelButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  resetCancelText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, textDecorationLine: 'underline' },
  buttonPressed: { opacity: theme.states.pressedOpacity, transform: [{ scale: 0.99 }] },
  buttonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13, letterSpacing: 0.3 },
  buttonTextSecondary: { color: theme.colors.foreground },
  buttonTextDanger: { color: theme.colors.destructive },
  footerNote: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 'auto' },
  warningPanel: { borderRadius: theme.radius.md, padding: theme.spacing.lg, gap: theme.spacing.sm, backgroundColor: 'rgba(244, 200, 107, 0.08)', borderWidth: 1, borderColor: 'rgba(244, 200, 107, 0.3)' },
  warningTitle: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  warningBody: { color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14, lineHeight: 21 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  wordCell: { width: '31%', minHeight: 54, borderRadius: theme.radius.sm, paddingHorizontal: 9, paddingVertical: 8, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  wordIndex: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 10 },
  wordText: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, marginTop: 4 },
  confirmCard: { gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  fieldGroup: { gap: 7 },
  fieldLabel: { color: theme.colors.secondaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  input: { minHeight: 52, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  multilineInput: { minHeight: 140, paddingTop: theme.spacing.md, textAlignVertical: 'top' },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  addressCard: { borderRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.sm, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.25)' },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: 10, letterSpacing: 1.3 },
  addressText: { color: theme.colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 22 },
  addressPath: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  biometricIcon: { width: 104, height: 104, borderRadius: 52, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.3)', ...theme.shadows.glow },
  lockHero: { alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.xl, marginBottom: theme.spacing.lg },
  lockIcon: { width: 82, height: 82, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80, 217, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.3)', ...theme.shadows.glow },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.states.success },
  liveText: { color: theme.states.success, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1 },
  settingsCard: { borderRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingLabel: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  settingValue: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11, letterSpacing: 1 },
  choiceRow: { flexDirection: 'row', gap: 7 },
  choice: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  choiceSelected: { backgroundColor: 'rgba(80, 217, 255, 0.15)', borderColor: theme.colors.accent },
  choiceText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  choiceTextSelected: { color: theme.colors.accent },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.md },
  errorToast: { position: 'absolute', left: theme.spacing.md, right: theme.spacing.md, bottom: 22, minHeight: 48, paddingHorizontal: theme.spacing.md, paddingVertical: 12, borderRadius: theme.radius.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.destructive, ...theme.shadows.panel },
  errorText: { flex: 1, color: theme.colors.secondaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  privacyOverlay: { ...StyleSheet.absoluteFill, zIndex: 20, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.background },
  privacyTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16 },
  privacyBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
});