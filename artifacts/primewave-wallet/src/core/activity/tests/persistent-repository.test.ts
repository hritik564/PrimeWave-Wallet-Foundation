import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityRecordInput } from '../models';
import { ActivityService } from '../service';
import { PersistentActivityRepository, type ActivityKeyValueStorage } from '../persistent-repository';

const hash = `0x${'a'.repeat(64)}` as const;
const sender = '0x0000000000000000000000000000000000000001';

class MemoryStorage implements ActivityKeyValueStorage {
  readonly values = new Map<string, string>();
  failNextWrite = false;
  failReads = false;
  async getItem(key: string) { if (this.failReads) throw new Error('storage unavailable'); return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('storage interruption'); }
    this.values.set(key, value);
  }
  async removeItem(key: string) { this.values.delete(key); }
}

function record(overrides: Partial<ActivityRecordInput> = {}): ActivityRecordInput {
  return {
    accountId: 'account-1', networkId: 'ethereum', chainId: 1n,
    localTransactionId: 'local-1', transactionHash: hash,
    senderAddress: sender, transactionType: 'native-transfer', direction: 'outgoing',
    recipient: '0x0000000000000000000000000000000000000002',
    amountRaw: 123456789012345678n, amountDecimals: 18, amountDisplay: '0.123456789012345678',
    nativeValue: 123456789012345678n, tokenContractAddress: null, nonce: 4n,
    gasLimit: 21000n, feeModel: 'eip1559', feeAmount: 123n,
    createdAt: 100, broadcastAt: 110, confirmedAt: null, blockTimestamp: null,
    status: 'broadcasted', confirmation: null, explorerUrl: null,
    provenance: 'broadcast_engine', observedAt: 110,
    ...overrides,
  };
}

test('durable Activity restores BigInt records and local lifecycle identity after restart', async () => {
  const storage = new MemoryStorage();
  const first = new PersistentActivityRepository('wallet-A', storage, () => 1000);
  await first.ready();
  first.add(record());
  await first.flush();

  const reopenedRepository = new PersistentActivityRepository('wallet-A', storage, () => 1000);
  const reopenedService = new ActivityService({ repository: reopenedRepository });
  await reopenedService.ready();
  const restored = reopenedRepository.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n });
  assert.equal(restored?.amountRaw, 123456789012345678n);
  assert.equal(restored?.nonce, 4n);
  const confirmation = {
    kind: 'confirmation-result' as const, state: 'unknown' as const,
    transactionHash: hash, networkId: 'ethereum', chainId: 1n,
    receipt: null, polls: 2, checkedAtMs: 120,
  };
  const updated = reopenedService.recordConfirmation('local-1', confirmation);
  assert.equal(updated.status, 'unknown');
  await reopenedService.flush();
  const afterUnknownRestart = new PersistentActivityRepository('wallet-A', storage, () => 1000);
  await afterUnknownRestart.ready();
  assert.equal(afterUnknownRestart.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n })?.status, 'unknown');
});

test('unknown confirmation remains unknown and repeated confirmation upserts one local record', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-A', storage, () => 1000);
  repository.add(record());
  const service = new ActivityService({ repository });
  await service.ready();
  const confirmed = service.recordConfirmation('local-1', {
    kind: 'confirmation-result', state: 'confirmed', transactionHash: hash,
    networkId: 'ethereum', chainId: 1n, receipt: {
      transactionHash: hash, blockHash: `0x${'b'.repeat(64)}`, blockNumber: 7n,
      status: 'success', gasUsed: 21000n, effectiveGasPrice: 2n,
    }, polls: 3, checkedAtMs: 200,
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(repository.listAll().length, 1);
  assert.equal(repository.listAll()[0]?.localTransactionId, 'local-1');
  assert.ok(repository.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }));
  service.recordConfirmation('local-1', {
    kind: 'confirmation-result', state: 'confirmed', transactionHash: hash,
    networkId: 'ethereum', chainId: 1n, receipt: confirmed.confirmation?.receipt ?? null,
    polls: 4, checkedAtMs: 201,
  });
  assert.equal(repository.listByAccountAndNetwork({ accountId: 'account-1', networkId: 'ethereum', chainId: 1n }).length, 1);
});

