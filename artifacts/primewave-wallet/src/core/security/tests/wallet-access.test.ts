import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHENTICATION_STORAGE_KEY,
  AuthenticationManager,
  type AuthenticationStorage,
} from '../authentication';
import { WalletAccessManager } from '../wallet-access';
import type { EncryptedWalletState, SecureVault } from '../contracts';
import { LocalWalletEngine } from '@/src/core/wallet/local-wallet-engine';

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