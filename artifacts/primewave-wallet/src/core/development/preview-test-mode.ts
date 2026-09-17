import type { Wallet } from '@/src/core/wallet/models';

const PREVIEW_STATE_KEY = 'wavex.development.preview-test-mode.v1';
const PREVIEW_STATE_VERSION = 1 as const;
const PREVIEW_TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PREVIEW_WALLET_ID = 'development-preview-test-wallet';

export type PreviewTestPhase =
  | 'onboarding'
  | 'pin-setup'
  | 'locked'
  | 'unlocked';

interface PreviewStateRecord {
  readonly version: typeof PREVIEW_STATE_VERSION;
  readonly phase: PreviewTestPhase;
  readonly pinFingerprint: string | null;
}

export interface PreviewTestState {
  readonly hasPreviewWallet: boolean;
  readonly phase: PreviewTestPhase;
  readonly pinConfigured: boolean;
}

function isPreviewDevelopmentBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function isPreviewTestModeAvailable(): boolean {
  return isPreviewDevelopmentBuild() && typeof document !== 'undefined';
}

function fingerprintPin(pin: string): string {
  let hash = 2166136261;
  for (const character of pin) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `preview-pin-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

function emptyRecord(): PreviewStateRecord {
  return {
    version: PREVIEW_STATE_VERSION,
    phase: 'onboarding',
    pinFingerprint: null,
  };
}

function parseRecord(value: string | null): PreviewStateRecord {
  if (!value) return emptyRecord();

  try {
    const parsed = JSON.parse(value) as Partial<PreviewStateRecord>;
    if (
      parsed.version !== PREVIEW_STATE_VERSION ||
      (parsed.phase !== 'onboarding' &&
        parsed.phase !== 'pin-setup' &&
        parsed.phase !== 'locked' &&
        parsed.phase !== 'unlocked') ||
      (parsed.pinFingerprint !== null &&
        typeof parsed.pinFingerprint !== 'string')
    ) {
      return emptyRecord();
    }
    return {
      version: PREVIEW_STATE_VERSION,
      phase: parsed.phase,
      pinFingerprint: parsed.pinFingerprint,
    };
  } catch {
    return emptyRecord();
  }
}

function getBrowserState(): PreviewStateRecord {
  if (!isPreviewTestModeAvailable()) return emptyRecord();
  try {
    return parseRecord(window.localStorage.getItem(PREVIEW_STATE_KEY));
  } catch {
    return emptyRecord();
  }
}

function setBrowserState(record: PreviewStateRecord): void {
  if (!isPreviewTestModeAvailable()) return;
  try {
    window.localStorage.setItem(PREVIEW_STATE_KEY, JSON.stringify(record));
  } catch {
    // Preview mode remains usable for the current session if storage is blocked.
  }
}

function clearBrowserState(): void {
  if (!isPreviewTestModeAvailable()) return;
  try {
    window.localStorage.removeItem(PREVIEW_STATE_KEY);
  } catch {
    // Reset still succeeds for the in-memory application state.
  }
}

function createPreviewWalletModel(): Wallet {
  return {
    walletId: PREVIEW_WALLET_ID,
    createdAt: 'development-preview',
    accountCount: 1,
    accounts: [
      {
        accountId: 'development-preview-account-0',
        index: 0,
        address: PREVIEW_TEST_ADDRESS,
        derivationPath: "m/44'/60'/0'/0/0",
      },
    ],
  };
}

export class PreviewTestMode {
  getState(): PreviewTestState {
    const record = getBrowserState();
    return {
      hasPreviewWallet: record.phase !== 'onboarding',
      phase: record.phase,
      pinConfigured: record.pinFingerprint !== null,
    };
  }

  getWallet(): Wallet | null {
    return this.getState().phase === 'unlocked'
      ? createPreviewWalletModel()
      : null;
  }

  createPreviewWallet(): Wallet {
    setBrowserState({
      version: PREVIEW_STATE_VERSION,
      phase: 'pin-setup',
      pinFingerprint: null,
    });
    return createPreviewWalletModel();
  }

  setPreviewPin(pin: string): void {
    if (!isValidPin(pin)) {
      throw new Error('Preview PIN must contain exactly 6 digits.');
    }
    setBrowserState({
      version: PREVIEW_STATE_VERSION,
      phase: 'unlocked',
      pinFingerprint: fingerprintPin(pin),
    });
  }

  verifyPreviewPin(pin: string): boolean {
    const record = getBrowserState();
    if (!isValidPin(pin) || !record.pinFingerprint) return false;
    const matches = fingerprintPin(pin) === record.pinFingerprint;
    if (matches) {
      setBrowserState({ ...record, phase: 'unlocked' });
    }
    return matches;
  }

  lockPreviewWallet(): void {
    const record = getBrowserState();
    if (record.pinFingerprint) {
      setBrowserState({ ...record, phase: 'locked' });
    }
  }

  resetPreviewWallet(): void {
    clearBrowserState();
  }
}
