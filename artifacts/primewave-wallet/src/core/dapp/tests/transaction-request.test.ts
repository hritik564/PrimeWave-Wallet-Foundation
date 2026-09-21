import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAppError,
  assertDAppTransactionBinding,
  createDAppTransactionBinding,
  normalizeTransactionRequest,
  type DAppTransactionRequest,
} from '../index';
import { serializeUnsignedTransaction, type UnsignedTransaction } from '@/src/core/transactions/construction';

const identity = {
  dappId: 'dapp.example',
  name: 'Example DApp',
  description: null,
  url: 'https://dapp.example',
  iconUrl: null,
  origin: 'https://dapp.example',
  providerSessionId: 'session-topic',
  metadataVersion: '1',
} as const;

function normalized(params: unknown): DAppTransactionRequest {
  return normalizeTransactionRequest({
    requestId: '42',
    sessionId: 'session-topic',
    identity,
    accountId: 'account-1',
    walletAddress: '0x1111111111111111111111111111111111111111',
    networkId: 'sepolia',
    chainId: 11155111n,
    createdAt: 1,
    expiresAt: 2_000,
    params,
  });
}

function assertInvalid(params: unknown): void {
  assert.throws(
    () => normalized(params),
    (error: unknown) => error instanceof DAppError && error.code === 'INVALID_REQUEST',
  );
}

function unsigned(request: DAppTransactionRequest): UnsignedTransaction {
  const base = {
    networkId: request.networkId,
    chainId: request.chainId,
    transactionType: request.payload.calldata === '0x' ? 'native-transfer' as const : 'contract-call' as const,
    from: request.payload.from,
    to: request.payload.to,
    value: request.payload.value,
    data: request.payload.calldata,
    nonce: request.payload.nonce ?? 3n,
    gasLimit: request.payload.gasLimit ?? 21_000n,
  };
  const transaction = {
    ...base,
    feeModel: 'legacy' as const,
    gasPrice: request.payload.gasPrice ?? 1_000_000_000n,
  };
  return {
    ...transaction,
    canonicalRepresentation: serializeUnsignedTransaction(transaction),
  };
}

test('normalizes native eth_sendTransaction quantities without mutating the request', () => {
  const params = [{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '0x2a',
    gas: '0x5208',
    nonce: '0x03',
    data: '0x',
  }];
  const copy = JSON.stringify(params);
  const request = normalized(params);
  assert.equal(request.payload.value, 42n);
  assert.equal(request.payload.gasLimit, 21_000n);
  assert.equal(request.payload.nonce, 3n);
  assert.equal(request.payload.calldata, '0x');
  assert.equal(JSON.stringify(params), copy);
});

test('preserves exact EIP-1559 fee values and rejects conflicting fee models', () => {
  const request = normalized([{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    maxFeePerGas: '0x64',
    maxPriorityFeePerGas: '0x02',
    type: '0x2',
  }]);
  assert.equal(request.payload.maxFeePerGas, 100n);
  assert.equal(request.payload.maxPriorityFeePerGas, 2n);
  assert.equal(request.payload.feePreference, 'eip1559');
  assertInvalid([{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    gasPrice: '0x01',
    maxFeePerGas: '0x02',
    maxPriorityFeePerGas: '0x01',
  }]);
});

test('rejects malformed recipients, values, calldata, gas, and chain context', () => {
  const base = {
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
  };
  assertInvalid([{ ...base, value: '-1' }]);
  assertInvalid([{ ...base, gas: '0xgg' }]);
  assertInvalid([{ ...base, data: '0x0' }]);
  assertInvalid([{ ...base, to: '0xnot-an-address' }]);
  assertInvalid([{ ...base, chainId: '0x1' }]);
});

test('preserves ERC-20 transfer and approval calldata as untrusted public intent', () => {
  const transfer = normalized([{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    data: '0xa9059cbb0000000000000000000000003333333333333333333333333333333333333333000000000000000000000000000000000000000000000000000000000000002a',
  }]);
  const approval = normalized([{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    data: '0x095ea7b3000000000000000000000000333333333333333333333333333333333333333300000000000000000000000000000000000000000000000000000000000000002a',
  }]);
  assert.equal(transfer.payload.calldata.slice(0, 10), '0xa9059cbb');
  assert.equal(approval.payload.calldata.slice(0, 10), '0x095ea7b3');
  assert.equal(approval.payload.value, 0n);
});

test('binds DApp/session identity and detects transaction mutation', () => {
  const request = normalized([{
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '0x2a',
    data: '0x1234',
    nonce: '0x04',
    gas: '0x5208',
    gasPrice: '0x64',
  }]);
  const transaction = unsigned(request);
  const binding = createDAppTransactionBinding(request, transaction);
  assert.equal(binding.digest, createDAppTransactionBinding(request, transaction).digest);
  assert.doesNotThrow(() => assertDAppTransactionBinding(binding, request, transaction));
  const mutated = { ...transaction, value: 43n };
  const mutatedWithCanonical = {
    ...mutated,
    canonicalRepresentation: serializeUnsignedTransaction(mutated),
  };
  assert.throws(() => assertDAppTransactionBinding(binding, request, mutatedWithCanonical));
});