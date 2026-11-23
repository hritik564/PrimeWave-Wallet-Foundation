import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt } from 'node:crypto';
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

const fixturePin = String(randomInt(100000, 1000000));

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
  await authenticator.configurePinAuthentication(fixturePin);
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
  await authenticator.configurePinAuthentication(fixturePin);
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

  const unlocking = access.unlockWithPin(fixturePin);
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

  const unlocking = access.unlockWithPin(fixturePin);
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

  assert.deepEqual(await access.unlockWithPin(fixturePin), {
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
  assert.deepEqual(await access.unlockWithPin(fixturePin), {
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
  await authenticator.configurePinAuthentication(fixturePin);
  const access = new WalletAccessManager(
    new LocalWalletEngine(vault, entropyProvider),
    authenticator,
  );
  access.subscribe(() => undefined);
  assert.equal(await access.initialize(), 'onboarding');

  await assert.rejects(() => access.unlockWithPin(fixturePin));
  assert.equal(access.getStatus(), 'locked');
  assert.throws(() => access.getWallet(), /Wallet is locked/);
});

test('concurrent unlock attempts do not overlap', async () => {
  const authStorage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage });
  authStorage.pauseReads = true;

  const first = access.unlockWithPin(fixturePin);
  await authStorage.readStarted;
  const second = await access.unlockWithPin(fixturePin);
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

  await access.unlockWithPin(fixturePin);
  unsubscribe();

  assert.ok(notifications > 0);
  assert.equal(access.getStatus(), 'unlocked');
  assert.ok(access.getWallet().accounts.length > 0);
});
test('offline create, confirm, restore and sign from both UI-selected accounts', async (t) => {
  const { walletForSelection } = await import('@/src/components/WalletHomeShell.logic');
  const { confirmationPositions, confirmsBackup } = await import('@/src/core/wallet/backup-confirmation');
  const { NetworkRegistry, supportedNetworks } = await import('@/src/core/networks/registry');
  const { createTransactionConstructionEngine } = await import('@/src/core/transactions/construction');
  const { createEvmRpcProvider } = await import('@/src/core/blockchain/rpc');
  const { createTransactionSigningAuthorization } = await import('@/src/core/transactions/signing');
  const { recoverTransactionAddress } = await import('viem');
  const { randomBytes } = await import('node:crypto');
  const pin = String(randomInt(100000, 1000000));
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork('ethereum');
  const log: string[] = [];
  for (const method of ['info', 'debug', 'warn', 'error'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => log.push(JSON.stringify(args)));
  }
  function fixture() {
    const entropyProvider = { getRandomBytesAsync: async (size: number) => randomBytes(size) };
    const engine = new LocalWalletEngine(new SecureWalletVault(new MemorySecureStorage()), entropyProvider);
    const authenticator = new AuthenticationManager({ storage: new MemoryAuthenticationStorage(), entropyProvider });
    return { engine, access: new WalletAccessManager(engine, authenticator) };
  }

  const created = fixture();
  assert.equal(await created.access.initialize(), 'onboarding');
  const prepared = await created.access.prepareNewWallet();
  const words = prepared.recoveryPhrase.split(' ');
  assert.ok(!confirmsBackup(prepared.recoveryPhrase, ['', '', '']));
  assert.ok(confirmsBackup(prepared.recoveryPhrase, confirmationPositions.map(position => words[position - 1])));
  await created.access.persistPreparedWallet();
  await created.access.configurePin(pin);
  await created.engine.deriveAccount(1);
  await created.access.lockWallet();
  assert.ok((await created.access.unlockWithPin(pin)).authenticated);
  const wallet = created.access.getWallet();
  assert.equal(wallet.accounts.length, 2);
  const restored = fixture();
  await restored.access.initialize();
  await restored.access.prepareImportWallet(prepared.recoveryPhrase);
  await restored.access.persistPreparedWallet();
  await restored.access.configurePin(pin);
  await restored.engine.deriveAccount(1);
  assert.deepEqual((await restored.engine.getAccounts()).map(a => a.address), wallet.accounts.map(a => a.address));
  assert.notEqual(wallet.accounts[0].address, wallet.accounts[1].address);

  const responses: Record<string, unknown> = {
    eth_chainId: '0x1', eth_getTransactionCount: '0x0', eth_estimateGas: '0x5208',
    eth_gasPrice: '0x2', eth_maxPriorityFeePerGas: '0x1', eth_getBlockByNumber: { number: '0x1', baseFeePerGas: '0x1' },
  };
  const provider = await createEvmRpcProvider(registry, { transport: {
    async request(request) {
      const { method, id } = JSON.parse(request.body);
      if (!Object.hasOwn(responses, method)) throw new Error('Unsupported offline fixture operation.');
      return { status: 200, body: { jsonrpc: '2.0', id, result: responses[method] } };
    },
  } });
  const construction = await createTransactionConstructionEngine(registry, provider, wallet.accounts);
  assert.equal(created.access.createSigningSession(registry, { ...wallet, accounts: [] }, 'ethereum', () => true), null);
  assert.equal(created.access.createSigningSession(registry, wallet, 'base', () => true), null);
  for (const selected of wallet.accounts) {
    let current = true;
    const model = walletForSelection(wallet, selected.accountId);
    const session = created.access.createSigningSession(registry, model, 'ethereum', () => current);
    assert.ok(session);
    const { unsignedTransaction: transaction } = await construction.construct({
      networkId: 'ethereum', from: selected.address, to: wallet.accounts[0].address, value: 1n,
    });
    const auth = createTransactionSigningAuthorization({ accountId: selected.accountId, transaction, requestId: 'offline-review', confirmedAt: new Date().toISOString() });
    await assert.rejects(session.sign(transaction, auth));
    const other = wallet.accounts.find(candidate => candidate.accountId !== selected.accountId)!;
    const otherTransaction = (await construction.construct({
      networkId: 'ethereum', from: other.address, to: selected.address, value: 1n,
    })).unsignedTransaction;
    const otherAuthorization = createTransactionSigningAuthorization({
      accountId: other.accountId, transaction: otherTransaction, requestId: 'other-offline-review',
      confirmedAt: new Date().toISOString(),
    });
    assert.ok((await session.authenticateWithPin(pin)).authenticated);
    await assert.rejects(session.sign(otherTransaction, otherAuthorization));
    assert.ok((await session.authenticateWithPin(pin)).authenticated);
    const signing = session.sign(transaction, auth);
    await assert.rejects(session.sign(transaction, auth));
    const result = await signing;
    const signer = await recoverTransactionAddress({ serializedTransaction: result.rawTransaction as never });
    assert.equal(signer.toLowerCase(), selected.address.toLowerCase());
    assert.ok((await session.authenticateWithPin(pin)).authenticated);
    current = false;
    await assert.rejects(session.sign(transaction, auth));
    const next = created.access.createSigningSession(registry, model, 'ethereum', () => true);
    assert.ok(next && (await next.authenticateWithPin(pin)).authenticated);
    registry.selectActiveNetwork('base');
    registry.selectActiveNetwork('ethereum');
    await assert.rejects(next.sign(transaction, auth));
    const beforeLock = created.access.createSigningSession(registry, model, 'ethereum', () => true);
    assert.ok(beforeLock && (await beforeLock.authenticateWithPin(pin)).authenticated);
    await created.access.lockWallet();
    assert.ok((await created.access.unlockWithPin(pin)).authenticated);
    await assert.rejects(beforeLock.sign(transaction, auth));
  }
  const output = log.join('\n');
  assert.ok(!output.includes(pin) && !output.includes(prepared.recoveryPhrase));
  assert.ok(!/\b(?:0x)?[a-f0-9]{64}\b/i.test(output));
});

