import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistentTokenPreferenceRepository, type TokenPreferenceKeyValueStorage } from '../persistent-repository';
import type { TokenPreferenceRecord } from '../models';

const contract = '0x0000000000000000000000000000000000000011';
function preference(overrides: Partial<TokenPreferenceRecord> = {}): TokenPreferenceRecord {
  return {
    assetIdentity: { assetType: 'fungible_token', networkId: 'ethereum', assetId: contract, contractAddress: contract },
    chainId: 1,
    visibility: 'visible',
    provenance: ['user_added'],
    metadataSnapshot: { name: 'Cached label', symbol: 'CACHE', decimals: 18, metadataStatus: 'complete', observedAtMs: 10 },
    createdAtMs: 10,
    updatedAtMs: 10,
    ...overrides,
  };
}

class Storage implements TokenPreferenceKeyValueStorage {
  readonly values = new Map<string, string>();
  failRead = false;
  failNextWrite = false;
  writes = 0;
  pending: { key: string; value: string; resolve: () => void }[] = [];
  deferWrites = false;
  async getItem(key: string) { if (this.failRead) throw new Error('unavailable'); return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    this.writes++;
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('write failed'); }
    if (this.deferWrites) await new Promise<void>((resolve) => this.pending.push({ key, value, resolve: () => { this.values.set(key, value); resolve(); } }));
    else this.values.set(key, value);
  }
  async removeItem(key: string) { this.values.delete(key); }
  completeNext() { const pending = this.pending.shift(); assert.ok(pending); pending.resolve(); }
}

test('persistent preference repository restores public identity and hidden preference', async () => {
  const storage = new Storage();
  const first = new PersistentTokenPreferenceRepository('wallet-one', storage);
  await first.ready();
  await first.save(preference({ visibility: 'hidden', chainId: 1 }));
  const reopened = new PersistentTokenPreferenceRepository('wallet-one', storage);
  await reopened.ready();
  const restored = await reopened.list();
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.visibility, 'hidden');
  assert.equal(restored[0]?.chainId, 1);
  assert.equal(restored[0]?.assetIdentity.contractAddress, contract);
});

test('invalid identity and corrupted nonempty snapshots fail closed without fabrication', async () => {
  const storage = new Storage();
  const repository = new PersistentTokenPreferenceRepository('wallet-corrupt', storage);
  await repository.ready();
  await assert.rejects(repository.save(preference({ assetIdentity: { assetType: 'fungible_token', networkId: 'ethereum', assetId: 'not-an-address', contractAddress: 'not-an-address' } })));
  await repository.save(preference());
  const key = [...storage.values.keys()][0]!;
  storage.values.set(key, '{ truncated');
  const reopened = new PersistentTokenPreferenceRepository('wallet-corrupt', storage);
  await assert.rejects(reopened.ready());
  assert.equal(reopened.getPersistenceState(), 'unavailable');
  await assert.rejects(reopened.list());
});

test('read failure preserves stored preferences for later recovery', async () => {
  const storage = new Storage();
  const first = new PersistentTokenPreferenceRepository('wallet-read-error', storage);
  await first.ready();
  await first.save(preference());
  const before = new Map(storage.values);
  const writeCount = storage.writes;
  storage.failRead = true;
  const failed = new PersistentTokenPreferenceRepository('wallet-read-error', storage);
  await assert.rejects(failed.ready());
  assert.equal(failed.getPersistenceState(), 'unavailable');
  assert.equal(storage.writes, writeCount);
  assert.deepEqual(storage.values, before);
  storage.failRead = false;
  const recovered = new PersistentTokenPreferenceRepository('wallet-read-error', storage);
  await recovered.ready();
  assert.equal((await recovered.list()).length, 1);
});

test('corrupt newest preference snapshot falls back to older valid preferences and repairs it', async () => {
  const storage = new Storage();
  const first = new PersistentTokenPreferenceRepository('wallet-fallback', storage);
  await first.ready();
  await first.save(preference({ visibility: 'visible' }));
  await first.save(preference({ visibility: 'hidden', updatedAtMs: 11 }));
  const keys = [...storage.values.keys()];
  const snapshots = keys.map((key) => ({ key, snapshot: JSON.parse(storage.values.get(key)!) }));
  snapshots.sort((left, right) => right.snapshot.generation - left.snapshot.generation);
  const newest = snapshots[0]!;
  newest.snapshot.records[0].visibility = 'visible';
  storage.values.set(newest.key, JSON.stringify(newest.snapshot));

  const recovered = new PersistentTokenPreferenceRepository('wallet-fallback', storage);
  await recovered.ready();
  assert.equal((await recovered.get(preference().assetIdentity))?.visibility, 'visible');
  assert.equal(recovered.getPersistenceState(), 'ready');
  const repaired = new PersistentTokenPreferenceRepository('wallet-fallback', storage);
  await repaired.ready();
  assert.equal((await repaired.get(preference().assetIdentity))?.visibility, 'visible');
});

test('write failures are reported and a later mutation retries from the last committed generation', async () => {
  const storage = new Storage();
  const repository = new PersistentTokenPreferenceRepository('wallet-write-retry', storage);
  await repository.ready();
  await repository.save(preference({ visibility: 'visible' }));
  storage.failNextWrite = true;
  await assert.rejects(repository.save(preference({ visibility: 'hidden', updatedAtMs: 11 })));
  assert.equal(repository.getPersistenceState(), 'write-failed');
  const reopened = new PersistentTokenPreferenceRepository('wallet-write-retry', storage);
  await reopened.ready();
  assert.equal((await reopened.get(preference().assetIdentity))?.visibility, 'visible');
  await repository.save(preference({ visibility: 'hidden', updatedAtMs: 12 }));
  assert.equal(repository.getPersistenceState(), 'ready');
  const retried = new PersistentTokenPreferenceRepository('wallet-write-retry', storage);
  await retried.ready();
  assert.equal((await retried.get(preference().assetIdentity))?.visibility, 'hidden');
});

test('delayed save cannot recreate preference snapshots after reset completes', async () => {
  const storage = new Storage();
  const repository = new PersistentTokenPreferenceRepository('wallet-reset', storage);
  await repository.ready();
  storage.deferWrites = true;
  const saving = repository.save(preference());
  while (storage.pending.length === 0) await Promise.resolve();
  const clearing = repository.clearDurable();
  assert.equal(repository.clearDurable(), clearing);
  storage.completeNext();
  await saving;
  await clearing;
  assert.equal(storage.values.size, 0);
  assert.equal(repository.getPersistenceState(), 'cleared');
  await assert.rejects(repository.save(preference()));
});

test('wallet identities partition token preference records', async () => {
  const storage = new Storage();
  const first = new PersistentTokenPreferenceRepository('wallet-a', storage);
  const second = new PersistentTokenPreferenceRepository('wallet-b', storage);
  await Promise.all([first.ready(), second.ready()]);
  await first.save(preference());
  assert.equal((await first.list()).length, 1);
  assert.equal((await second.list()).length, 0);
});
