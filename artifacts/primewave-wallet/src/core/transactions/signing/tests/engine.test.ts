import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recoverTransactionAddress,
  keccak256,
} from 'viem';
import {
  NetworkRegistry,
  supportedNetworks,
} from '@/src/core/networks/registry';
import { LocalWalletEngine } from '@/src/core/wallet/local-wallet-engine';
import {
  TransactionSigningEngine,
  TransactionSigningError,
  createTransactionSigningAuthorization,
  type SignedTransaction,
} from '../index';
import {
  serializeUnsignedTransaction,
  type Eip1559UnsignedTransaction,
  type LegacyUnsignedTransaction,
} from '@/src/core/transactions/construction';
import type { SupportedSigningTransaction } from '../models';
import type { LocalSigningKeyAccess } from '../models';
import type {
  SecureVault,
  SigningCapability,
} from '@/src/core/security/contracts';
import type { WalletEntropyProvider } from '@/src/core/wallet/local-wallet-engine';

const MNEMONIC =
  'test test test test test test test test test test test junk';
const ACCOUNT_ID = 'account-0';
const FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TO = '0x1111111111111111111111111111111111111111';

function createRegistry(): NetworkRegistry {
  const registry = new NetworkRegistry(
    supportedNetworks.filter(
      (network) =>
        network.id === 'primewave' ||
        network.id === 'ethereum' ||
        network.id === 'base',
    ),
  );
  registry.selectActiveNetwork('ethereum');
  return registry;
}

function createLegacyTransaction(): LegacyUnsignedTransaction {
  const transactionWithoutCanonical = {
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: 'native-transfer' as const,
    from: FROM,
    to: TO,
    value: 1_000_000_000_000_000n,
    data: '0x' as const,
    nonce: 7n,
    gasLimit: 21_000n,
    feeModel: 'legacy' as const,
    gasPrice: 1_000_000_000n,
  };
  return {
    ...transactionWithoutCanonical,
    canonicalRepresentation: serializeUnsignedTransaction(
      transactionWithoutCanonical,
    ),
  };
}

function createEip1559Transaction(): Eip1559UnsignedTransaction {
  const transactionWithoutCanonical = {
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: 'contract-call' as const,
    from: FROM,
    to: TO,
    value: 0n,
    data: '0xaabb' as const,
    nonce: 8n,
    gasLimit: 55_000n,
    feeModel: 'eip1559' as const,
    maxFeePerGas: 2_500_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  };
  return {
    ...transactionWithoutCanonical,
    canonicalRepresentation: serializeUnsignedTransaction(
      transactionWithoutCanonical,
    ),
  };
}

class AuthenticationGate {
  calls = 0;
  result: {
    authenticated: boolean;
    reason:
      | 'success'
      | 'cancelled'
      | 'unavailable'
      | 'locked'
      | 'rejected'
      | 'not-configured';
  } = { authenticated: true, reason: 'success' };

  async unlockWallet(): Promise<typeof this.result> {
    this.calls += 1;
    return this.result;
  }
}

class NoopVault implements SecureVault {
  async saveEncryptedWalletState(): Promise<void> {}
  async retrieveEncryptedWalletState(): Promise<null> {
    return null;
  }
  async deleteWalletState(): Promise<void> {}
  async hasVault(): Promise<boolean> {
    return false;
  }
  async isVaultValid(): Promise<boolean> {
    return false;
  }
}

class DeterministicEntropy implements WalletEntropyProvider {
  async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
    return new Uint8Array(byteCount);
  }
}

async function createLocalEngine(
  transaction: SupportedSigningTransaction,
  gate = new AuthenticationGate(),
): Promise<{
  engine: TransactionSigningEngine;
  authorization: ReturnType<typeof createTransactionSigningAuthorization>;
  gate: AuthenticationGate;
  wallet: LocalWalletEngine;
}> {
  const wallet = new LocalWalletEngine(
    new NoopVault(),
    new DeterministicEntropy(),
  );
  await wallet.prepareImportWallet(MNEMONIC);
  const accounts = await wallet.getAccounts();
  const registry = createRegistry();
  const engine = new TransactionSigningEngine(registry, wallet, {
    authenticator: gate,
    accounts,
  });
  const authorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-1',
    confirmedAt: '2026-09-17T00:00:00.000Z',
  });
  return { engine, authorization, gate, wallet };
}

async function expectSigningError(
  action: () => Promise<unknown>,
  code: TransactionSigningError['code'],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return error instanceof TransactionSigningError && error.code === code;
  });
}

