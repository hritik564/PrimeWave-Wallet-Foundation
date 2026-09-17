import type {
  AccountDerivationRequest,
  SecureVault,
  WalletAuthenticator,
} from '@/src/core/security/contracts';
import type { Wallet, WalletAccount } from './models';

export interface WalletSetupResult {
  wallet: Wallet;
  recoveryPhrase: string;
}

export interface WalletEngine {
  createWallet(): Promise<Wallet>;
  prepareWallet(): Promise<WalletSetupResult>;
  prepareImportWallet(recoveryPhrase: string): Promise<Wallet>;
  persistPreparedWallet(): Promise<Wallet>;
  importWallet(recoveryPhrase: string): Promise<Wallet>;
  loadWallet(): Promise<Wallet | null>;
  deriveAccount(accountIndex?: number): Promise<WalletAccount>;
  getAccounts(): Promise<WalletAccount[]>;
  deriveAccounts(request: AccountDerivationRequest): Promise<WalletAccount[]>;
  validateRecoveryPhrase(recoveryPhrase: string): boolean;
  hasPersistedWallet(): Promise<boolean>;
  deleteWallet(): Promise<void>;
}

export interface WalletSecurityDependencies {
  vault: SecureVault;
  authenticator: WalletAuthenticator;
}