test('wallet, account, network, and chain scopes remain isolated', async () => {
  const storage = new MemoryStorage();
  const walletA = new PersistentActivityRepository('wallet-A', storage);
  const walletB = new PersistentActivityRepository('wallet-B', storage);
  await Promise.all([walletA.ready(), walletB.ready()]);
  walletA.add(record());
  walletA.add(record({ localTransactionId: 'account-2', accountId: 'account-2', transactionHash: `0x${'c'.repeat(64)}` as const }));
  walletA.add(record({ localTransactionId: 'base-record', networkId: 'base', chainId: 8453n, transactionHash: `0x${'d'.repeat(64)}` as const }));
  await Promise.all([walletA.flush(), walletB.flush()]);
  const reopenedA = new PersistentActivityRepository('wallet-A', storage);
  const reopenedB = new PersistentActivityRepository('wallet-B', storage);
  await Promise.all([reopenedA.ready(), reopenedB.ready()]);
  assert.equal(reopenedA.listByAccountAndNetwork({ accountId: 'account-1', networkId: 'ethereum', chainId: 1n }).length, 1);
  assert.equal(reopenedA.listByAccountAndNetwork({ accountId: 'account-2', networkId: 'ethereum', chainId: 1n }).length, 1);
  assert.equal(reopenedA.listByAccountAndNetwork({ accountId: 'account-1', networkId: 'base', chainId: 8453n }).length, 1);
  assert.equal(reopenedB.listAll().length, 0);
});

test('reset clear removes both durable snapshots and wallet records', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-reset', storage);
  await repository.ready();
  repository.add(record());
  await repository.flush();
  assert.equal(storage.values.size, 1);
  await repository.clearDurable();
  assert.equal(storage.values.size, 0);
  const reopened = new PersistentActivityRepository('wallet-reset', storage);
  await reopened.ready();
  assert.equal(reopened.listAll().length, 0);
});

test('an interrupted snapshot write leaves the previous committed slot recoverable', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-recovery', storage);
  await repository.ready();
  repository.add(record({ status: 'draft', transactionHash: null, broadcastAt: null, provenance: 'local_wallet' }));
  await repository.flush();
  storage.failNextWrite = true;
  repository.updateStatus('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }, {
    status: 'signed', observedAt: 120, provenance: 'local_wallet',
  });
  await assert.rejects(repository.flush());
  const reopened = new PersistentActivityRepository('wallet-recovery', storage);
  await reopened.ready();
  assert.equal(reopened.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n })?.status, 'draft');
});

test('a storage read failure disables writes instead of replacing unread history', async () => {
  const storage = new MemoryStorage();
  const original = new PersistentActivityRepository('wallet-io', storage);
  await original.ready();
  original.add(record());
  await original.flush();
  storage.failReads = true;
  const unavailable = new PersistentActivityRepository('wallet-io', storage);
  await assert.rejects(unavailable.ready());
  unavailable.add(record({ localTransactionId: 'session-only', transactionHash: `0x${'e'.repeat(64)}` as const }));
  await assert.rejects(unavailable.flush());
  storage.failReads = false;
  const reopened = new PersistentActivityRepository('wallet-io', storage);
  await reopened.ready();
  assert.equal(reopened.listAll().length, 1);
  assert.equal(reopened.listAll()[0]?.localTransactionId, 'local-1');
});

test('corrupt storage fails safely and invalid records are not displayed', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-corrupt', storage);
  await repository.ready();
  repository.add(record());
  await repository.flush();
  const [key] = [...storage.values.keys()];
  const snapshot = JSON.parse(storage.values.get(key)!);
  snapshot.records[0].status = 'pretend-confirmed';
  storage.values.set(key, JSON.stringify(snapshot));
  const reopened = new PersistentActivityRepository('wallet-corrupt', storage);
  await reopened.ready();
  assert.equal(reopened.listAll().length, 0);

  const whollyCorrupt = new MemoryStorage();
  whollyCorrupt.values.set('wavex.activity.v1.wallet-corrupt.a', '{truncated');
  const safeEmpty = new PersistentActivityRepository('wallet-corrupt', whollyCorrupt);
  await safeEmpty.ready();
  assert.equal(safeEmpty.listAll().length, 0);
});

test('retention caps storage at 500 records and drops the oldest entries first', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-bounded', storage, () => 1_000_000);
  await repository.ready();
  for (let index = 1; index <= 501; index++) {
    repository.add(record({
      localTransactionId: `record-${index}`,
      transactionHash: `0x${index.toString(16).padStart(64, '0')}` as `0x${string}`,
      observedAt: index,
    }));
  }
  await repository.flush();
  assert.equal(repository.listAll().length, 500);
  assert.equal(repository.getById('record-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }), null);
  assert.ok(repository.getById('record-2', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }));
});

test('age cleanup removes only expired terminal records', async () => {
  const storage = new MemoryStorage();
  const now = 2 * 365 * 24 * 60 * 60 * 1000;
  const repository = new PersistentActivityRepository('wallet-cleanup', storage, () => now);
  await repository.ready();
  repository.add(record({ localTransactionId: 'old-failed', transactionHash: null, status: 'failed', provenance: 'local_wallet', observedAt: 1 }));
  repository.add(record({ localTransactionId: 'recent-pending', transactionHash: null, status: 'draft', provenance: 'local_wallet', observedAt: now }));
  assert.equal(repository.listAll().length, 1);
  assert.equal(repository.listAll()[0]?.localTransactionId, 'recent-pending');
});
