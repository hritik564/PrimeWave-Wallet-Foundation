import { keccak256, stringToHex } from 'viem';
import { secureLogger } from '@/src/core/security/logging';
import { WalletCoreError } from '@/src/core/wallet/derivation';
import type { WalletAccount } from '@/src/core/wallet/models';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import {
  issueSigningCapability,
} from '@/src/core/security/signing-capability';
import { TransactionConstructionError, serializeUnsignedTransaction } from '../construction';
import type {
  Eip1559UnsignedTransaction,
  LegacyUnsignedTransaction,
  UnsignedTransaction,
} from '../construction';
import { TransactionSigningError } from './errors';
import type {
  CreateTransactionSigningAuthorizationInput,
  LocalSigningKeyAccess,
  SignedTransaction,
  SupportedSigningTransaction,
  TransactionSigningAuthorization,
  TransactionSigningEngineOptions,
} from './models';

function normalizeAddress(value: string): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
  }
}

function transactionDigest(transaction: SupportedSigningTransaction): `0x${string}` {
  return keccak256(stringToHex(serializeUnsignedTransaction(transaction)));
}

function isNonNegativeBigint(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n;
}

function validateUnsignedTransaction(
  transaction: UnsignedTransaction,
): SupportedSigningTransaction {
  if (
    typeof transaction !== 'object' ||
    transaction === null ||
    (transaction.feeModel !== 'legacy' && transaction.feeModel !== 'eip1559') ||
    (transaction.transactionType !== 'native-transfer' &&
      transaction.transactionType !== 'contract-call') ||
    typeof transaction.networkId !== 'string' ||
    typeof transaction.data !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(transaction.data) ||
    (transaction.data.length - 2) % 2 !== 0 ||
    !isNonNegativeBigint(transaction.chainId) ||
    !isNonNegativeBigint(transaction.value) ||
    !isNonNegativeBigint(transaction.nonce) ||
    !isNonNegativeBigint(transaction.gasLimit) ||
    transaction.gasLimit === 0n ||
    normalizeAddress(transaction.from) === '' ||
    normalizeAddress(transaction.to) === ''
  ) {
    throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
  }

  try {
    const canonical = serializeUnsignedTransaction(transaction);
    if (canonical !== transaction.canonicalRepresentation) {
      throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
    }
  } catch (error) {
    if (error instanceof TransactionSigningError) {
      throw error;
    }
    throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
  }

  if (transaction.feeModel === 'legacy') {
    if (!isNonNegativeBigint(transaction.gasPrice)) {
      throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
    }
    return transaction;
  }

  if (
    !isNonNegativeBigint(transaction.maxFeePerGas) ||
    !isNonNegativeBigint(transaction.maxPriorityFeePerGas)
  ) {
    throw new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
  }
  return transaction;
}

function assertAuthorization(
  transaction: SupportedSigningTransaction,
  authorization: TransactionSigningAuthorization,
): void {
  if (
    typeof authorization !== 'object' ||
    authorization === null ||
    authorization.approved !== true ||
    authorization.authenticationState !== 'authenticated' ||
    typeof authorization.requestId !== 'string' ||
    authorization.requestId.length === 0 ||
    typeof authorization.confirmedAt !== 'string' ||
    authorization.confirmedAt.length === 0 ||
    typeof authorization.accountId !== 'string' ||
    authorization.accountId.length === 0
  ) {
    throw new TransactionSigningError('SIGNING_NOT_AUTHORIZED');
  }

  const expectedDigest = transactionDigest(transaction);
  if (authorization.transactionDigest !== expectedDigest) {
    throw new TransactionSigningError('SIGNING_TRANSACTION_MISMATCH');
  }

  const fieldsMatch =
    authorization.from === transaction.from &&
    authorization.networkId === transaction.networkId &&
    authorization.chainId === transaction.chainId &&
    authorization.transactionType === transaction.transactionType &&
    authorization.to === transaction.to &&
    authorization.value === transaction.value &&
    authorization.data === transaction.data &&
    authorization.nonce === transaction.nonce &&
    authorization.gasLimit === transaction.gasLimit &&
    authorization.feeModel === transaction.feeModel &&
    (transaction.feeModel === 'legacy'
      ? authorization.gasPrice === transaction.gasPrice
      : authorization.maxFeePerGas === transaction.maxFeePerGas &&
        authorization.maxPriorityFeePerGas === transaction.maxPriorityFeePerGas);

  if (!fieldsMatch) {
    throw new TransactionSigningError('SIGNING_TRANSACTION_MISMATCH');
  }
}

function assertNetwork(
  registry: NetworkRegistry,
  network: EvmNetwork,
  transaction: SupportedSigningTransaction,
  changedDuringSigning = false,
): void {
  const active = registry.getActiveNetwork();
  if (!active || active.id !== network.id) {
    throw new TransactionSigningError(
      changedDuringSigning
        ? 'SIGNING_NETWORK_CHANGED'
        : 'SIGNING_NETWORK_MISMATCH',
    );
  }
  if (active.chainId !== network.chainId || transaction.chainId !== BigInt(network.chainId ?? -1)) {
    throw new TransactionSigningError('SIGNING_CHAIN_MISMATCH');
  }
  if (!active.enabled || active.configurationStatus !== 'configured') {
    throw new TransactionSigningError('SIGNING_NETWORK_MISMATCH');
  }
}

