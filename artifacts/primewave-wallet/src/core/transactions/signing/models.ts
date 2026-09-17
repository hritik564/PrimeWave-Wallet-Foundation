import type {
  Eip1559UnsignedTransaction,
  TransactionType,
  UnsignedTransaction,
  LegacyUnsignedTransaction,
} from '../construction/models';
import type {
  ExplicitSigningAuthorization,
  SigningCapability,
  WalletAuthenticator,
} from '@/src/core/security/contracts';

export type SupportedSigningTransaction =
  | LegacyUnsignedTransaction
  | Eip1559UnsignedTransaction;

export interface TransactionSigningAuthorization
  extends ExplicitSigningAuthorization {
  readonly accountId: string;
  readonly from: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionDigest: `0x${string}`;
  readonly transactionType: TransactionType;
  readonly to: string;
  readonly value: bigint;
  readonly data: `0x${string}`;
  readonly nonce: bigint;
  readonly gasLimit: bigint;
  readonly feeModel: 'legacy' | 'eip1559';
  readonly gasPrice?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
  readonly authenticationState: 'authenticated';
}

export interface CreateTransactionSigningAuthorizationInput {
  readonly accountId: string;
  readonly transaction: SupportedSigningTransaction;
  readonly requestId: string;
  readonly confirmedAt?: string;
}

export interface SignedTransaction {
  readonly kind: 'signed-transaction';
  readonly rawTransaction: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionType: TransactionType;
  readonly from: string;
}

export interface LocalSigningKeyAccess {
  signWithCapability(
    capability: SigningCapability,
    accountId: string,
    transaction: SupportedSigningTransaction,
    transactionDigest: `0x${string}`,
  ): Promise<{
    readonly rawTransaction: `0x${string}`;
    readonly transactionHash: `0x${string}`;
  }>;
}

export interface TransactionSigningEngineOptions {
  readonly authenticator: Pick<WalletAuthenticator, 'unlockWallet'>;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly address: string;
    readonly index?: number;
  }[];
  readonly now?: () => number;
}

export type SigningInput = {
  readonly transaction: UnsignedTransaction;
  readonly authorization: TransactionSigningAuthorization;
};