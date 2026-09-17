import type {
  AccountDerivationRequest,
  SecureVault,
  WalletAuthenticator,
} from '@/src/core/security';
import type { Wallet, WalletAccount } from './models';

export interface WalletEngine {
  createWallet(): Promise<Wallet>;
  deriveAccount(accountIndex?: number): Promise<WalletAccount>;
  getAccounts(): Promise<WalletAccount[]>;
  deriveAccounts(request: AccountDerivationRequest): Promise<WalletAccount[]>;
  validateRecoveryPhrase(recoveryPhrase: string): boolean;
}

export interface WalletSecurityDependencies {
  vault: SecureVault;
  authenticator: WalletAuthenticator;
}