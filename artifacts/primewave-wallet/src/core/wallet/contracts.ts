import type {
  AccountDerivationRequest,
  SecureVault,
  WalletAccount,
  WalletAuthenticator,
} from '@/src/core/security';
import type {
  TransactionPreview,
  TransactionRequest,
  UserConfirmation,
} from '@/src/core/transactions/contracts';

export interface WalletEngine {
  getAccounts(): Promise<WalletAccount[]>;
  deriveAccounts(request: AccountDerivationRequest): Promise<WalletAccount[]>;
  previewTransaction(
    request: TransactionRequest,
  ): Promise<TransactionPreview>;
  signAfterExplicitConfirmation(
    preview: TransactionPreview,
    confirmation: UserConfirmation,
  ): Promise<void>;
}

export interface WalletSecurityDependencies {
  vault: SecureVault;
  authenticator: WalletAuthenticator;
}