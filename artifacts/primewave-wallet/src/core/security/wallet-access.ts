import type { AuthenticationResult, BiometricAvailability } from './contracts';
import { secureLogger } from './logging';
import {
  AuthenticationManager,
  type AuthenticationSettings,
  type AutoLockPolicy,
  type WalletLockState,
} from './authentication';
import { LocalWalletEngine } from '@/src/core/wallet/local-wallet-engine';
import type { WalletSetupResult } from '@/src/core/wallet/contracts';
import type { Wallet } from '@/src/core/wallet/models';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import {
  TransactionSigningEngine,
  type SignedTransaction,
  type TransactionSigningAuthorization,
} from '@/src/core/transactions/signing';
import type { UnsignedTransaction } from '@/src/core/transactions/construction';

export type WalletAccessStatus =
  | 'loading'
  | 'onboarding'
  | 'authentication-setup'
  | 'locked'
  | 'unlocked'
  | 'unavailable';

export class WalletAccessManager {
  private readonly engine: LocalWalletEngine;
  private readonly authenticator: AuthenticationManager;
  private status: WalletAccessStatus = 'loading';
  private currentWallet: Wallet | null = null;

  constructor(
    engine = new LocalWalletEngine(),
    authenticator?: AuthenticationManager,
  ) {
    this.engine = engine;
    this.authenticator =
      authenticator ??
      new AuthenticationManager({
        onLock: () => {
          this.engine.discard();
          this.currentWallet = null;
          this.status = 'locked';
        },
      });
  }

  getStatus(): WalletAccessStatus {
    return this.status;
  }

  getLockState(): WalletLockState {
    return this.authenticator.getLockState();
  }

  async initialize(): Promise<WalletAccessStatus> {
    try {
      if (!(await this.engine.hasPersistedWallet())) {
        this.status = 'onboarding';
        return this.status;
      }

      if (!(await this.authenticator.isPinConfigured())) {
        this.status = 'authentication-setup';
        return this.status;
      }

      await this.authenticator.lockWallet();
      this.engine.discard();
      this.currentWallet = null;
      this.status = 'locked';
      return this.status;
    } catch {
      this.status = 'unavailable';
      return this.status;
    }
  }

  async prepareNewWallet(): Promise<WalletSetupResult> {
    this.requireStatus('onboarding');
    return this.engine.prepareWallet();
  }

  async prepareImportWallet(recoveryPhrase: string): Promise<Wallet> {
    this.requireStatus('onboarding');
    return this.engine.prepareImportWallet(recoveryPhrase);
  }

  async persistPreparedWallet(): Promise<Wallet> {
    const wallet = await this.engine.persistPreparedWallet();
    this.currentWallet = wallet;
    this.status = 'authentication-setup';
    return wallet;
  }

  async configurePin(pin: string): Promise<void> {
    await this.authenticator.configurePinAuthentication(pin);
    const wallet = await this.engine.loadWallet();
    if (!wallet) {
      throw new Error('The wallet could not be restored.');
    }
    this.currentWallet = wallet;
    this.status = 'unlocked';
  }

  async resetLocalWallet(): Promise<void> {
    await this.engine.deleteWallet();
    try {
      await this.authenticator.clearAuthenticationState();
    } catch {
      secureLogger.warning('Local preview authentication cleanup deferred', {
        cleanup: 'authentication',
      });
    }
    this.currentWallet = null;
    this.status = 'onboarding';
  }

  async unlockWithPin(pin: string): Promise<AuthenticationResult> {
    const result = await this.authenticator.authenticateWithPin(pin);
    if (result.authenticated) {
      await this.restoreUnlockedWallet();
    }
    return result;
  }

  async unlockWithBiometrics(): Promise<AuthenticationResult> {
    const result = await this.authenticator.authenticateWithBiometrics();
    if (result.authenticated) {
      await this.restoreUnlockedWallet();
    }
    return result;
  }

  async enableBiometricUnlock(
    enabled: boolean,
    currentPin: string,
  ): Promise<AuthenticationResult> {
    const result = await this.authenticator.authenticateWithPin(currentPin);
    if (!result.authenticated) {
      return result;
    }
    await this.authenticator.setBiometricUnlockEnabled(enabled);
    return result;
  }

  async changePin(
    currentPin: string,
    nextPin: string,
  ): Promise<AuthenticationResult> {
    return this.authenticator.changePin(currentPin, nextPin);
  }

  async setAutoLockPolicy(policy: AutoLockPolicy): Promise<void> {
    await this.authenticator.setAutoLockPolicy(policy);
  }

  async getAuthenticationSettings(): Promise<AuthenticationSettings> {
    return this.authenticator.getSettings();
  }

  async getBiometricAvailability(): Promise<BiometricAvailability> {
    return this.authenticator.determineBiometricAvailability();
  }

  async signTransaction(
    registry: NetworkRegistry,
    transaction: UnsignedTransaction,
    authorization: TransactionSigningAuthorization,
  ): Promise<SignedTransaction> {
    if (this.status !== 'unlocked' || !this.currentWallet) {
      throw new Error('Wallet authentication is required before signing.');
    }

    const signingEngine = new TransactionSigningEngine(registry, this.engine, {
      authenticator: this.authenticator,
      accounts: this.currentWallet.accounts,
    });
    return signingEngine.sign(transaction, authorization);
  }

  async revealRecoveryPhrase(currentPin: string): Promise<string> {
    const result = await this.authenticator.authenticateWithPin(currentPin);
    if (!result.authenticated) {
      throw new Error('Authentication failed.');
    }
    return this.engine.getRecoveryPhraseForAuthenticatedSession();
  }

  async lockWallet(): Promise<void> {
    await this.authenticator.lockWallet();
    this.engine.discard();
    this.currentWallet = null;
    this.status = 'locked';
  }

  async handleAppStateChange(
    nextState: 'active' | 'background' | 'inactive',
  ): Promise<void> {
    await this.authenticator.handleAppStateChange(nextState);
    if (nextState !== 'active' && this.authenticator.getLockState() === 'LOCKED') {
      this.engine.discard();
      this.currentWallet = null;
      this.status = 'locked';
    }
  }

  getWallet(): Wallet {
    if (this.status !== 'unlocked' || !this.currentWallet) {
      throw new Error('Wallet is locked.');
    }
    return {
      ...this.currentWallet,
      accounts: this.currentWallet.accounts.map((account) => ({ ...account })),
    };
  }

  private async restoreUnlockedWallet(): Promise<void> {
    const wallet = await this.engine.loadWallet();
    if (!wallet) {
      this.status = 'unavailable';
      throw new Error('The wallet could not be restored.');
    }
    this.currentWallet = wallet;
    this.status = 'unlocked';
  }

  private requireStatus(expected: WalletAccessStatus): void {
    if (this.status !== expected) {
      throw new Error('The wallet is not ready for that operation.');
    }
  }
}

let walletAccessManager: WalletAccessManager | null = null;

export function getWalletAccessManager(): WalletAccessManager {
  walletAccessManager ??= new WalletAccessManager();
  return walletAccessManager;
}