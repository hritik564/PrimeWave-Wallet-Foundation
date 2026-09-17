export type SensitiveScreen =
  | 'recovery-phrase'
  | 'private-key-export'
  | 'transaction-confirmation'
  | 'wallet-security-settings';

export interface ScreenPrivacyPolicy {
  preventScreenshotsWhereSupported: boolean;
  maskSensitiveContentInBackground: boolean;
  clearSensitiveContentOnBlur: boolean;
  platformSpecificBehaviorRequired: boolean;
}

export interface ScreenPrivacyController {
  enterSensitiveScreen(screen: SensitiveScreen): Promise<void>;
  exitSensitiveScreen(screen: SensitiveScreen): Promise<void>;
  maskSensitiveContent(): Promise<void>;
  restoreSensitiveContent(): Promise<void>;
}

export const defaultScreenPrivacyPolicy: ScreenPrivacyPolicy = {
  preventScreenshotsWhereSupported: true,
  maskSensitiveContentInBackground: true,
  clearSensitiveContentOnBlur: true,
  platformSpecificBehaviorRequired: true,
};