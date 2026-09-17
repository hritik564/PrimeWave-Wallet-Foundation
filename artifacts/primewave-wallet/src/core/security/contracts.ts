/**
 * Security contracts only.
 *
 * These opaque types intentionally cannot be constructed by UI components.
 * Phase 0B defines the boundary; a later phase will provide reviewed,
 * platform-specific implementations.
 */

export type EncryptedWalletState = {
  readonly kind: 'encrypted-wallet-state';
  readonly __opaque: unique symbol;
};

export type ProtectedSecretMaterial = {
  readonly kind: 'protected-secret-material';
  readonly __opaque: unique symbol;
};

export type ProtectedAuthInput = {
  readonly kind: 'protected-auth-input';
  readonly __opaque: unique symbol;
};

export type SigningCapability = {
  readonly kind: 'signing-capability';
  readonly __opaque: unique symbol;
};

export interface ExplicitSigningAuthorization {
  requestId: string;
  approved: true;
  confirmedAt: string;
}

export interface SecureVault {
  saveEncryptedWalletState(state: EncryptedWalletState): Promise<void>;
  retrieveEncryptedWalletState(): Promise<EncryptedWalletState | null>;
  deleteWalletState(): Promise<void>;
  hasVault(): Promise<boolean>;
}

export type BiometricType = 'face' | 'fingerprint' | 'iris' | 'unknown';

export interface BiometricAvailability {
  available: boolean;
  type: BiometricType | null;
}

export interface AuthenticationResult {
  authenticated: boolean;
  reason:
    | 'success'
    | 'cancelled'
    | 'unavailable'
    | 'locked'
    | 'rejected'
    | 'not-configured';
}

export interface WalletAuthenticator {
  configurePinAuthentication(input: ProtectedAuthInput): Promise<void>;
  authenticateWithPin(input: ProtectedAuthInput): Promise<AuthenticationResult>;
  authenticateWithBiometrics(): Promise<AuthenticationResult>;
  determineBiometricAvailability(): Promise<BiometricAvailability>;
  lockWallet(): Promise<void>;
  unlockWallet(): Promise<AuthenticationResult>;
}

export interface SecretManager {
  createProtectedSecretMaterial(): Promise<ProtectedSecretMaterial>;
  accessProtectedSecretMaterial(): Promise<ProtectedSecretMaterial>;
  clearSecretMaterialFromMemory(
    material: ProtectedSecretMaterial,
  ): Promise<void>;
}

export interface KeyManager {
  deriveWalletAccounts(request: AccountDerivationRequest): Promise<WalletAccount[]>;
  accessSigningCapability(
    accountId: string,
    authorization: ExplicitSigningAuthorization,
  ): Promise<SigningCapability>;
  signTransaction(
    capability: SigningCapability,
    transaction: UnsignedTransaction,
    authorization: ExplicitSigningAuthorization,
  ): Promise<SignedTransaction>;
}

export interface AccountDerivationRequest {
  accountIndex: number;
  accountType: 'evm';
}

export interface WalletAccount {
  id: string;
  address: string;
  derivationIndex: number;
}

export interface UnsignedTransaction {
  requestId: string;
  chainId: number;
  to: string;
  value: string;
  data: string | null;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export type SignedTransaction = {
  readonly kind: 'signed-transaction';
  readonly __opaque: unique symbol;
};