test('an explicit lock during PIN authentication prevents late wallet restoration', async () => {
  const storage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage: storage });
  storage.pauseReads = true;
  const pending = access.unlockWithPin(fixturePin);
  await storage.readStarted;
  await access.lockWallet();
  storage.pauseReads = false;
  storage.release();
  assert.equal((await pending).authenticated, false);
  assert.throws(() => access.getWallet());
});

test('backgrounding during recovery authentication drops the pending reveal', async () => {
  const storage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage: storage });
  await access.unlockWithPin(fixturePin);
  storage.pauseReads = true;
  const reveal = access.revealRecoveryPhrase(fixturePin);
  await storage.readStarted;
  storage.pauseReads = false;
  await access.handleAppStateChange('background');
  await access.handleAppStateChange('active');
  storage.release();
  await assert.rejects(reveal);
});

test('backgrounding expires signing authentication even on return before auto-lock', async () => {
  const storage = new DeferredAuthenticationStorage();
  const { access } = await createPersistedLockedManager({ authStorage: storage });
  await access.unlockWithPin(fixturePin);
  await access.setAutoLockPolicy(300);
  const { NetworkRegistry, supportedNetworks } = await import('@/src/core/networks/registry');
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork('ethereum');
  const session = access.createSigningSession(registry, access.getWallet(), 'ethereum', () => true);
  assert.ok(session);
  storage.pauseReads = true;
  const pending = session.authenticateWithPin(fixturePin);
  await storage.readStarted;
  storage.pauseReads = false;
  await access.handleAppStateChange('background');
  await access.handleAppStateChange('active');
  storage.release();
  await assert.rejects(pending);
  assert.equal(access.getStatus(), 'unlocked');
  await assert.rejects(session.authenticateWithPin(fixturePin));
});

test('backgrounding during entropy acquisition cancels an unpersisted backup', async () => {
  let release!: (bytes: Uint8Array) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const entropyProvider = { getRandomBytesAsync: () => {
    started();
    return new Promise<Uint8Array>(resolve => { release = resolve; });
  } };
  const vault = new SecureWalletVault(new MemorySecureStorage());
  const engine = new LocalWalletEngine(vault, entropyProvider);
  const access = new WalletAccessManager(engine, new AuthenticationManager({
    storage: new MemoryAuthenticationStorage(), entropyProvider,
  }));
  await access.initialize();
  const pending = access.prepareNewWallet();
  await waiting;
  await access.handleAppStateChange('background');
  await access.handleAppStateChange('active');
  release(new Uint8Array(16));
  await assert.rejects(pending);
  await assert.rejects(access.persistPreparedWallet());
  assert.equal(await vault.hasVault(), false);
  assert.equal(access.getStatus(), 'onboarding');
});