test('signs a Legacy transaction locally and recovers the expected sender', async () => {
  const transaction = createLegacyTransaction();
  const { engine, authorization, gate } = await createLocalEngine(transaction);

  const signed = await engine.sign(transaction, authorization);
  assert.equal(signed.kind, 'signed-transaction');
  assert.match(signed.rawTransaction, /^0x[0-9a-f]+$/i);
  assert.match(signed.transactionHash, /^0x[0-9a-f]{64}$/i);
  assert.equal(
    await recoverTransactionAddress({
      serializedTransaction: signed.rawTransaction as never,
    }),
    FROM,
  );
  assert.equal(gate.calls, 1);
});

test('signs an EIP-1559 transaction with the correct chain binding', async () => {
  const transaction = createEip1559Transaction();
  const { engine, authorization } = await createLocalEngine(transaction);

  const signed = await engine.sign(transaction, authorization);
  assert.equal(signed.chainId, 1n);
  assert.equal(signed.transactionType, 'contract-call');
  assert.equal(
    await recoverTransactionAddress({
      serializedTransaction: signed.rawTransaction as never,
    }),
    FROM,
  );
  assert.equal(signed.rawTransaction.startsWith('0x02'), true);
});

test('repeated signing is deterministic and hashes the signed representation', async () => {
  const transaction = createLegacyTransaction();
  const first = await createLocalEngine(transaction);
  const second = await createLocalEngine(transaction);

  const firstSigned = await first.engine.sign(transaction, first.authorization);
  const secondSigned = await second.engine.sign(transaction, second.authorization);

  assert.equal(firstSigned.rawTransaction, secondSigned.rawTransaction);
  assert.equal(firstSigned.transactionHash, secondSigned.transactionHash);
  assert.equal(
    firstSigned.transactionHash,
    keccak256(firstSigned.rawTransaction),
  );
});

test('requires explicit authorization and authentication before key access', async () => {
  const transaction = createLegacyTransaction();
  const gate = new AuthenticationGate();
  const keyAccessCalls: string[] = [];
  const keyAccess: LocalSigningKeyAccess = {
    async signWithCapability(
      _capability: SigningCapability,
      accountId: string,
      _transaction: SupportedSigningTransaction,
      _digest: `0x${string}`,
    ) {
      keyAccessCalls.push(accountId);
      return {
        rawTransaction: '0x01',
        transactionHash: keccak256('0x01'),
      };
    },
  };
  const registry = createRegistry();
  const engine = new TransactionSigningEngine(registry, keyAccess, {
    authenticator: gate,
    accounts: [{ accountId: ACCOUNT_ID, address: FROM, index: 0 }],
  });

  await expectSigningError(
    () => engine.sign(transaction, undefined as never),
    'SIGNING_NOT_AUTHORIZED',
  );
  assert.equal(gate.calls, 0);
  assert.deepEqual(keyAccessCalls, []);

  gate.result = { authenticated: false, reason: 'cancelled' };
  const authorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-2',
  });
  await expectSigningError(
    () => engine.sign(transaction, authorization),
    'SIGNING_CANCELLED',
  );
  assert.deepEqual(keyAccessCalls, []);
});

test('normalizes authentication timeout, unavailable vault state, and signing failures', async () => {
  const transaction = createLegacyTransaction();
  const unavailableGate = new AuthenticationGate();
  unavailableGate.result = { authenticated: false, reason: 'unavailable' };
  const unavailable = await createLocalEngine(transaction, unavailableGate);
  await expectSigningError(
    () => unavailable.engine.sign(transaction, unavailable.authorization),
    'SIGNING_NOT_AUTHENTICATED',
  );

  const emptyWallet = new LocalWalletEngine(
    new NoopVault(),
    new DeterministicEntropy(),
  );
  const vaultEngine = new TransactionSigningEngine(
    createRegistry(),
    emptyWallet,
    {
      authenticator: new AuthenticationGate(),
      accounts: [{ accountId: ACCOUNT_ID, address: FROM, index: 0 }],
    },
  );
  const vaultAuthorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-vault',
  });
  await expectSigningError(
    () => vaultEngine.sign(transaction, vaultAuthorization),
    'SIGNING_VAULT_UNAVAILABLE',
  );

  const failingKeyAccess: LocalSigningKeyAccess = {
    async signWithCapability() {
      throw new Error('private key material should never be returned');
    },
  };
  const failureEngine = new TransactionSigningEngine(
    createRegistry(),
    failingKeyAccess,
    {
      authenticator: new AuthenticationGate(),
      accounts: [{ accountId: ACCOUNT_ID, address: FROM, index: 0 }],
    },
  );
  const failureAuthorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-failure',
  });
  await assert.rejects(
    () => failureEngine.sign(transaction, failureAuthorization),
    (error: unknown) => {
      assert(error instanceof TransactionSigningError);
      assert.equal(error.code, 'SIGNING_FAILED');
      assert.equal(error.message.includes('private key'), false);
      return true;
    },
  );
});

