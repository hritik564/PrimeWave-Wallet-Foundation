import assert from 'node:assert/strict';
import test from 'node:test';
import type { EncryptedWalletState, SecureVault } from '@/src/core/security';
import { LocalWalletEngine } from '../local-wallet-engine';
import {
  consumeEncryptedWalletState,
  createEncryptedWalletState,
  CURRENT_VAULT_VERSION,
  SecureWalletVault,
  type SecureKeyValueStorage,
  type WalletVaultRecord,
  WalletVaultError,
} from '../internal/vault';

class MemorySecureStorage implements SecureKeyValueStorage {
  value: string | null = null;
  available = true;
  failDeleteWhenEmpty = false;

  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    this.value = value;
  }

  async getItemAsync(_key: string): Promise<string | null> {
    return this.value;
  }

  async deleteItemAsync(_key: string): Promise<void> {
    if (this.failDeleteWhenEmpty && this.value === null) {
      throw new Error('item not found');
    }
    this.value = null;
  }
}

class DeterministicEntropyProvider {
  async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
    return new Uint8Array(byteCount);
  }
}

function createRecord(
  overrides: Partial<WalletVaultRecord> = {},
): WalletVaultRecord {
  return {
    walletId: 'wallet-test',
    createdAt: '2026-09-17T00:00:00.000Z',
    accountIndexes: [0],
    mnemonic:
      'test test test test test test test test test test test junk',
    ...overrides,
  };
}

function createVaultHarness() {
  const storage = new MemorySecureStorage();
  return {
    storage,
    vault: new SecureWalletVault(storage),
  };
}

test('persists and restores the wallet across engine instances', async () => {
  const { storage, vault } = createVaultHarness();
  const entropy = new DeterministicEntropyProvider();
  const firstEngine = new LocalWalletEngine(vault, entropy);

  const created = await firstEngine.createWallet();
  const accountOne = await firstEngine.deriveAccount(1);
  firstEngine.discard();

  const restoredEngine = new LocalWalletEngine(
    new SecureWalletVault(storage),
    entropy,
  );
  assert.equal(await restoredEngine.hasPersistedWallet(), true);

  const restored = await restoredEngine.loadWallet();

  assert.ok(restored);
  assert.deepEqual(
    restored.accounts.map((account) => account.address),
    [created.accounts[0].address, accountOne.address],
  );
  assert.deepEqual(
    restored.accounts.map((account) => account.index),
    [0, 1],
  );
});

test('prepares a generated wallet without persisting it before backup confirmation', async () => {
  const { vault } = createVaultHarness();
  const engine = new LocalWalletEngine(vault, new DeterministicEntropyProvider());

  const prepared = await engine.prepareWallet();

  assert.equal(prepared.recoveryPhrase.split(' ').length, 12);
  assert.equal(await engine.hasPersistedWallet(), false);

  await engine.persistPreparedWallet();
  assert.equal(await engine.hasPersistedWallet(), true);
});

test('imports a normalized BIP-39 phrase and preserves the known address vector', async () => {
  const { storage, vault } = createVaultHarness();
  const engine = new LocalWalletEngine(vault, new DeterministicEntropyProvider());
  const phrase = '  TEST test test test test test test test test test test junk  ';

  const prepared = await engine.prepareImportWallet(phrase);

  assert.equal(
    prepared.accounts[0].address,
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  );
  assert.equal(await engine.hasPersistedWallet(), false);

  await engine.persistPreparedWallet();
  const restored = await new LocalWalletEngine(
    new SecureWalletVault(storage),
    new DeterministicEntropyProvider(),
  ).loadWallet();

  assert.equal(restored?.accounts[0].address, prepared.accounts[0].address);
});

test('missing vaults return safe empty status', async () => {
  const { vault } = createVaultHarness();

  assert.equal(await vault.hasVault(), false);
  assert.equal(await vault.retrieveEncryptedWalletState(), null);
  assert.equal(await vault.isVaultValid(), false);
});

test('secure vault rejects unavailable storage', async () => {
  const { storage, vault } = createVaultHarness();
  storage.available = false;

  await assert.rejects(
    () =>
      vault.saveEncryptedWalletState(
        createEncryptedWalletState(createRecord()),
      ),
    (error: unknown) =>
      error instanceof WalletVaultError &&
      error.code === 'STORAGE_UNAVAILABLE',
  );
});

test('secure vault detects malformed and unsupported stored data', async () => {
  const { storage, vault } = createVaultHarness();

  storage.value = '{not-json';
  await assert.rejects(
    () => vault.retrieveEncryptedWalletState(),
    (error: unknown) =>
      error instanceof WalletVaultError &&
      error.code === 'MALFORMED_VAULT',
  );

  storage.value = JSON.stringify({
    vaultVersion: CURRENT_VAULT_VERSION + 1,
    wallet: {
      walletId: 'wallet-test',
      createdAt: '2026-09-17T00:00:00.000Z',
      accountIndexes: [0],
    },
    secret: {
      mnemonic:
        'test test test test test test test test test test test junk',
    },
  });

  await assert.rejects(
    () => vault.retrieveEncryptedWalletState(),
    (error: unknown) =>
      error instanceof WalletVaultError &&
      error.code === 'UNSUPPORTED_VAULT_VERSION',
  );
  assert.equal(await vault.isVaultValid(), false);

  storage.value = JSON.stringify({
    vaultVersion: CURRENT_VAULT_VERSION,
    wallet: {
      walletId: 'wallet-test',
      createdAt: '2026-09-17T00:00:00.000Z',
      accountIndexes: [0],
    },
    secret: {
      mnemonic: 'corrupted recovery phrase',
    },
  });

  await assert.rejects(
    () => vault.retrieveEncryptedWalletState(),
    (error: unknown) =>
      error instanceof WalletVaultError &&
      error.code === 'INVALID_VAULT_STATE' &&
      error.message === 'The wallet vault state is invalid.',
  );
});

test('public vault handles do not expose secret fields', () => {
  const state: EncryptedWalletState = createEncryptedWalletState(
    createRecord(),
  );

  assert.equal('mnemonic' in state, false);
  const record = consumeEncryptedWalletState(state);
  assert.equal(record.mnemonic.length > 0, true);
});

test('deletes the persisted vault without exposing its contents', async () => {
  const { vault } = createVaultHarness();
  await vault.saveEncryptedWalletState(
    createEncryptedWalletState(createRecord()),
  );

  await vault.deleteWalletState();

  assert.equal(await vault.hasVault(), false);
});

test('treats deletion of an already-erased vault as successful', async () => {
  const storage = new MemorySecureStorage();
  storage.failDeleteWhenEmpty = true;
  const vault = new SecureWalletVault(storage);

  await vault.deleteWalletState();

  assert.equal(await vault.hasVault(), false);
});