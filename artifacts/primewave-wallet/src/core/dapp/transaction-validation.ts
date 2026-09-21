import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { DAppError } from './errors';
import type { DAppIdentity } from './models';
import type {
  DAppTransactionIntent,
  DAppTransactionRequest,
} from './request-models';

export interface TransactionRequestNormalizationInput {
  readonly requestId: string;
  readonly sessionId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly params: unknown;
}

function fail(message: string): never {
  throw new DAppError('INVALID_REQUEST', message);
}

function quantity(value: unknown, label: string): bigint {
  if (
    typeof value !== 'string' ||
    !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value)
  ) {
    return fail(`${label} must be a non-negative integer quantity.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) return fail(`${label} must be non-negative.`);
    return parsed;
  } catch {
    return fail(`${label} is malformed.`);
  }
}

function optionalQuantity(value: unknown, label: string): bigint | null {
  return value === undefined || value === null ? null : quantity(value, label);
}

function address(value: unknown, label: string): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    return fail(`${label} is not a valid EVM address.`);
  }
}

function hex(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(value) ||
    (value.length - 2) % 2 !== 0
  ) {
    return fail(`${label} must be even-length hexadecimal data.`);
  }
  return value.toLowerCase() as `0x${string}`;
}

export function normalizeTransactionRequest(
  input: TransactionRequestNormalizationInput,
): DAppTransactionRequest {
  if (!Array.isArray(input.params) || input.params.length !== 1) {
    return fail('eth_sendTransaction requires exactly one transaction object.');
  }
  const raw = input.params[0];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('The transaction request must be an object.');
  }
  const value = raw as Record<string, unknown>;
  const from = address(value.from, 'Transaction sender');
  const to = address(value.to, 'Transaction recipient');
  const data = value.data;
  const transactionInput = value.input;
  if (data !== undefined && transactionInput !== undefined) {
    const normalizedData = hex(data, 'Transaction data');
    const normalizedInput = hex(transactionInput, 'Transaction input');
    if (normalizedData !== normalizedInput) {
      return fail('Transaction data and input conflict.');
    }
  }
  const calldata = hex(
    data === undefined ? transactionInput ?? '0x' : data,
    'Transaction calldata',
  );
  const gasLimit = optionalQuantity(value.gas, 'Transaction gas');
  const nonce = optionalQuantity(value.nonce, 'Transaction nonce');
  const valueQuantity = optionalQuantity(value.value, 'Transaction value') ?? 0n;
  const gasPrice = optionalQuantity(value.gasPrice, 'Transaction gasPrice');
  const maxFeePerGas = optionalQuantity(
    value.maxFeePerGas,
    'Transaction maxFeePerGas',
  );
  const maxPriorityFeePerGas = optionalQuantity(
    value.maxPriorityFeePerGas,
    'Transaction maxPriorityFeePerGas',
  );
  if (
    gasPrice !== null &&
    (maxFeePerGas !== null || maxPriorityFeePerGas !== null)
  ) {
    return fail('Legacy gasPrice conflicts with EIP-1559 fee fields.');
  }
  if (
    (maxFeePerGas === null) !== (maxPriorityFeePerGas === null) ||
    (maxPriorityFeePerGas !== null &&
      maxFeePerGas !== null &&
      maxPriorityFeePerGas > maxFeePerGas)
  ) {
    return fail('EIP-1559 fee fields are incomplete or invalid.');
  }
  let transactionType: 'legacy' | 'eip1559' | null = null;
  if (value.type !== undefined) {
    if (value.type === '0x0' || value.type === '0x1' || value.type === '0') {
      transactionType = 'legacy';
    } else if (value.type === '0x2' || value.type === '2') {
      transactionType = 'eip1559';
    } else {
      return fail('The transaction type is unsupported.');
    }
  }
  if (
    (transactionType === 'legacy' && maxFeePerGas !== null) ||
    (transactionType === 'eip1559' && gasPrice !== null)
  ) {
    return fail('The transaction type conflicts with its fee fields.');
  }
  const feePreference: DAppTransactionIntent['feePreference'] =
    transactionType ??
    (gasPrice !== null
      ? 'legacy'
      : maxFeePerGas !== null
        ? 'eip1559'
        : 'auto');
  if (value.chainId !== undefined && quantity(value.chainId, 'Transaction chain ID') !== input.chainId) {
    return fail('The transaction chain ID does not match the request chain.');
  }
  return Object.freeze({
    requestId: input.requestId,
    sessionId: input.sessionId,
    identity: input.identity,
    accountId: input.accountId,
    walletAddress: input.walletAddress,
    networkId: input.networkId,
    chainId: input.chainId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    requestType: 'transaction' as const,
    status: 'pending' as const,
    payload: {
      kind: 'transaction' as const,
      from,
      to,
      value: valueQuantity,
      calldata,
      chainId: input.chainId,
      gasLimit,
      nonce,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      feePreference,
      transactionType,
    },
  });
}