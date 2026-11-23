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
  failRemoves = false;
  removeCount = 0;
  async getItem(key: string) { if (this.failReads) throw new Error('storage unavailable'); return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('storage interruption'); }
    this.values.set(key, value);
  }
  async removeItem(key: string) { this.removeCount++; if (this.failRemoves) throw new Error('remove failure'); this.values.delete(key); }
}

class DeferredStorage extends MemoryStorage {
  readonly pending: { key: string; value: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  readonly completed: string[] = [];
  startedCount = 0;
  private waiters: { count: number; resolve: () => void }[] = [];
  onAfterResolve: (() => void) | null = null;
  onAfterFailure: (() => void) | null = null;
  override async setItem(key: string, value: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.pending.push({
        key, value,
        resolve: () => {
          this.values.set(key, value);
          this.completed.push(value);
          resolve();
          const callback = this.onAfterResolve;
          this.onAfterResolve = null;
          if (callback) queueMicrotask(callback);
        },
        reject,
      });
      this.startedCount++;
      this.signalWaiters();
    });
  }
  waitForWriteCount(count: number): Promise<void> {
    if (this.startedCount >= count) return Promise.resolve();
    return new Promise((resolve) => { this.waiters.push({ count, resolve }); });
  }
  completeNext(): void { const item = this.pending.shift(); assert.ok(item); item.resolve(); }
  failNext(): void {
    const item = this.pending.shift(); assert.ok(item); item.reject(new Error('controlled write failure'));
    const callback = this.onAfterFailure;
    this.onAfterFailure = null;
    if (callback) queueMicrotask(callback);
  }
  private signalWaiters(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (this.startedCount >= waiter.count) { waiter.resolve(); return false; }
      return true;
    });
  }
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

test('a storage read failure marks Activity unavailable and recovery reads existing history', async () => {
  const storage = new MemoryStorage();
  const original = new PersistentActivityRepository('wallet-io', storage);
  await original.ready();
  original.add(record());
  await original.flush();
  storage.failReads = true;
  const unavailable = new PersistentActivityRepository('wallet-io', storage);
  await assert.rejects(unavailable.ready());
  await assert.rejects(unavailable.flush());
  assert.equal(unavailable.getIntegrityState(), 'unavailable');
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
  await assert.rejects(reopened.ready());
  assert.equal(reopened.getIntegrityState(), 'unavailable');
  assert.equal(reopened.listAll().length, 0);
  const storedBeforeMutation = [...storage.values.entries()];
  assert.throws(() => reopened.add(record()), { code: 'PERSISTENCE_CORRUPT' });
  assert.deepEqual([...storage.values.entries()], storedBeforeMutation);

  const whollyCorrupt = new MemoryStorage();
  whollyCorrupt.values.set('wavex.activity.v1.wallet-corrupt.a', '{truncated');
  const safeEmpty = new PersistentActivityRepository('wallet-corrupt', whollyCorrupt);
  await assert.rejects(safeEmpty.ready());
  assert.equal(safeEmpty.getIntegrityState(), 'unavailable');
  assert.equal(safeEmpty.listAll().length, 0);
});

