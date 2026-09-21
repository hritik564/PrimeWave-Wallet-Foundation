import { keccak256, stringToHex } from 'viem';
import type { DAppTransactionRequest } from './request-models';
import type { UnsignedTransaction } from '@/src/core/transactions/construction';

export interface DAppTransactionBinding {
  readonly requestId: string;
  readonly sessionId: string;
  readonly dappId: string;
  readonly accountId: string;
  readonly sender: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly recipient: string;
  readonly value: bigint;
  readonly calldata: `0x${string}`;
  readonly nonce: bigint;
  readonly gasLimit: bigint;
  readonly feeModel: UnsignedTransaction['feeModel'];
  readonly feeValues: readonly bigint[];
  readonly transactionType: UnsignedTransaction['transactionType'];
  readonly unsignedCanonicalRepresentation: string;
  readonly digest: `0x${string}`;
}

function identityFor(request: DAppTransactionRequest): string {
  return JSON.stringify({
    dappId: request.identity.dappId,
    dappName: request.identity.name,
    dappUrl: request.identity.url,
  });
}

export function createDAppTransactionBinding(
  request: DAppTransactionRequest,
  transaction: UnsignedTransaction,
): DAppTransactionBinding {
  const feeValues =
    transaction.feeModel === 'legacy'
      ? [transaction.gasPrice]
      : [transaction.maxFeePerGas, transaction.maxPriorityFeePerGas];
  const publicContext = JSON.stringify({
    requestId: request.requestId,
    sessionId: request.sessionId,
    identity: identityFor(request),
    accountId: request.accountId,
    sender: transaction.from,
    networkId: transaction.networkId,
    chainId: transaction.chainId.toString(),
    recipient: transaction.to,
    value: transaction.value.toString(),
    calldata: transaction.data,
    nonce: transaction.nonce.toString(),
    gasLimit: transaction.gasLimit.toString(),
    feeModel: transaction.feeModel,
    feeValues: feeValues.map((value) => value.toString()),
    transactionType: transaction.transactionType,
    unsignedCanonicalRepresentation: transaction.canonicalRepresentation,
  });
  return Object.freeze({
    requestId: request.requestId,
    sessionId: request.sessionId,
    dappId: request.identity.dappId,
    accountId: request.accountId,
    sender: transaction.from,
    networkId: transaction.networkId,
    chainId: transaction.chainId,
    recipient: transaction.to,
    value: transaction.value,
    calldata: transaction.data,
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    feeModel: transaction.feeModel,
    feeValues: Object.freeze(feeValues),
    transactionType: transaction.transactionType,
    unsignedCanonicalRepresentation: transaction.canonicalRepresentation,
    digest: keccak256(stringToHex(publicContext)),
  });
}

export function assertDAppTransactionBinding(
  binding: DAppTransactionBinding,
  request: DAppTransactionRequest,
  transaction: UnsignedTransaction,
): void {
  const current = createDAppTransactionBinding(request, transaction);
  if (current.digest !== binding.digest) {
    throw new Error('The DApp transaction review is stale.');
  }
}