test('rejects wrong account, wrong network, wrong chain, and authorization tampering', async () => {
  const transaction = createLegacyTransaction();
  const { engine, authorization } = await createLocalEngine(transaction);

  await expectSigningError(
    () =>
      engine.sign(
        transaction,
        { ...authorization, accountId: 'account-1' },
      ),
    'SIGNING_ACCOUNT_MISMATCH',
  );
  await expectSigningError(
    () =>
      engine.sign(
        transaction,
        { ...authorization, networkId: 'base' },
      ),
    'SIGNING_TRANSACTION_MISMATCH',
  );
  await expectSigningError(
    () =>
      engine.sign(
        transaction,
        { ...authorization, chainId: 5n },
      ),
    'SIGNING_TRANSACTION_MISMATCH',
  );

  const tampered = {
    ...transaction,
    value: transaction.value + 1n,
    canonicalRepresentation: serializeUnsignedTransaction({
      ...transaction,
      value: transaction.value + 1n,
    }),
  } as SupportedSigningTransaction;
  await expectSigningError(
    () => engine.sign(tampered, authorization),
    'SIGNING_TRANSACTION_MISMATCH',
  );

  const recomputedTamperedAuthorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction: tampered,
    requestId: 'request-3',
  });
  const reauthorized = await engine.sign(
    tampered,
    recomputedTamperedAuthorization,
  );
  assert.equal(reauthorized.from, FROM);
});

test('rejects nonce, gas, fee, recipient, calldata, and transaction-type changes', async () => {
  const transaction = createEip1559Transaction();
  const { engine, authorization } = await createLocalEngine(transaction);
  const changes: SupportedSigningTransaction[] = [
    { ...transaction, nonce: transaction.nonce + 1n },
    { ...transaction, gasLimit: transaction.gasLimit + 1n },
    { ...transaction, maxFeePerGas: transaction.maxFeePerGas + 1n },
    { ...transaction, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas + 1n },
    { ...transaction, to: FROM },
    { ...transaction, data: '0xccdd' },
    { ...transaction, transactionType: 'native-transfer' },
  ];

  for (const changed of changes) {
    await expectSigningError(
      () => engine.sign(changed, authorization),
      'SIGNING_INVALID_TRANSACTION',
    );
  }
});

test('does not require RPC, does not broadcast, and returns no secret material', async () => {
  const transaction = createLegacyTransaction();
  const { engine, authorization, wallet } = await createLocalEngine(transaction);

  const signed = await engine.sign(transaction, authorization);
  const serialized = JSON.stringify(signed, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  assert.equal(serialized.includes(MNEMONIC), false);
  assert.equal(serialized.includes('privateKey'), false);
  assert.equal(serialized.includes('mnemonic'), false);
  assert.equal(serialized.includes('SecureStore'), false);
  assert.equal('broadcast' in engine, false);
  assert.equal('sendRawTransaction' in engine, false);
  assert.equal(await wallet.hasPersistedWallet(), false);
});

test('protects concurrent signing attempts per account', async () => {
  const transaction = createLegacyTransaction();
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const keyAccess: LocalSigningKeyAccess = {
    async signWithCapability() {
      started?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        rawTransaction: '0x01',
        transactionHash: keccak256('0x01'),
      };
    },
  };
  const gate = new AuthenticationGate();
  const engine = new TransactionSigningEngine(createRegistry(), keyAccess, {
    authenticator: gate,
    accounts: [{ accountId: ACCOUNT_ID, address: FROM, index: 0 }],
  });
  const authorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-concurrent',
  });
  const first = engine.sign(transaction, authorization);
  await startedPromise;
  await expectSigningError(
    () => engine.sign(transaction, authorization),
    'SIGNING_CONCURRENT',
  );
  release?.();
  await first;
});

test('rejects active-network changes before and after local signing', async () => {
  const transaction = createLegacyTransaction();
  const registry = createRegistry();
  const gate = new AuthenticationGate();
  const keyAccess: LocalSigningKeyAccess = {
    async signWithCapability(
      _capability,
      _accountId,
      _transaction,
      _digest,
    ) {
      registry.selectActiveNetwork('base');
      return {
        rawTransaction: '0x01',
        transactionHash: keccak256('0x01'),
      };
    },
  };
  const engine = new TransactionSigningEngine(registry, keyAccess, {
    authenticator: gate,
    accounts: [{ accountId: ACCOUNT_ID, address: FROM, index: 0 }],
  });
  const authorization = createTransactionSigningAuthorization({
    accountId: ACCOUNT_ID,
    transaction,
    requestId: 'request-network',
  });

  await expectSigningError(
    () => engine.sign(transaction, authorization),
    'SIGNING_NETWORK_CHANGED',
  );
});