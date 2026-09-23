import type {
  AuthenticationSettings,
  BiometricAvailability,
} from '@/src/core/security';
import { shortPublicAddress } from './WalletHomeShell.logic';

export type WalletSettingsRowAction =
  | 'account'
  | 'network'
  | 'security'
  | 'lock'
  | 'coming-soon'
  | null;

export interface WalletSettingsRowModel {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly value: string;
  readonly action: WalletSettingsRowAction;
}

export interface WalletSettingsSectionModel {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly WalletSettingsRowModel[];
}

export interface WalletSettingsModelInput {
  readonly accountLabel: string;
  readonly accountIndex: number | null;
  readonly accountAddress: string | null;
  readonly networkName: string;
  readonly networkStatus: string;
  readonly previewMode: boolean;
  readonly authenticationSettings: AuthenticationSettings;
  readonly biometricAvailability: BiometricAvailability;
}

export function settingsVersionLabel(
  nativeApplicationVersion: string | null,
  platform: string,
): string {
  return nativeApplicationVersion?.trim() ||
    (platform === 'web' ? 'Development build' : 'Unavailable');
}

export function createWalletSettingsSections(
  input: WalletSettingsModelInput,
): readonly WalletSettingsSectionModel[] {
  const address = input.accountAddress
    ? shortPublicAddress(input.accountAddress)
    : 'Unavailable';
  const accountDetails =
    input.accountIndex === null
      ? `${input.accountLabel} • ${address}`
      : `${input.accountLabel} • Index ${input.accountIndex} • ${address}`;
  const pinStatus = input.previewMode
    ? input.authenticationSettings.pinConfigured
      ? 'Preview PIN configured'
      : 'Not configured'
    : input.authenticationSettings.pinConfigured
      ? 'PIN configured'
      : 'Not configured';

  return [
    {
      id: 'wallet',
      title: 'WALLET',
      rows: [
        {
          id: 'account',
          title: 'Account',
          body: accountDetails,
          value: 'View account',
          action: 'account',
        },
        {
          id: 'network',
          title: 'Networks',
          body: 'Selected network',
          value: `${input.networkName} • ${input.networkStatus}`,
          action: 'network',
        },
        {
          id: 'lock',
          title: 'Lock Wallet',
          body: input.previewMode
            ? 'Use the development-only Preview lock flow.'
            : 'Lock access using the existing wallet flow.',
          value: 'Lock now',
          action: 'lock',
        },
      ],
    },
    {
      id: 'security',
      title: 'SECURITY',
      rows: [
        {
          id: 'pin',
          title: 'Wallet access',
          body: input.previewMode
            ? 'Development-only access state.'
            : 'Local PIN authentication status.',
          value: pinStatus,
          action: null,
        },
        {
          id: 'biometric',
          title: 'Biometric unlock',
          body: input.previewMode
            ? 'Native biometric configuration is isolated from Preview.'
            : 'Device biometric availability and status.',
          value: input.previewMode
            ? 'Not available in Preview'
            : input.authenticationSettings.biometricEnabled
              ? 'Enabled'
              : input.biometricAvailability.available
                ? 'Available, not enabled'
                : 'Unavailable',
          action: null,
        },
        {
          id: 'secure-storage',
          title: 'Secure storage',
          body: input.previewMode
            ? 'No native vault or SecureStore is used.'
            : 'Wallet secrets are managed by the existing device-secure flow.',
          value: input.previewMode ? 'Not used in Preview' : 'Managed by device',
          action: null,
        },
        {
          id: 'recovery',
          title: 'Recovery phrase',
          body: input.previewMode
            ? 'Preview has no recovery material.'
            : 'Recovery material is not shown here.',
          value: input.previewMode
            ? 'Not used in Preview'
            : 'Managed securely on this device',
          action: null,
        },
        {
          id: 'security-controls',
          title: 'Security controls',
          body: input.previewMode
            ? 'Native security settings are not available in Preview.'
            : 'Change PIN, biometrics, and auto-lock settings.',
          value: input.previewMode ? 'Not available in Preview' : 'Open controls',
          action: input.previewMode ? null : 'security',
        },
      ],
    },
    {
      id: 'preferences',
      title: 'PREFERENCES',
      rows: [
        {
          id: 'notifications',
          title: 'Notifications',
          body: 'Mobile push notification registration is not configured.',
          value: 'Not configured yet',
          action: null,
        },
        {
          id: 'display',
          title: 'Display preferences',
          body: 'Fiat currency and display preferences are not available yet.',
          value: 'Coming soon',
          action: 'coming-soon',
        },
      ],
    },
    {
      id: 'about',
      title: 'ABOUT',
      rows: [
        {
          id: 'product',
          title: 'WaveX',
          body: 'Non-custodial wallet foundation.',
          value: 'Wallet',
          action: null,
        },
        {
          id: 'environment',
          title: 'Environment',
          body: input.previewMode
            ? 'Development-only public identity and controls.'
            : 'Local wallet foundation.',
          value: input.previewMode ? 'Preview Test Mode' : 'Native app',
          action: null,
        },
        {
          id: 'privacy',
          title: 'Privacy Policy',
          body: 'No privacy policy route is configured in this build.',
          value: 'Not available yet',
          action: null,
        },
        {
          id: 'terms',
          title: 'Terms',
          body: 'No terms route is configured in this build.',
          value: 'Not available yet',
          action: null,
        },
        {
          id: 'support',
          title: 'Support',
          body: 'No support route is configured in this build.',
          value: 'Not available yet',
          action: null,
        },
      ],
    },
  ];
}