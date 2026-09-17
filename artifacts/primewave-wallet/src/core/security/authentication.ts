import { scryptAsync } from '@noble/hashes/scrypt.js';
import type {
  AuthenticationResult,
  BiometricAvailability,
  BiometricType,
  WalletAuthenticator,
} from './contracts';
import { secureLogger } from './logging';

export const WALLET_PIN_LENGTH = 6;
export const AUTHENTICATION_STORAGE_KEY = 'primewave.wallet.authentication';
export const AUTHENTICATION_RECORD_VERSION = 1 as const;
export const BIOMETRIC_OPERATION_TIMEOUT_MS = 15_000;

export type AutoLockPolicy = 0 | 30 | 300 | 900;
export const DEFAULT_AUTO_LOCK_POLICY: AutoLockPolicy = 0;

const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DK_LEN = 32;
const SALT_BYTES = 16;
const MAX_BACKOFF_MS = 10_000;

class BiometricOperationTimeoutError extends Error {
  constructor() {
    super('Biometric operation timed out.');
    this.name = 'BiometricOperationTimeoutError';
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new BiometricOperationTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export type WalletLockState =
  | 'LOCKED'
  | 'UNLOCKING'
  | 'UNLOCKED'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHENTICATION_UNAVAILABLE';

export interface AuthenticationSettings {
  biometricEnabled: boolean;
  autoLockPolicy: AutoLockPolicy;
  pinConfigured: boolean;
}

export interface AuthenticationStorage {
  isAvailableAsync(): Promise<boolean>;
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface EntropyProvider {
  getRandomBytesAsync(byteCount: number): Promise<Uint8Array>;
}

export interface BiometricProvider {
  isHardwareEnrolledAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  authenticateAsync(options: {
    promptMessage: string;
    cancelLabel: string;
    disableDeviceFallback: boolean;
  }): Promise<{ success: boolean; error?: string }>;
}

type AuthenticationRecord = {
  version: typeof AUTHENTICATION_RECORD_VERSION;
  saltHex: string;
  verifierHex: string;
  biometricEnabled: boolean;
  autoLockPolicy: AutoLockPolicy;
  failedAttempts: number;
  lockedUntil: number | null;
};

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PIN'
      | 'AUTHENTICATION_UNAVAILABLE'
      | 'AUTHENTICATION_STATE_INVALID'
      | 'AUTHENTICATION_STORAGE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new AuthenticationError(
      'AUTHENTICATION_STATE_INVALID',
      'Authentication is unavailable.',
    );
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${WALLET_PIN_LENGTH}}$`).test(pin);
}

function isAutoLockPolicy(value: unknown): value is AutoLockPolicy {
  return value === 0 || value === 30 || value === 300 || value === 900;
}

async function isWebPlatform(): Promise<boolean> {
  return typeof document !== 'undefined';
}

function parseRecord(payload: string): AuthenticationRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new AuthenticationError(
      'AUTHENTICATION_STATE_INVALID',
      'Authentication is unavailable.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AuthenticationError(
      'AUTHENTICATION_STATE_INVALID',
      'Authentication is unavailable.',
    );
  }

  const record = parsed as Record<string, unknown>;
  const saltHex = record.saltHex;
  const verifierHex = record.verifierHex;
  const biometricEnabled = record.biometricEnabled;
  const autoLockPolicy = record.autoLockPolicy;
  const failedAttempts = record.failedAttempts;
  const lockedUntil = record.lockedUntil;

  if (
    record.version !== AUTHENTICATION_RECORD_VERSION ||
    typeof saltHex !== 'string' ||
    saltHex.length !== SALT_BYTES * 2 ||
    typeof verifierHex !== 'string' ||
    verifierHex.length !== SCRYPT_DK_LEN * 2 ||
    typeof biometricEnabled !== 'boolean' ||
    !isAutoLockPolicy(autoLockPolicy) ||
    typeof failedAttempts !== 'number' ||
    !Number.isSafeInteger(failedAttempts) ||
    failedAttempts < 0 ||
    (lockedUntil !== null &&
      typeof lockedUntil !== 'number') ||
    (lockedUntil !== null &&
      (!Number.isSafeInteger(lockedUntil) || lockedUntil < 0))
  ) {
    throw new AuthenticationError(
      'AUTHENTICATION_STATE_INVALID',
      'Authentication is unavailable.',
    );
  }

  hexToBytes(saltHex);
  hexToBytes(verifierHex);

  return {
    version: AUTHENTICATION_RECORD_VERSION,
    saltHex,
    verifierHex,
    biometricEnabled,
    autoLockPolicy,
    failedAttempts: failedAttempts as number,
    lockedUntil: lockedUntil as number | null,
  };
}

function getBiometricType(types: number[]): BiometricType | null {
  const localAuthentication = {
    fingerprint: 1,
    facial: 2,
    iris: 3,
  };

  if (types.includes(localAuthentication.facial)) {
    return 'face';
  }
  if (types.includes(localAuthentication.fingerprint)) {
    return 'fingerprint';
  }
  if (types.includes(localAuthentication.iris)) {
    return 'iris';
  }
  return types.length > 0 ? 'unknown' : null;
}

class ExpoAuthenticationStorage implements AuthenticationStorage {
  async isAvailableAsync(): Promise<boolean> {
    if (await isWebPlatform()) {
      return false;
    }
    const SecureStore = await import('expo-secure-store');
    return SecureStore.isAvailableAsync();
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async getItemAsync(key: string): Promise<string | null> {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async deleteItemAsync(key: string): Promise<void> {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
}

class ExpoBiometricProvider implements BiometricProvider {
  async isHardwareEnrolledAsync(): Promise<boolean> {
    const LocalAuthentication = await import('expo-local-authentication');
    return LocalAuthentication.isEnrolledAsync();
  }

  async supportedAuthenticationTypesAsync(): Promise<number[]> {
    const LocalAuthentication = await import('expo-local-authentication');
    return LocalAuthentication.supportedAuthenticationTypesAsync();
  }

  async authenticateAsync(
    options: Parameters<BiometricProvider['authenticateAsync']>[0],
  ): Promise<{ success: boolean; error?: string }> {
    const LocalAuthentication = await import('expo-local-authentication');
    return LocalAuthentication.authenticateAsync(options);
  }
}

export class AuthenticationManager implements WalletAuthenticator {
  private readonly storagePromise: Promise<AuthenticationStorage>;
  private readonly entropyPromise: Promise<EntropyProvider>;
  private readonly biometricPromise: Promise<BiometricProvider>;
  private readonly now: () => number;
  private readonly onLock?: () => void;
  private readonly biometricTimeoutMs: number;
  private state: WalletLockState = 'LOCKED';
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private isBackgrounded = false;
  private biometricPromptInFlight = false;
  private pendingBackgroundLock = false;

  constructor(options?: {
    storage?: AuthenticationStorage;
    entropyProvider?: EntropyProvider;
    biometricProvider?: BiometricProvider;
    now?: () => number;
    onLock?: () => void;
    biometricTimeoutMs?: number;
  }) {
    this.storagePromise = options?.storage
      ? Promise.resolve(options.storage)
      : Promise.resolve(new ExpoAuthenticationStorage());
    this.entropyPromise = options?.entropyProvider
      ? Promise.resolve(options.entropyProvider)
      : import('expo-crypto').then((Crypto) => ({
          getRandomBytesAsync: Crypto.getRandomBytesAsync,
        }));
    this.biometricPromise = options?.biometricProvider
      ? Promise.resolve(options.biometricProvider)
      : Promise.resolve(new ExpoBiometricProvider());
    this.now = options?.now ?? (() => Date.now());
    this.onLock = options?.onLock;
    this.biometricTimeoutMs = Math.max(
      1,
      options?.biometricTimeoutMs ?? BIOMETRIC_OPERATION_TIMEOUT_MS,
    );
  }

  getLockState(): WalletLockState {
    return this.state;
  }

  async isPinConfigured(): Promise<boolean> {
    return (await this.readRecord()) !== null;
  }

  async getSettings(): Promise<AuthenticationSettings> {
    const record = await this.readRecord();
    return {
      biometricEnabled: record?.biometricEnabled ?? false,
      autoLockPolicy: record?.autoLockPolicy ?? DEFAULT_AUTO_LOCK_POLICY,
      pinConfigured: record !== null,
    };
  }

  async configurePinAuthentication(pin: string): Promise<void> {
    this.assertValidPin(pin);
    const existing = await this.readRecord();
    const salt = await (await this.entropyPromise).getRandomBytesAsync(SALT_BYTES);
    const verifier = await this.deriveVerifier(pin, salt);

    try {
      await this.writeRecord({
        version: AUTHENTICATION_RECORD_VERSION,
        saltHex: bytesToHex(salt),
        verifierHex: bytesToHex(verifier),
        biometricEnabled: existing?.biometricEnabled ?? false,
        autoLockPolicy: existing?.autoLockPolicy ?? DEFAULT_AUTO_LOCK_POLICY,
        failedAttempts: 0,
        lockedUntil: null,
      });
      this.state = 'UNLOCKED';
    } finally {
      salt.fill(0);
      verifier.fill(0);
    }
  }

  async authenticateWithPin(pin: string): Promise<AuthenticationResult> {
    if (!isValidPin(pin)) {
      this.state = 'AUTHENTICATION_FAILED';
      return { authenticated: false, reason: 'rejected' };
    }

    const record = await this.readRecord();
    if (!record) {
      this.state = 'AUTHENTICATION_UNAVAILABLE';
      return { authenticated: false, reason: 'not-configured' };
    }

    const now = this.now();
    if (record.lockedUntil !== null && record.lockedUntil > now) {
      this.state = 'AUTHENTICATION_FAILED';
      return { authenticated: false, reason: 'locked' };
    }

    this.state = 'UNLOCKING';
    const salt = hexToBytes(record.saltHex);
    const expected = hexToBytes(record.verifierHex);
    const actual = await this.deriveVerifier(pin, salt);
    const authenticated = equalBytes(actual, expected);
    salt.fill(0);
    actual.fill(0);
    expected.fill(0);

    if (authenticated) {
      await this.writeRecord({
        ...record,
        failedAttempts: 0,
        lockedUntil: null,
      });
      this.state = 'UNLOCKED';
      return { authenticated: true, reason: 'success' };
    }

    const failedAttempts = record.failedAttempts + 1;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      500 * 2 ** Math.min(failedAttempts - 1, 5),
    );
    await this.writeRecord({
      ...record,
      failedAttempts,
      lockedUntil: now + delay,
    });
    this.state = 'AUTHENTICATION_FAILED';
    secureLogger.warning('Wallet PIN authentication failed', {
      attemptBackoffMs: delay,
    });
    return { authenticated: false, reason: 'rejected' };
  }

  async authenticateWithBiometrics(): Promise<AuthenticationResult> {
    let record: AuthenticationRecord | null;
    try {
      record = await withTimeout(
        this.readRecord(),
        this.biometricTimeoutMs,
      );
    } catch {
      this.state = 'AUTHENTICATION_UNAVAILABLE';
      return { authenticated: false, reason: 'unavailable' };
    }

    if (!record || !record.biometricEnabled) {
      this.state = 'AUTHENTICATION_UNAVAILABLE';
      return { authenticated: false, reason: 'not-configured' };
    }

    const availability = await this.determineBiometricAvailability();
    if (!availability.available) {
      this.state = 'AUTHENTICATION_UNAVAILABLE';
      return { authenticated: false, reason: 'unavailable' };
    }

    this.state = 'UNLOCKING';
    this.biometricPromptInFlight = true;

    let result: AuthenticationResult;
    try {
      const response = await withTimeout(
        (async () => {
          const provider = await this.biometricPromise;
          return provider.authenticateAsync({
            promptMessage: 'Unlock PrimeWave Wallet',
            cancelLabel: 'Use PIN',
            disableDeviceFallback: true,
          });
        })(),
        this.biometricTimeoutMs,
      );

      if (response.success) {
        this.state = 'UNLOCKED';
        result = { authenticated: true, reason: 'success' };
      } else if (
        response.error === 'user_cancel' ||
        response.error === 'system_cancel'
      ) {
        this.state = 'AUTHENTICATION_FAILED';
        result = { authenticated: false, reason: 'cancelled' };
      } else if (
        response.error === 'lockout' ||
        response.error === 'lockout_permanent'
      ) {
        this.state = 'AUTHENTICATION_FAILED';
        result = { authenticated: false, reason: 'locked' };
      } else {
        this.state = 'AUTHENTICATION_FAILED';
        result = { authenticated: false, reason: 'rejected' };
      }
    } catch {
      this.state = 'AUTHENTICATION_UNAVAILABLE';
      result = { authenticated: false, reason: 'unavailable' };
    }

    return this.completeBiometricAttempt(result);
  }

  async determineBiometricAvailability(): Promise<BiometricAvailability> {
    if (await isWebPlatform()) {
      return { available: false, type: null };
    }

    try {
      const [hardwareEnrolled, types] = await withTimeout(
        (async () => {
          const provider = await this.biometricPromise;
          return Promise.all([
            provider.isHardwareEnrolledAsync(),
            provider.supportedAuthenticationTypesAsync(),
          ]);
        })(),
        this.biometricTimeoutMs,
      );
      return {
        available: hardwareEnrolled && types.length > 0,
        type: getBiometricType(types),
      };
    } catch {
      return { available: false, type: null };
    }
  }

  async setBiometricUnlockEnabled(enabled: boolean): Promise<void> {
    const record = await this.requireRecord();
    await this.writeRecord({ ...record, biometricEnabled: enabled });
  }

  async changePin(currentPin: string, nextPin: string): Promise<AuthenticationResult> {
    const result = await this.authenticateWithPin(currentPin);
    if (!result.authenticated) {
      return result;
    }
    await this.configurePinAuthentication(nextPin);
    return { authenticated: true, reason: 'success' };
  }

  async setAutoLockPolicy(policy: AutoLockPolicy): Promise<void> {
    const record = await this.requireRecord();
    await this.writeRecord({ ...record, autoLockPolicy: policy });
    if (this.isBackgrounded) {
      this.scheduleAutoLock(policy);
    }
  }

  async handleAppStateChange(
    nextState: 'active' | 'background' | 'inactive',
  ): Promise<void> {
    if (nextState === 'active') {
      this.isBackgrounded = false;
      this.clearAutoLockTimer();
      if (this.biometricPromptInFlight) {
        this.pendingBackgroundLock = false;
      }
      return;
    }
    this.isBackgrounded = true;
    if (this.biometricPromptInFlight) {
      this.pendingBackgroundLock = true;
      return;
    }
    await this.lockForBackground();
  }

  async lockWallet(): Promise<void> {
    this.clearAutoLockTimer();
    this.isBackgrounded = false;
    this.pendingBackgroundLock = false;
    this.state = 'LOCKED';
    this.onLock?.();
    secureLogger.info('Wallet locked');
  }

  async unlockWallet(): Promise<AuthenticationResult> {
    if (this.state === 'UNLOCKED') {
      return { authenticated: true, reason: 'success' };
    }
    return { authenticated: false, reason: 'not-configured' };
  }

  private async lockForBackground(): Promise<void> {
    let record: AuthenticationRecord | null;
    try {
      record = await this.readRecord();
    } catch (error) {
      if (
        error instanceof AuthenticationError &&
        error.code === 'AUTHENTICATION_UNAVAILABLE'
      ) {
        return;
      }
      throw error;
    }
    if (!record) {
      return;
    }
    this.scheduleAutoLock(record.autoLockPolicy);
  }

  private async completeBiometricAttempt(
    result: AuthenticationResult,
  ): Promise<AuthenticationResult> {
    this.biometricPromptInFlight = false;
    const shouldLock = this.pendingBackgroundLock && this.isBackgrounded;
    this.pendingBackgroundLock = false;

    if (shouldLock) {
      await this.lockWallet();
      return { authenticated: false, reason: 'locked' };
    }

    return result;
  }

  private async deriveVerifier(pin: string, salt: Uint8Array): Promise<Uint8Array> {
    return scryptAsync(new TextEncoder().encode(pin), salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_DK_LEN,
    });
  }

  private assertValidPin(pin: string): void {
    if (!isValidPin(pin)) {
      throw new AuthenticationError(
        'INVALID_PIN',
        `PIN must contain exactly ${WALLET_PIN_LENGTH} digits.`,
      );
    }
  }

  private async readRecord(): Promise<AuthenticationRecord | null> {
    const storage = await this.storagePromise;
    let available = false;
    try {
      available = await storage.isAvailableAsync();
    } catch {
      available = false;
    }
    if (!available) {
      throw new AuthenticationError(
        'AUTHENTICATION_UNAVAILABLE',
        'Authentication is unavailable.',
      );
    }

    try {
      const payload = await storage.getItemAsync(AUTHENTICATION_STORAGE_KEY);
      return payload === null ? null : parseRecord(payload);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        'AUTHENTICATION_STORAGE_FAILED',
        'Authentication is unavailable.',
      );
    }
  }

  private async writeRecord(record: AuthenticationRecord): Promise<void> {
    const storage = await this.storagePromise;
    try {
      await storage.setItemAsync(
        AUTHENTICATION_STORAGE_KEY,
        JSON.stringify(record),
      );
    } catch {
      throw new AuthenticationError(
        'AUTHENTICATION_STORAGE_FAILED',
        'Authentication is unavailable.',
      );
    }
  }

  private async requireRecord(): Promise<AuthenticationRecord> {
    const record = await this.readRecord();
    if (!record) {
      throw new AuthenticationError(
        'AUTHENTICATION_UNAVAILABLE',
        'Authentication is unavailable.',
      );
    }
    return record;
  }

  private scheduleAutoLock(policy: AutoLockPolicy): void {
    this.clearAutoLockTimer();
    if (policy === 0) {
      if (this.biometricPromptInFlight) {
        this.pendingBackgroundLock = true;
      } else {
        void this.lockWallet();
      }
      return;
    }
    this.autoLockTimer = setTimeout(() => {
      if (this.biometricPromptInFlight) {
        this.pendingBackgroundLock = true;
      } else {
        void this.lockWallet();
      }
    }, policy * 1000);
  }

  private clearAutoLockTimer(): void {
    if (this.autoLockTimer !== null) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }
}