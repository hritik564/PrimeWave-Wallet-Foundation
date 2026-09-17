export interface SensitiveClipboardPolicy {
  requireExplicitWarningBeforeCopy: boolean;
  neverAutomaticallyCopyRecoveryPhrase: boolean;
  neverReadClipboardUnnecessarily: boolean;
  clearSensitiveClipboardWhenSupported: boolean;
}

export interface SensitiveClipboardController {
  confirmSensitiveCopy(): Promise<boolean>;
  copySensitiveValue(): Promise<void>;
  clearSensitiveClipboardWhenSupported(): Promise<void>;
}

export const defaultSensitiveClipboardPolicy: SensitiveClipboardPolicy = {
  requireExplicitWarningBeforeCopy: true,
  neverAutomaticallyCopyRecoveryPhrase: true,
  neverReadClipboardUnnecessarily: true,
  clearSensitiveClipboardWhenSupported: true,
};