test('retention preserves pending records above capacity and reports overflow', async () => {
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
  assert.equal(repository.listAll().length, 501);
  assert.equal(repository.getById('record-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n })?.status, 'broadcasted');
  assert.ok(repository.getById('record-2', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }));
  assert.deepEqual(repository.getRetentionState(), {
    capacity: 500, recordCount: 501, pendingCount: 501, overflowCount: 1, status: 'pending-overflow',
  });
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

test('corrupt newer transaction data falls back to the older complete legacy snapshot', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-fallback', storage, () => 1000);
  await repository.ready();
  repository.add(record({ status: 'draft', transactionHash: null, broadcastAt: null, provenance: 'local_wallet' }));
  await repository.flush();
  repository.updateStatus('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }, {
    status: 'signed', observedAt: 120, provenance: 'local_wallet',
  });
  await repository.flush();
  const slots = [...storage.values.entries()].map(([key, raw]) => ({ key, snapshot: JSON.parse(raw) }));
  slots.sort((left, right) => right.snapshot.generation - left.snapshot.generation);
  assert.equal(slots.length, 2);
  // C3.3A snapshots had no checksum; exercise full record validation as well as fallback.
  delete slots[0].snapshot.checksum;
  slots[0].snapshot.records[0].status = 'invalid-status';
  delete slots[1].snapshot.checksum;
  storage.values.set(slots[0].key, JSON.stringify(slots[0].snapshot));
  storage.values.set(slots[1].key, JSON.stringify(slots[1].snapshot));

  const recovered = new PersistentActivityRepository('wallet-fallback', storage, () => 1000);
  await recovered.ready();
  assert.equal(recovered.getIntegrityState(), 'recovered');
  assert.equal(recovered.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n })?.status, 'draft');
  const repaired = new PersistentActivityRepository('wallet-fallback', storage, () => 1000);
  await repaired.ready();
  assert.equal(repaired.getIntegrityState(), 'ready');
  assert.equal(repaired.getById('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n })?.status, 'draft');
});

test('failed snapshot repair leaves fallback history intact and writes unavailable', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-repair-failure', storage, () => 1000);
  await repository.ready();
  repository.add(record({ status: 'draft', transactionHash: null, broadcastAt: null, provenance: 'local_wallet' }));
  await repository.flush();
  repository.updateStatus('local-1', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }, {
    status: 'signed', observedAt: 120, provenance: 'local_wallet',
  });
  await repository.flush();
  const slots = [...storage.values.entries()].map(([key, raw]) => ({ key, snapshot: JSON.parse(raw) }));
  slots.sort((left, right) => right.snapshot.generation - left.snapshot.generation);
  slots[0]!.snapshot.records[0].status = 'broken';
  storage.values.set(slots[0]!.key, JSON.stringify(slots[0]!.snapshot));
  const fallbackKey = slots[1]!.key;
  const fallbackRaw = storage.values.get(fallbackKey);
  storage.failNextWrite = true;
  const recovering = new PersistentActivityRepository('wallet-repair-failure', storage, () => 1000);
  await assert.rejects(recovering.ready());
  assert.equal(recovering.getIntegrityState(), 'unavailable');
  assert.equal(storage.values.get(fallbackKey), fallbackRaw);
  assert.throws(() => recovering.add(record()), { code: 'PERSISTENCE_CORRUPT' });
});

test('scheduler restarts when a mutation lands between drain completion and shutdown', async () => {
  const storage = new DeferredStorage();
  const repository = new PersistentActivityRepository('wallet-scheduler', storage, () => 1000);
  await repository.ready();
  repository.add(record({ localTransactionId: 'first', transactionHash: null, status: 'draft', provenance: 'local_wallet' }));
  await storage.waitForWriteCount(1);
  storage.onAfterResolve = () => repository.add(record({
    localTransactionId: 'second', transactionHash: `0x${'2'.repeat(64)}` as const,
  }));
  storage.completeNext();
  await storage.waitForWriteCount(2);
  assert.equal(JSON.parse(storage.completed[0]!).generation, 1);
  assert.equal(JSON.parse(storage.pending[0]!.value).generation, 2);
  let flushed = false;
  const flushing = repository.flush().then(() => { flushed = true; });
  assert.equal(flushed, false);
  storage.completeNext();
  await flushing;
  assert.equal(flushed, true);
  const latest = new PersistentActivityRepository('wallet-scheduler', storage, () => 1000);
  await latest.ready();
  assert.equal(latest.listAll().length, 2);
});

test('flush reports failed writes and a later mutation retries with ordered generation', async () => {
  const storage = new DeferredStorage();
  const repository = new PersistentActivityRepository('wallet-retry', storage, () => 1000);
  await repository.ready();
  repository.add(record({ localTransactionId: 'first', transactionHash: null, status: 'draft', provenance: 'local_wallet' }));
  await storage.waitForWriteCount(1);
  const failedFlush = repository.flush();
  storage.failNext();
  await assert.rejects(failedFlush);
  assert.equal(repository.getIntegrityState(), 'write-failed');
  repository.add(record({ localTransactionId: 'second', transactionHash: `0x${'3'.repeat(64)}` as const }));
  await storage.waitForWriteCount(2);
  const retrySnapshot = JSON.parse(storage.pending[0]!.value);
  assert.equal(retrySnapshot.generation, 1);
  assert.equal(retrySnapshot.records.length, 2);
  const retryFlush = repository.flush();
  storage.completeNext();
  await retryFlush;
  assert.equal(repository.getIntegrityState(), 'ready');
});

