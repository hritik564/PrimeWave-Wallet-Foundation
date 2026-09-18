import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHENTICATION_STORAGE_KEY,
  AuthenticationManager,
  type AuthenticationStorage,
  type BiometricProvider,
} from '../authentication';
import { WalletAccessManager } from '../wallet-access';
import type { EncryptedWalletState, SecureVault } from '../contracts';
import { LocalWalletEngine } from '@/src/core/wallet/local-wallet-engine';
import {
  SecureWalletVault,
  type SecureKeyValueStorage,
} from '@/src/core/wallet/internal/vault';

class MemoryAuthenticationStorage implements AuthenticationStorage {
  private value: string | null = null;
  failDelete = false;

  async isAvailableAsync(): Promise<boolean> {
    return true;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    this.value = value;
  }

  async getItemAsync(_key: string): Promise<string | null> {
    return this.value;
  }

  async deleteItemAsync(_key: string): Promise<void> {
    if (this.failDelete) {
      throw new Error('authentication item cleanup failed');
    }
    this.value = null;
  }

  hasAuthenticationRecord(): boolean {
    return this.value !== null;
  }
}

class DeferredAuthenticationStorage extends MemoryAuthenticationStorage {
  pauseReads = false;
  private releaseRead: (() => void) | null = null;
  private resolveReadStarted: (() => void) | null = null;
  readonly readStarted = new Promise<void>((resolve) => {
    this.resolveReadStarted = resolve;
  });

  override async getItemAsync(key: string): Promise<string | null> {
    if (this.pauseReads) {
      this.resolveReadStarted?.();
      await new Promise<void>((resolve) => {
        this.releaseRead = resolve;
      });
    }
    return super.getItemAsync(key);
  }

  release(): void {
    this.releaseRead?.();
    this.releaseRead = null;
  }
}

class MemorySecureStorage implements SecureKeyValueStorage {
  value: string | null = null;

  async isAvailableAsync(): Promise<boolean> {
    return true;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    this.value = value;
  }

  async getItemAsync(_key: string): Promise<string | null> {
    return this.value;
  }

  async deleteItemAsync(_key: string): Promise<void> {
    this.value = null;
  }
}

class DeferredBiometrics implements BiometricProvider {
  private resolveAuthentication:
    | ((response: { success: boolean; error?: string }) => void)
    | null = null;
  private resolveStarted: (() => void) | null = null;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  async isHardwareEnrolledAsync(): Promise<boolean> {
    return true;
  }

  async supportedAuthenticationTypesAsync(): Promise<number[]> {
    return [2];
  }

  async authenticateAsync(): Promise<{ success: boolean; error?: string }> {
    this.resolveStarted?.();
    return new Promise((resolve) => {
      this.resolveAuthentication = resolve;
    });
  }

  resolve(response: { success: boolean; error?: string }): void {
    this.resolveAuthentication?.(response);
  }
}

class DevelopmentVault implements SecureVault {
  present = true;
  failDelete = false;
  deleteCalls = 0;

  async saveEncryptedWalletState(_state: EncryptedWalletState): Promise<void> {
    this.present = true;
  }

  async retrieveEncryptedWalletState(): Promise<EncryptedWalletState | null> {
    return null;
  }

  async deleteWalletState(): Promise<void> {
    this.deleteCalls += 1;
    if (this.failDelete) {
      throw new Error('wallet delete failed');
    }
    this.present = false;
  }

  async hasVault(): Promise<boolean> {
    return this.present;
  }

  async isVaultValid(): Promise<boolean> {
    return this.present;
  }
}

async function createLockedManager(options: {
  readonly vault?: DevelopmentVault;
  readonly storage?: MemoryAuthenticationStorage;
} = {}): Promise<{
  readonly access: WalletAccessManager;
  readonly authStorage: MemoryAuthenticationStorage;
  readonly vault: DevelopmentVault;
}> {
  const vault = options.vault ?? new DevelopmentVault();
  const authStorage = options.storage ?? new MemoryAuthenticationStorage();
  const authenticator = new AuthenticationManager({
    storage: authStorage,
    entropyProvider: {
      async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
        return Uint8Array.from({ length: byteCount }, (_, index) => index + 1);
      },
    },
  });
  await authenticator.configurePinAuthentication('482913');
  const access = new WalletAccessManager(
    new LocalWalletEngine(vault, {
      async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
        return Uint8Array.from({ length: byteCount }, (_, index) => index + 1);
      },
    }),
    authenticator,
  );
  assert.equal(await access.initialize(), 'locked');
  assert.equal(authStorage.hasAuthenticationRecord(), true);
  return { access, authStorage, vault };
}

async function createPersistedLockedManager(options: {
  readonly authStorage?: AuthenticationStorage;
  readonly biometricProvider?: BiometricProvider;
} = {}): Promise<{
  readonly access: WalletAccessManager;
  readonly authStorage: AuthenticationStorage;
  readonly biometricProvider?: BiometricProvider;
}> {
  const secureStorage = new MemorySecureStorage();
  const vault = new SecureWalletVault(secureStorage);
  const entropyProvider = {
    async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
      return Uint8Array.from({ length: byteCount }, (_, index) => index + 1);
    },
  };
  const seedEngine = new LocalWalletEngine(vault, entropyProvider);
  await seedEngine.createWallet();
  seedEngine.discard();

  const authStorage =
    options.authStorage ?? new MemoryAuthenticationStorage();
  const authenticator = new AuthenticationManager({
    storage: authStorage,
    entropyProvider,
    biometricProvider: options.biometricProvider,
  });
  await authenticator.configurePinAuthentication('482913');
  if (options.biometricProvider) {
    await authenticator.setBiometricUnlockEnabled(true);
  }

  const access = new WalletAccessManager(
    new LocalWalletEngine(new SecureWalletVault(secureStorage), entropyProvider),
    authenticator,
  );
  assert.equal(await access.initialize(), 'locked');
  return {
    access,
    authStorage,
    biometricProvider: options.biometricProvider,
  };
}

