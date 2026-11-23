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
import {
  MessageSigningEngine,
  type DAppMessageSigningAuthorization,
  type DAppTypedDataDocument,
} from '@/src/core/dapp/signing';

export type WalletAccessListener = () => void;

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
  private lifecycleRevision = 0;
  private lockRevision = 0;
  private backgrounded = false;
  private signing = false;
  private persisting = false;
  private readonly listeners = new Set<WalletAccessListener>();

  constructor(
    engine = new LocalWalletEngine(),
    authenticator?: AuthenticationManager,
  ) {
    this.engine = engine;
    this.authenticator =
      authenticator ??
      new AuthenticationManager({
        onLock: () => {
          this.lockRevision++;
          this.lifecycleRevision++;
          this.engine.discard();
          this.currentWallet = null;
          this.status = 'locked';
          this.notifyStateChange();
        },
      });
  }

  getStatus(): WalletAccessStatus {
    return this.status;
  }

  getLockState(): WalletLockState {
    return this.authenticator.getLockState();
  }

  subscribe(listener: WalletAccessListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<WalletAccessStatus> {
    try {
      if (!(await this.engine.hasPersistedWallet())) {
        this.status = 'onboarding';
        this.notifyStateChange();
        return this.status;
      }

      if (!(await this.authenticator.isPinConfigured())) {
        this.status = 'authentication-setup';
        this.notifyStateChange();
        return this.status;
      }

      await this.authenticator.lockWallet();
      this.engine.discard();
      this.currentWallet = null;
      this.status = 'locked';
      this.notifyStateChange();
      return this.status;
    } catch {
      this.status = 'unavailable';
      this.notifyStateChange();
      return this.status;
    }
  }

  async prepareNewWallet(): Promise<WalletSetupResult> {
    this.requireStatus('onboarding');
    if (this.backgrounded || this.persisting) throw new Error('Wallet setup is unavailable.');
    return this.engine.prepareWallet();
  }

  async prepareImportWallet(recoveryPhrase: string): Promise<Wallet> {
    this.requireStatus('onboarding');
    if (this.backgrounded || this.persisting) throw new Error('Wallet setup is unavailable.');
    return this.engine.prepareImportWallet(recoveryPhrase);
  }

  async persistPreparedWallet(): Promise<Wallet> {
    this.requireStatus('onboarding');
    if (this.backgrounded || this.persisting) throw new Error('Wallet setup is unavailable.');
    this.persisting = true;
    let wallet: Wallet;
    try {
      wallet = await this.engine.persistPreparedWallet();
      this.engine.discard();
    } finally {
      this.persisting = false;
      if (this.backgrounded) this.engine.discard();
    }
    this.currentWallet = wallet;
    this.status = 'authentication-setup';
    this.notifyStateChange();
    return wallet;
  }

  async configurePin(pin: string): Promise<void> {
    this.requireStatus('authentication-setup');
    const revision = this.lifecycleRevision;
    await this.authenticator.configurePinAuthentication(pin);
    const wallet = await this.engine.loadWallet();
    if (!wallet) {
      throw new Error('The wallet could not be restored.');
    }
    if (this.backgrounded || revision !== this.lifecycleRevision) {
      await this.lockWallet();
      return;
    }
    this.currentWallet = wallet;
    this.status = 'unlocked';
    this.notifyStateChange();
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
    this.notifyStateChange();
  }

  async unlockWithPin(pin: string): Promise<AuthenticationResult> {
    return this.unlock(() => this.authenticator.authenticateWithPin(pin));
  }

  async unlockWithBiometrics(): Promise<AuthenticationResult> {
    return this.unlock(() => this.authenticator.authenticateWithBiometrics());
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

  createSigningSession(registry: NetworkRegistry, wallet: Wallet, networkId: string, isReviewCurrent: () => boolean) {
    const selected = wallet.accounts[0];
    const network = registry.getActiveNetwork();
    if (!selected || network?.id !== networkId || network.configurationStatus !== 'configured' ||
        network.chainId === null || this.currentWallet?.walletId !== wallet.walletId ||
        !this.currentWallet.accounts.some(account => account.accountId === selected.accountId && account.address === selected.address) ||
        this.status !== 'unlocked' || this.backgrounded) return null;

    const revision = this.lifecycleRevision;
    const selectionRevision = registry.getSelectionRevision();
    const current = () => selectionRevision === registry.getSelectionRevision() && revision === this.lifecycleRevision && !this.backgrounded &&
      this.status === 'unlocked' && isReviewCurrent() && registry.getActiveNetwork()?.id === networkId;
    const assertCurrent = () => {
      if (!current()) throw new Error('Transaction review expired.');
    };
    let authenticated = false;
    let authenticating = false;
    const authenticate = async (verify: () => Promise<AuthenticationResult>): Promise<AuthenticationResult> => {
      assertCurrent();
      if (authenticating) return { authenticated: false, reason: 'locked' };
      authenticated = false;
      authenticating = true;
      try {
        const result = await verify();
        assertCurrent();
        authenticated = result.authenticated;
        return result;
      } finally {
        authenticating = false;
      }
    };
    const engine = new TransactionSigningEngine(registry, {
      signWithCapability: (...args) => {
        assertCurrent();
        return this.engine.signWithCapability(...args);
      },
    }, { authenticator: this.authenticator, accounts: [selected] });
    return {
      getBiometricAvailability: () => this.getBiometricAvailability(),
      authenticateWithPin: (pin: string) => authenticate(() => this.authenticator.authenticateWithPin(pin)),
      authenticateWithBiometrics: () => authenticate(() => this.authenticator.authenticateWithBiometrics()),
      sign: async (transaction: UnsignedTransaction, authorization: TransactionSigningAuthorization): Promise<SignedTransaction> => {
        assertCurrent();
        if (!authenticated || this.signing) throw new Error('Fresh signing authorization required.');
        authenticated = false;
        this.signing = true;
        try {
          const result = await engine.sign(transaction, authorization);
          assertCurrent();
          return result;
        } finally {
          this.signing = false;
        }
      },
    };
  }

  async signDAppPersonalMessage(
    registry: NetworkRegistry,
    input: {
      readonly requestId: string;
      readonly accountId: string;
      readonly from: string;
      readonly networkId: string;
      readonly chainId: bigint;
      readonly message: `0x${string}`;
      readonly confirmedAt?: string;
    },
  ): Promise<`0x${string}`> {
    if (this.status !== 'unlocked' || !this.currentWallet) {
      throw new Error('Wallet authentication is required before signing.');
    }
    const engine = new MessageSigningEngine(registry, this.engine, {
      authenticator: this.authenticator,
      accounts: this.currentWallet.accounts,
    });
    return engine.signPersonalMessage(input);
  }

  async signDAppTypedData(
    registry: NetworkRegistry,
    input: {
      readonly requestId: string;
      readonly accountId: string;
      readonly from: string;
      readonly networkId: string;
      readonly chainId: bigint;
      readonly rawPayload: string;
      readonly typedData: DAppTypedDataDocument;
      readonly confirmedAt?: string;
    },
  ): Promise<`0x${string}`> {
    if (this.status !== 'unlocked' || !this.currentWallet) {
      throw new Error('Wallet authentication is required before signing.');
    }
    const engine = new MessageSigningEngine(registry, this.engine, {
      authenticator: this.authenticator,
      accounts: this.currentWallet.accounts,
    });
    return engine.signTypedData(input);
  }

  async revealRecoveryPhrase(currentPin: string): Promise<string> {
    this.requireStatus('unlocked');
    if (this.backgrounded) throw new Error('Wallet is in the background.');
    const revision = this.lifecycleRevision;
    const result = await this.authenticator.authenticateWithPin(currentPin);
    if (!result.authenticated || this.backgrounded || revision !== this.lifecycleRevision || this.status !== 'unlocked') {
      throw new Error('Authentication failed.');
    }
    return this.engine.getRecoveryPhraseForAuthenticatedSession();
  }

  async lockWallet(): Promise<void> {
    this.lockRevision++;
    this.lifecycleRevision++;
    await this.authenticator.lockWallet();
    this.engine.discard();
    this.currentWallet = null;
    this.status = 'locked';
    this.notifyStateChange();
  }

  async handleAppStateChange(
    nextState: 'active' | 'background' | 'inactive',
  ): Promise<void> {
    this.backgrounded = nextState !== 'active';
    if (this.backgrounded) this.lifecycleRevision++;
    if (this.status === 'onboarding' || this.status === 'authentication-setup') {
      if (this.backgrounded && !this.persisting) this.engine.discard();
      return;
    }
    await this.authenticator.handleAppStateChange(nextState);
    if (nextState !== 'active' && this.authenticator.getLockState() === 'LOCKED') {
      this.engine.discard();
      this.currentWallet = null;
      this.status = 'locked';
      this.notifyStateChange();
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

  private async unlock(
    authenticate: () => Promise<AuthenticationResult>,
  ): Promise<AuthenticationResult> {
    const lockRevision = this.lockRevision;
    if (this.backgrounded || !this.authenticator.beginUnlockTransaction()) {
      return { authenticated: false, reason: 'locked' };
    }

    try {
      const result = await authenticate();
      if (!result.authenticated) {
        this.authenticator.cancelUnlockTransaction();
        return result;
      }

      const wallet = await this.restoreUnlockedWallet();
      if (lockRevision !== this.lockRevision) {
        this.authenticator.cancelUnlockTransaction();
        await this.lockWallet();
        return { authenticated: false, reason: 'locked' };
      }
      const exposed = await this.authenticator.finishUnlockTransaction(() => {
        this.currentWallet = wallet;
        this.status = 'unlocked';
      });

      if (!exposed) {
        this.engine.discard();
        this.currentWallet = null;
        this.status = 'locked';
        this.notifyStateChange();
        return { authenticated: false, reason: 'locked' };
      }

      this.notifyStateChange();
      return result;
    } catch (error) {
      this.authenticator.cancelUnlockTransaction();
      this.engine.discard();
      this.currentWallet = null;
      this.status = 'locked';
      this.notifyStateChange();
      await this.authenticator.lockWallet();
      throw error;
    }
  }

  private async restoreUnlockedWallet(): Promise<Wallet> {
    const wallet = await this.engine.loadWallet();
    if (!wallet) {
      this.status = 'unavailable';
      throw new Error('The wallet could not be restored.');
    }
    return wallet;
  }

  private notifyStateChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
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