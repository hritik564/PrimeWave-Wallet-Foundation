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

type InMemorySecretState = {
  mnemonic: string;
};

const secretStates = new WeakMap<LocalWalletEngine, InMemorySecretState>();

export class LocalWalletEngine implements WalletEngine {
  private accounts: WalletAccount[] = [];
  private createdAt: string | null = null;

  async createWallet(): Promise<Wallet> {
    secureLogger.info('Wallet core creation started');
    this.discard();

    // 128 bits produces a standard 12-word BIP-39 phrase.
    const entropy = await Crypto.getRandomBytesAsync(16);
    try {
      const mnemonic = entropyToMnemonic(entropy, wordlist);
      const firstAccount = derivePublicAccountFromMnemonic(mnemonic, 0);
      const createdAt = new Date().toISOString();

      secretStates.set(this, { mnemonic });
      this.accounts = [firstAccount];
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

  discard(): void {
    const state = secretStates.get(this);
    if (state) {
      state.mnemonic = '';
    }
    secretStates.delete(this);
    this.accounts = [];
    this.createdAt = null;
  }

  private toWalletModel(): Wallet {
    if (!this.createdAt) {
      throw new WalletCoreError(
        'WALLET_NOT_CREATED',
        'Create a wallet before reading wallet metadata.',
      );
    }

    return {
      walletId: `wallet-${this.createdAt}`,
      createdAt: this.createdAt,
      accountCount: this.accounts.length,
      accounts: this.accounts.map((account) => ({ ...account })),
    };
  }
}