test('reset erases the local vault and authentication record before onboarding', async () => {
  const { access, authStorage, vault } = await createLockedManager();

  await access.resetLocalWallet();

  assert.equal(vault.deleteCalls, 1);
  assert.equal(vault.present, false);
  assert.equal(authStorage.hasAuthenticationRecord(), false);
  assert.equal(
    await authStorage.getItemAsync(AUTHENTICATION_STORAGE_KEY),
    null,
  );
  assert.equal(access.getStatus(), 'onboarding');
});

test('reset remains successful when secondary authentication cleanup fails', async () => {
  const storage = new MemoryAuthenticationStorage();
  storage.failDelete = true;
  const { access, authStorage, vault } = await createLockedManager({
    storage,
  });

  await access.resetLocalWallet();

  assert.equal(vault.present, false);
  assert.equal(authStorage.hasAuthenticationRecord(), true);
  assert.equal(access.getStatus(), 'onboarding');
});

test('reset does not clear authentication or enter onboarding when vault deletion fails', async () => {
  const vault = new DevelopmentVault();
  vault.failDelete = true;
  const { access, authStorage } = await createLockedManager({ vault });

  await assert.rejects(() => access.resetLocalWallet(), /wallet delete failed/);

  assert.equal(authStorage.hasAuthenticationRecord(), true);
  assert.equal(access.getStatus(), 'locked');
});

test('PIN unlock remains stable when AppState changes during restoration', async () => {
  const authStorage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage });
  authStorage.pauseReads = true;

  const unlocking = access.unlockWithPin('482913');
  await authStorage.readStarted;
  await access.handleAppStateChange('inactive');
  await access.handleAppStateChange('active');
  authStorage.release();

  assert.deepEqual(await unlocking, {
    authenticated: true,
    reason: 'success',
  });
  assert.equal(access.getStatus(), 'unlocked');
  assert.ok(access.getWallet().accounts.length > 0);
});

test('biometric unlock uses the same AppState guard as PIN unlock', async () => {
  const biometricProvider = new DeferredBiometrics();
  const { access } = await createPersistedLockedManager({
    biometricProvider,
  });

  const unlocking = access.unlockWithBiometrics();
  await biometricProvider.started;
  await access.handleAppStateChange('inactive');
  await access.handleAppStateChange('active');
  biometricProvider.resolve({ success: true });

  assert.deepEqual(await unlocking, {
    authenticated: true,
    reason: 'success',
  });
  assert.equal(access.getStatus(), 'unlocked');
  assert.ok(access.getWallet().accounts.length > 0);
});

test('unlock completion while backgrounded locks before exposing the wallet', async () => {
  const authStorage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage });
  authStorage.pauseReads = true;

  const unlocking = access.unlockWithPin('482913');
  await authStorage.readStarted;
  await access.handleAppStateChange('background');
  authStorage.release();

  assert.deepEqual(await unlocking, {
    authenticated: false,
    reason: 'locked',
  });
  assert.equal(access.getStatus(), 'locked');
  assert.throws(() => access.getWallet(), /Wallet is locked/);
});

test('normal background locking remains active after unlock completes', async () => {
  const { access } = await createPersistedLockedManager();

  assert.deepEqual(await access.unlockWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
  await access.handleAppStateChange('background');

  assert.equal(access.getStatus(), 'locked');
  assert.throws(() => access.getWallet(), /Wallet is locked/);
});

test('failed authentication clears the unlock guard', async () => {
  const { access } = await createPersistedLockedManager();

  assert.deepEqual(await access.unlockWithPin('00000'), {
    authenticated: false,
    reason: 'rejected',
  });
  assert.equal(access.getStatus(), 'locked');
  assert.deepEqual(await access.unlockWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
});

test('restoration failure returns to a safe locked state', async () => {
  const authStorage = new MemoryAuthenticationStorage();
  const secureStorage = new MemorySecureStorage();
  const vault = new SecureWalletVault(secureStorage);
  const entropyProvider = {
    async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
      return Uint8Array.from({ length: byteCount }, (_, index) => index + 1);
    },
  };
  const authenticator = new AuthenticationManager({
    storage: authStorage,
    entropyProvider,
  });
  await authenticator.configurePinAuthentication('482913');
  const access = new WalletAccessManager(
    new LocalWalletEngine(vault, entropyProvider),
    authenticator,
  );
  access.subscribe(() => undefined);
  assert.equal(await access.initialize(), 'onboarding');

  await assert.rejects(() => access.unlockWithPin('482913'));
  assert.equal(access.getStatus(), 'locked');
  assert.throws(() => access.getWallet(), /Wallet is locked/);
});

test('concurrent unlock attempts do not overlap', async () => {
  const authStorage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage });
  authStorage.pauseReads = true;

  const first = access.unlockWithPin('482913');
  await authStorage.readStarted;
  const second = await access.unlockWithPin('482913');
  assert.deepEqual(second, { authenticated: false, reason: 'locked' });

  authStorage.release();
  assert.deepEqual(await first, {
    authenticated: true,
    reason: 'success',
  });
});

test('access listeners receive the authoritative unlocked transition', async () => {
  const { access } = await createPersistedLockedManager();
  let notifications = 0;
  const unsubscribe = access.subscribe(() => {
    notifications += 1;
  });

  await access.unlockWithPin('482913');
  unsubscribe();

  assert.ok(notifications > 0);
  assert.equal(access.getStatus(), 'unlocked');
  assert.ok(access.getWallet().accounts.length > 0);
});