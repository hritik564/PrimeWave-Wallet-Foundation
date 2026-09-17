import * as Crypto from 'expo-crypto';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { secureLogger } from '@/src/core/security';
import type { AccountDerivationRequest } from '@/src/core/security';
import type { WalletEngine } from './contracts';
import type { Wallet, WalletAccount } from './models';
import {
  derivePublicAccountFromMnemonic,
  EVM_DERIVATION_PREFIX,
  validateRecoveryPhrase,
  WalletCoreError,
} from './derivation';
import {
  consumeEncryptedWalletState,
  createEncryptedWalletState,
  type WalletVaultRecord,
} from './internal/vault';
import type { SecureVault } from '@/src/core/security';

type InMemorySecretState = {
  mnemonic: string;
};

const secretStates = new WeakMap<LocalWalletEngine, InMemorySecretState>();

export class LocalWalletEngine implements WalletEngine {
  private accounts: WalletAccount[] = [];
  private walletId: string | null = null;
  private createdAt: string | null = null;
  private readonly vaultPromise: Promise<SecureVault>;

  constructor(vault?: SecureVault) {
    this.vaultPromise = vault
      ? Promise.resolve(vault)
      : import('./internal/expo-secure-wallet-vault').then(
          ({ createExpoSecureWalletVault }) => createExpoSecureWalletVault(),
        );
  }

  async createWallet(): Promise<Wallet> {
    secureLogger.info('Wallet core creation started');
    this.discard();

    // 128 bits produces a standard 12-word BIP-39 phrase.
    const entropy = await Crypto.getRandomBytesAsync(16);
    try {
      const mnemonic = entropyToMnemonic(entropy, wordlist);
      const firstAccount = derivePublicAccountFromMnemonic(mnemonic, 0);
      const createdAt = new Date().toISOString();
      const walletId = `wallet-${createdAt}`;
      const vault = await this.getVault();

      await vault.saveEncryptedWalletState(
        createEncryptedWalletState({
          walletId,
          createdAt,
          accountIndexes: [0],
          mnemonic,
        }),
      );

      secretStates.set(this, { mnemonic });
      this.accounts = [firstAccount];
      this.walletId = walletId;
      this.createdAt = createdAt;

      secureLogger.info('Wallet core created', {
        accountIndex: 0,
        derivationPath: `${EVM_DERIVATION_PREFIX}/0`,
      });

      return this.toWalletModel();
    } finally {
      entropy.fill(0);
    }
  }

  async loadWallet(): Promise<Wallet | null> {
    this.discard();
    const state = await (await this.getVault()).retrieveEncryptedWalletState();

    if (!state) {
      return null;
    }

    const record = consumeEncryptedWalletState(state);

    try {
      const accounts = record.accountIndexes.map((accountIndex) =>
        derivePublicAccountFromMnemonic(record.mnemonic, accountIndex),
      );

      secretStates.set(this, { mnemonic: record.mnemonic });
      this.accounts = accounts;
      this.walletId = record.walletId;
      this.createdAt = record.createdAt;

      secureLogger.info('Wallet vault loaded', {
        accountCount: accounts.length,
        vaultVersion: 1,
      });

      return this.toWalletModel();
    } catch {
      throw new WalletCoreError(
        'DERIVATION_FAILED',
        'The wallet could not be restored.',
      );
    } finally {
      record.mnemonic = '';
    }
  }

  async deriveAccount(accountIndex = 0): Promise<WalletAccount> {
    const state = secretStates.get(this);

    if (!state) {
      throw new WalletCoreError(
        'WALLET_NOT_CREATED',
        'Create a wallet before deriving accounts.',
      );
    }

    const account = derivePublicAccountFromMnemonic(
      state.mnemonic,
      accountIndex,
    );
    this.accounts = [
      ...this.accounts.filter((existing) => existing.index !== accountIndex),
      account,
    ].sort((left, right) => left.index - right.index);

    const walletId = this.walletId;
    const createdAt = this.createdAt;

    if (!walletId || !createdAt) {
      throw new WalletCoreError(
        'WALLET_NOT_CREATED',
        'Create or load a wallet before deriving accounts.',
      );
    }

    const vault = await this.getVault();
    await vault.saveEncryptedWalletState(
      createEncryptedWalletState({
        walletId,
        createdAt,
        accountIndexes: this.accounts.map((existing) => existing.index),
        mnemonic: state.mnemonic,
      }),
    );

    secureLogger.info('Wallet account derived', {
      accountIndex,
      derivationPath: account.derivationPath,
    });

    return account;
  }

  async getAccounts(): Promise<WalletAccount[]> {
    return this.accounts.map((account) => ({ ...account }));
  }

  async deriveAccounts(
    request: AccountDerivationRequest,
  ): Promise<WalletAccount[]> {
    return [await this.deriveAccount(request.accountIndex)];
  }

  validateRecoveryPhrase(recoveryPhrase: string): boolean {
    return validateRecoveryPhrase(recoveryPhrase);
  }

  async hasPersistedWallet(): Promise<boolean> {
    return (await this.getVault()).hasVault();
  }

  async deleteWallet(): Promise<void> {
    await (await this.getVault()).deleteWalletState();
    this.discard();
    secureLogger.info('Wallet vault deleted');
  }

  discard(): void {
    const state = secretStates.get(this);
    if (state) {
      state.mnemonic = '';
    }
    secretStates.delete(this);
    this.accounts = [];
    this.walletId = null;
    this.createdAt = null;
  }

  private async getVault(): Promise<SecureVault> {
    return this.vaultPromise;
  }

  private toWalletModel(): Wallet {
    if (!this.createdAt || !this.walletId) {
      throw new WalletCoreError(
        'WALLET_NOT_CREATED',
        'Create a wallet before reading wallet metadata.',
      );
    }

    return {
      walletId: this.walletId,
      createdAt: this.createdAt,
      accountCount: this.accounts.length,
      accounts: this.accounts.map((account) => ({ ...account })),
    };
  }
}