test('a mutation arriving during a failed write is retried after the failure settles', async () => {
  const storage = new DeferredStorage();
  const repository = new PersistentActivityRepository('wallet-concurrent-failure', storage, () => 1000);
  await repository.ready();
  repository.add(record({ localTransactionId: 'first', transactionHash: null, status: 'draft', provenance: 'local_wallet' }));
  await storage.waitForWriteCount(1);
  storage.onAfterFailure = () => repository.add(record({
    localTransactionId: 'second', transactionHash: `0x${'4'.repeat(64)}` as const,
  }));
  const failedFlush = repository.flush();
  storage.failNext();
  await assert.rejects(failedFlush);
  await storage.waitForWriteCount(2);
  assert.equal(JSON.parse(storage.pending[0]!.value).generation, 1);
  assert.equal(JSON.parse(storage.pending[0]!.value).records.length, 2);
  const recoveredFlush = repository.flush();
  storage.completeNext();
  await recoveredFlush;
  assert.equal(repository.getIntegrityState(), 'ready');
});

test('reset waits for a pending write, coalesces repeat requests, and stale writes cannot recreate slots', async () => {
  const storage = new DeferredStorage();
  const repository = new PersistentActivityRepository('wallet-reset-pending', storage, () => 1000);
  await repository.ready();
  repository.add(record());
  await storage.waitForWriteCount(1);
  const resetOne = repository.clearDurable();
  const resetTwo = repository.clearDurable();
  assert.equal(resetOne, resetTwo);
  storage.completeNext();
  await resetOne;
  assert.equal(storage.values.size, 0);
  assert.equal(storage.removeCount, 2);
  assert.equal(repository.getIntegrityState(), 'cleared');
  assert.throws(() => repository.add(record()), { code: 'PERSISTENCE_CLEARED' });
  const reopened = new PersistentActivityRepository('wallet-reset-pending', storage, () => 1000);
  await reopened.ready();
  assert.equal(reopened.listAll().length, 0);
});

test('background-style flush waits for an in-flight snapshot write', async () => {
  const storage = new DeferredStorage();
  const repository = new PersistentActivityRepository('wallet-background-flush', storage, () => 1000);
  await repository.ready();
  repository.add(record());
  await storage.waitForWriteCount(1);
  let completed = false;
  const flush = repository.flush().then(() => { completed = true; });
  assert.equal(completed, false);
  storage.completeNext();
  await flush;
  assert.equal(completed, true);
});

test('failed clear leaves old records scoped to the old wallet identity', async () => {
  const storage = new MemoryStorage();
  const oldWallet = new PersistentActivityRepository('wallet-old', storage, () => 1000);
  await oldWallet.ready();
  oldWallet.add(record());
  await oldWallet.flush();
  storage.failRemoves = true;
  await assert.rejects(oldWallet.clearDurable());
  storage.failRemoves = false;
  const newWallet = new PersistentActivityRepository('wallet-new', storage, () => 1000);
  await newWallet.ready();
  assert.equal(newWallet.listAll().length, 0);
  const oldWalletRestart = new PersistentActivityRepository('wallet-old', storage, () => 1000);
  await oldWalletRestart.ready();
  assert.equal(oldWalletRestart.listAll().length, 1);
});

test('terminal records are evicted before pending records at capacity', async () => {
  const storage = new MemoryStorage();
  const repository = new PersistentActivityRepository('wallet-terminal-prune', storage, () => 1000);
  await repository.ready();
  repository.add(record({ localTransactionId: 'old-failed', transactionHash: null, status: 'failed', provenance: 'local_wallet', observedAt: 1 }));
  for (let index = 1; index <= 500; index++) {
    repository.add(record({ localTransactionId: `pending-${index}`, transactionHash: `0x${index.toString(16).padStart(64, '0')}` as `0x${string}`, status: 'draft', provenance: 'local_wallet' }));
  }
  assert.equal(repository.listAll().length, 500);
  assert.equal(repository.getById('old-failed', { accountId: 'account-1', networkId: 'ethereum', chainId: 1n }), null);
  assert.equal(repository.getRetentionState().pendingCount, 500);
});