function safeSigningError(error: unknown): TransactionSigningError {
  if (error instanceof TransactionSigningError) {
    return error;
  }
  if (error instanceof TransactionConstructionError) {
    return new TransactionSigningError('SIGNING_INVALID_TRANSACTION');
  }
  if (error instanceof WalletCoreError) {
    switch (error.code) {
      case 'SIGNING_ACCESS_DENIED':
        return new TransactionSigningError('SIGNING_KEY_ACCESS_FAILED');
      case 'SIGNING_ACCOUNT_MISMATCH':
        return new TransactionSigningError('SIGNING_ACCOUNT_MISMATCH');
      case 'WALLET_NOT_CREATED':
        return new TransactionSigningError('SIGNING_VAULT_UNAVAILABLE');
      default:
        return new TransactionSigningError('SIGNING_FAILED');
    }
  }
  return new TransactionSigningError('SIGNING_FAILED');
}

export function createTransactionSigningAuthorization(
  input: CreateTransactionSigningAuthorizationInput,
): TransactionSigningAuthorization {
  const transaction = validateUnsignedTransaction(input.transaction);
  const from = normalizeAddress(transaction.from);
  const authorization: TransactionSigningAuthorization = {
    requestId: input.requestId,
    approved: true,
    confirmedAt: input.confirmedAt ?? new Date().toISOString(),
    accountId: input.accountId,
    from,
    networkId: transaction.networkId,
    chainId: transaction.chainId,
    transactionDigest: transactionDigest(transaction),
    transactionType: transaction.transactionType,
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    feeModel: transaction.feeModel,
    gasPrice: transaction.feeModel === 'legacy' ? transaction.gasPrice : undefined,
    maxFeePerGas:
      transaction.feeModel === 'eip1559' ? transaction.maxFeePerGas : undefined,
    maxPriorityFeePerGas:
      transaction.feeModel === 'eip1559'
        ? transaction.maxPriorityFeePerGas
        : undefined,
    authenticationState: 'authenticated',
  };
  return Object.freeze(authorization);
}

export class TransactionSigningEngine {
  private readonly network: EvmNetwork;
  private readonly accounts: ReadonlyMap<string, WalletAccount>;
  private readonly inFlightAccounts = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly keyAccess: LocalSigningKeyAccess,
    options: TransactionSigningEngineOptions,
  ) {
    const network = registry.getActiveNetwork();
    if (!network) {
      throw new TransactionSigningError('SIGNING_NETWORK_MISMATCH');
    }
    this.network = network;
    this.accounts = new Map(
      options.accounts.map((account) => [
        account.accountId,
        {
          accountId: account.accountId,
          index: account.index ?? 0,
          address: normalizeAddress(account.address),
          derivationPath: '',
        },
      ]),
    );
    this.authenticator = options.authenticator;
    this.now = options.now ?? (() => Date.now());
  }

  private readonly authenticator: TransactionSigningEngineOptions['authenticator'];

  async sign(
    transactionInput: UnsignedTransaction,
    authorization: TransactionSigningAuthorization,
  ): Promise<SignedTransaction> {
    const startedAt = this.now();
    let transaction: SupportedSigningTransaction;
    try {
      transaction = validateUnsignedTransaction(transactionInput);
      assertAuthorization(transaction, authorization);
      assertNetwork(this.registry, this.network, transaction);

      const account = this.accounts.get(authorization.accountId);
      if (!account || normalizeAddress(account.address) !== authorization.from) {
        throw new TransactionSigningError('SIGNING_ACCOUNT_MISMATCH');
      }
      if (normalizeAddress(transaction.from) !== account.address) {
        throw new TransactionSigningError('SIGNING_ACCOUNT_MISMATCH');
      }

      if (this.inFlightAccounts.has(authorization.accountId)) {
        throw new TransactionSigningError('SIGNING_CONCURRENT');
      }
      this.inFlightAccounts.add(authorization.accountId);

      try {
        const authentication = await this.authenticator.unlockWallet();
        if (!authentication.authenticated) {
          throw new TransactionSigningError(
            authentication.reason === 'cancelled'
              ? 'SIGNING_CANCELLED'
              : 'SIGNING_NOT_AUTHENTICATED',
          );
        }

        assertNetwork(this.registry, this.network, transaction, true);
        const capability = issueSigningCapability({
          accountId: authorization.accountId,
          transactionDigest: authorization.transactionDigest,
        });
        const signed = await this.keyAccess.signWithCapability(
          capability,
          authorization.accountId,
          transaction,
          authorization.transactionDigest,
        );
        assertNetwork(this.registry, this.network, transaction, true);

        const result: SignedTransaction = Object.freeze({
          kind: 'signed-transaction',
          rawTransaction: signed.rawTransaction,
          transactionHash: signed.transactionHash,
          networkId: transaction.networkId,
          chainId: transaction.chainId,
          transactionType: transaction.transactionType,
          from: transaction.from,
        });
        secureLogger.debug('Local transaction signing completed', {
          networkId: transaction.networkId,
          chainId: Number(transaction.chainId),
          durationMs: Math.max(0, this.now() - startedAt),
          success: true,
        });
        return result;
      } finally {
        this.inFlightAccounts.delete(authorization.accountId);
      }
    } catch (error) {
      const normalized = safeSigningError(error);
      secureLogger.warning('Local transaction signing failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }
}