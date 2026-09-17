import type {
  ExplicitSigningAuthorization,
  ProtectedAuthInput,
  SignedTransaction,
  SigningCapability,
  UnsignedTransaction,
} from '@/src/core/security';

export interface TransactionRequest {
  requestId: string;
  accountId: string;
  networkId: string;
  to: string;
  value: string;
  data: string | null;
}

export interface TransactionPreview {
  requestId: string;
  asset: string;
  amount: string;
  destination: string;
  network: string;
  networkFee: string;
  totalAmount: string;
  transactionType: string;
  unsignedTransaction: UnsignedTransaction;
}

export interface UserConfirmation extends ExplicitSigningAuthorization {
  confirmedAt: string;
  authenticationInput: ProtectedAuthInput;
}

export interface TransactionBuilder {
  buildPreview(request: TransactionRequest): Promise<TransactionPreview>;
}

export interface LocalSigner {
  sign(
    transaction: UnsignedTransaction,
    capability: SigningCapability,
    confirmation: UserConfirmation,
  ): Promise<SignedTransaction>;
}

export interface BlockchainBroadcaster {
  broadcast(signedTransaction: SignedTransaction): Promise<{
    transactionHash: string;
  }>;
}

export interface TransactionSigningFlow {
  buildPreview(request: TransactionRequest): Promise<TransactionPreview>;
  requireUserConfirmation(
    preview: TransactionPreview,
  ): Promise<UserConfirmation>;
  authenticate(confirmation: UserConfirmation): Promise<void>;
  signLocally(
    preview: TransactionPreview,
    confirmation: UserConfirmation,
  ): Promise<SignedTransaction>;
  broadcast(signedTransaction: SignedTransaction): Promise<{
    transactionHash: string;
  }>;
}