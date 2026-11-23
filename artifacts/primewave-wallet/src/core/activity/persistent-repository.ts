import { sha256 } from '@noble/hashes/sha2.js';
import type { ActivityRecord, ActivityRecordInput } from './models';
import { ActivityError } from './errors';
import { InMemoryActivityRepository, type ActivityRepository } from './repository';
import type { ActivityIntegrityState, ActivityRetentionState } from './repository';

export interface ActivityKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MAX_RECORDS = 500;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(['confirmed', 'reverted', 'failed']);
const STATUSES = new Set(['draft', 'signed', 'broadcasting', 'broadcasted', 'confirming', 'confirmed', 'reverted', 'failed', 'unknown']);
const TYPES = new Set(['native-transfer', 'erc20-transfer', 'contract-interaction', 'unknown']);
const DIRECTIONS = new Set(['outgoing', 'incoming', 'self-transfer', 'unknown']);
const PROVENANCE = new Set(['local_wallet', 'broadcast_engine', 'confirmation_engine', 'blockchain_read', 'external_indexer_future']);
const CONFIRMATION_STATES = new Set(['confirmed', 'reverted', 'unknown']);

interface SnapshotBody {
  readonly format: 'wavex-activity';
  readonly version: 1;
  readonly walletId: string;
  readonly generation: number;
  readonly records: readonly unknown[];
}
interface Snapshot extends SnapshotBody { readonly checksum?: string; }
interface Candidate { readonly snapshot: Snapshot; readonly repository: InMemoryActivityRepository; readonly slot: number; }

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? { $wavexBigInt: item.toString() } : item,
  );
}
function decode(value: string): unknown {
  return JSON.parse(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && '$wavexBigInt' in item) {
      const encoded = (item as { $wavexBigInt?: unknown }).$wavexBigInt;
      if (typeof encoded !== 'string' || !/^-?\d+$/.test(encoded)) throw new Error('invalid integer');
      return BigInt(encoded);
    }
    return item;
  });
}
function digest(body: SnapshotBody): string {
  return [...sha256(new TextEncoder().encode(encode(body)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function snapshotBody(walletId: string, generation: number, records: readonly unknown[]): SnapshotBody {
  return { format: 'wavex-activity', version: 1, walletId, generation, records };
}
function makeSnapshot(walletId: string, generation: number, records: readonly ActivityRecord[]): Snapshot {
  const body = snapshotBody(walletId, generation, records);
  return { ...body, checksum: digest(body) };
}
function snapshotChecksumMatches(snapshot: Snapshot): boolean {
  if (snapshot.checksum === undefined) return true; // C3.3A version-1 compatibility.
  if (typeof snapshot.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.checksum)) return false;
  return snapshot.checksum === digest(snapshotBody(snapshot.walletId, snapshot.generation, snapshot.records));
}

function bigintOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'bigint' && value >= 0n);
}
function validRecord(value: unknown): value is ActivityRecordInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ActivityRecord>;
  const safeOrNull = (candidate: unknown) => candidate === null || Number.isSafeInteger(candidate);
  const confirmation = record.confirmation;
  const receipt = confirmation?.receipt ?? null;
  const identity = record.assetIdentity;
  const identityValid = identity === null || (!!identity &&
    typeof identity === 'object' && identity.networkId === record.networkId &&
    typeof identity.assetId === 'string' && identity.assetId.length > 0 &&
    ['native', 'fungible_token', 'nft'].includes(identity.assetType) &&
    (identity.assetType !== 'fungible_token' ||
      ('contractAddress' in identity && typeof identity.contractAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(identity.contractAddress))));
  const statusMatchesConfirmation = (record.status !== 'confirmed' && record.status !== 'reverted') ||
    (confirmation !== null && confirmation?.state === record.status && receipt !== null);
  const receiptValid = receipt === null || (!!receipt && typeof receipt === 'object' &&
    typeof receipt.transactionHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash) &&
    typeof receipt.blockHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) &&
    typeof receipt.blockNumber === 'bigint' && receipt.blockNumber >= 0n &&
    (receipt.status === 'success' || receipt.status === 'reverted') &&
    typeof receipt.gasUsed === 'bigint' && receipt.gasUsed >= 0n &&
    (receipt.effectiveGasPrice === null || (typeof receipt.effectiveGasPrice === 'bigint' && receipt.effectiveGasPrice >= 0n)));
  return record.kind === 'activity-record' &&
    typeof record.accountId === 'string' && record.accountId.length > 0 &&
    typeof record.networkId === 'string' && record.networkId.length > 0 &&
    typeof record.chainId === 'bigint' && record.chainId >= 0n &&
    typeof record.senderAddress === 'string' &&
    (record.localTransactionId === null || typeof record.localTransactionId === 'string') &&
    (record.transactionHash === null || typeof record.transactionHash === 'string') &&
    STATUSES.has(record.status as string) && TYPES.has(record.transactionType as string) &&
    DIRECTIONS.has(record.direction as string) && PROVENANCE.has(record.provenance as string) &&
    identityValid && statusMatchesConfirmation && receiptValid &&
    bigintOrNull(record.amountRaw) && bigintOrNull(record.nativeValue) &&
    bigintOrNull(record.nonce) && bigintOrNull(record.gasLimit) && bigintOrNull(record.feeAmount) &&
    Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.observedAt) &&
    safeOrNull(record.broadcastAt) && safeOrNull(record.confirmedAt) && safeOrNull(record.blockTimestamp) &&
    (record.amountDecimals === null || (record.amountDecimals !== undefined && Number.isSafeInteger(record.amountDecimals) && record.amountDecimals >= 0 && record.amountDecimals <= 255)) &&
    (confirmation === null || (
      !!confirmation && typeof confirmation === 'object' &&
      CONFIRMATION_STATES.has(confirmation.state) &&
      Number.isSafeInteger(confirmation.polls) && confirmation.polls >= 0 &&
      Number.isSafeInteger(confirmation.checkedAtMs) &&
      (confirmation.receipt === null || typeof confirmation.receipt === 'object')
    ));
}
function validSnapshotEnvelope(value: unknown, walletId: string): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<Snapshot>;
  return snapshot.format === 'wavex-activity' && snapshot.version === 1 &&
    snapshot.walletId === walletId && Number.isSafeInteger(snapshot.generation) &&
    (snapshot.generation ?? 0) >= 0 && Array.isArray(snapshot.records) && snapshotChecksumMatches(snapshot as Snapshot);
}

/** Wallet-partitioned public Activity storage with validated alternating snapshots. */
export class PersistentActivityRepository implements ActivityRepository {
  private readonly memory = new InMemoryActivityRepository();
  private readonly slotKeys: readonly [string, string];
  private generation = 0;
  private readonly readyPromise: Promise<void>;
  private drainPromise: Promise<void> | null = null;
  private acceptedRevision = 0;
  private persistedRevision = 0;
  private lastWriteError: unknown = null;
  private lastFailedRevision = 0;
  private integrityState: ActivityIntegrityState = 'loading';
  private stableIntegrityState: ActivityIntegrityState = 'ready';
  private integrityListeners = new Set<(state: ActivityIntegrityState) => void>();
  private retired = false;
  private clearPromise: Promise<void> | null = null;

  constructor(
    private readonly walletId: string,
    private readonly storage: ActivityKeyValueStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!walletId.trim()) throw new ActivityError('INVALID_RECORD');
    const prefix = `wavex.activity.v1.${encodeURIComponent(walletId)}`;
    this.slotKeys = [`${prefix}.a`, `${prefix}.b`];
    this.readyPromise = this.load();
    void this.readyPromise.catch(() => undefined);
  }

  ready(): Promise<void> { return this.readyPromise; }
  getIntegrityState(): ActivityIntegrityState { return this.integrityState; }
  subscribeIntegrityState(listener: (state: ActivityIntegrityState) => void): () => void {
    this.integrityListeners.add(listener);
    return () => this.integrityListeners.delete(listener);
  }
  getRetentionState(): ActivityRetentionState {
    const records = this.memory.listAll();
    const pendingCount = records.filter((record) => !TERMINAL.has(record.status)).length;
    return Object.freeze({
      capacity: MAX_RECORDS,
      recordCount: records.length,
      pendingCount,
      overflowCount: Math.max(0, records.length - MAX_RECORDS),
      status: records.length > MAX_RECORDS ? 'pending-overflow' : 'within-capacity',
    });
  }

  async flush(): Promise<void> {
    await this.readyPromise;
    while (this.persistedRevision < this.acceptedRevision) await this.startDrain();
    if (this.lastWriteError) throw this.lastWriteError;
  }

  add(input: ActivityRecordInput): ActivityRecord {
    this.assertActive();
    const record = this.memory.add(input);
    this.changed();
    return record;
  }
  upsert(input: ActivityRecordInput): ActivityRecord {
    this.assertActive();
    const record = this.memory.upsert(input);
    this.changed();
    return record;
  }
  getById(id: string, scope: Parameters<ActivityRepository['getById']>[1]) { return this.memory.getById(id, scope); }
  getByHash(hash: string, scope: Parameters<ActivityRepository['getByHash']>[1]) { return this.memory.getByHash(hash, scope); }
  listByAccountAndNetwork(scope: Parameters<ActivityRepository['listByAccountAndNetwork']>[0], options?: Parameters<ActivityRepository['listByAccountAndNetwork']>[1]) {
    return this.memory.listByAccountAndNetwork(scope, options);
  }
  listAll(): readonly ActivityRecord[] { return this.memory.listAll(); }
  updateStatus(id: string, scope: Parameters<ActivityRepository['updateStatus']>[1], update: Parameters<ActivityRepository['updateStatus']>[2]) {
    this.assertActive();
    const record = this.memory.updateStatus(id, scope, update);
    this.changed();
    return record;
  }
  remove(id: string, scope: Parameters<ActivityRepository['remove']>[1]): boolean {
    this.assertActive();
    const removed = this.memory.remove(id, scope);
    if (removed) this.changed();
    return removed;
  }
  clear(): void { void this.clearDurable().catch(() => undefined); }

  clearDurable(): Promise<void> {
    if (this.clearPromise) return this.clearPromise;
    this.retired = true;
    this.memory.clear();
    const pendingDrain = this.drainPromise;
    this.clearPromise = (async () => {
      if (pendingDrain) await pendingDrain.catch(() => undefined);
      await Promise.all(this.slotKeys.map((key) => this.storage.removeItem(key)));
      this.generation = 0;
      this.acceptedRevision = 0;
      this.persistedRevision = 0;
      this.lastWriteError = null;
      this.lastFailedRevision = 0;
      this.setIntegrityState('cleared');
    })().catch((error: unknown) => {
      this.setIntegrityState('unavailable');
      throw error;
    });
    void this.clearPromise.catch(() => undefined);
    return this.clearPromise;
  }

  private assertActive(): void {
    if (this.retired) throw new ActivityError('PERSISTENCE_CLEARED');
    if (this.integrityState === 'unavailable') throw new ActivityError('PERSISTENCE_CORRUPT');
  }

  private setIntegrityState(state: ActivityIntegrityState): void {
    if (this.integrityState === state) return;
    this.integrityState = state;
    for (const listener of this.integrityListeners) {
      try { listener(state); } catch { /* Persistence state listeners are observational only. */ }
    }
  }

  private changed(): void {
    this.prune();
    this.acceptedRevision += 1;
    void this.startDrain().catch(() => undefined);
  }

  private startDrain(): Promise<void> {
    if (this.retired) return Promise.reject(new ActivityError('PERSISTENCE_CLEARED'));
    if (this.drainPromise) return this.drainPromise;
    const task = this.drain();
    this.drainPromise = task;
    void task.then(
      () => this.finishDrain(task),
      () => this.finishDrain(task),
    ).catch(() => undefined);
    return task;
  }

  private finishDrain(task: Promise<void>): void {
    if (this.drainPromise !== task) return;
    this.drainPromise = null;
    const mutationArrivedAfterFailure = this.lastWriteError !== null && this.acceptedRevision > this.lastFailedRevision;
    if (!this.retired && this.persistedRevision < this.acceptedRevision &&
        (this.lastWriteError === null || mutationArrivedAfterFailure)) {
      if (mutationArrivedAfterFailure) this.lastWriteError = null;
      void this.startDrain().catch(() => undefined);
    }
  }

  private async drain(): Promise<void> {
    await this.readyPromise;
    if (this.integrityState === 'unavailable') throw new ActivityError('PERSISTENCE_CORRUPT');
    while (!this.retired && this.persistedRevision < this.acceptedRevision) {
      const revision = this.acceptedRevision;
      const nextGeneration = this.generation + 1;
      if (!Number.isSafeInteger(nextGeneration)) throw new ActivityError('PERSISTENCE_CORRUPT');
      const snapshot = makeSnapshot(this.walletId, nextGeneration, this.memory.listAll());
      const target = this.slotKeys[nextGeneration % 2];
      try {
        await this.storage.setItem(target, encode(snapshot));
        this.generation = nextGeneration;
        this.persistedRevision = revision;
        this.lastWriteError = null;
        this.lastFailedRevision = 0;
        this.setIntegrityState(this.stableIntegrityState);
      } catch (error) {
        this.lastWriteError = error;
        this.lastFailedRevision = revision;
        this.setIntegrityState('write-failed');
        throw error;
      }
    }
  }

  private prune(): void {
    const records = [...this.memory.listAll()];
    const cutoff = this.now() - MAX_AGE_MS;
    const expired = records.filter((record) => TERMINAL.has(record.status) && record.observedAt < cutoff);
    const remaining = records.filter((record) => !expired.includes(record));
    const excess = Math.max(0, remaining.length - MAX_RECORDS);
    const terminalCandidates = remaining
      .filter((record) => TERMINAL.has(record.status))
      .sort((left, right) => left.observedAt - right.observedAt);
    this.memory.prune([...expired, ...terminalCandidates.slice(0, excess)]);
  }

  private validateCandidate(value: unknown, slot: number): Candidate | null {
    if (!validSnapshotEnvelope(value, this.walletId)) return null;
    const snapshot = value;
    const repository = new InMemoryActivityRepository();
    try {
      for (const record of snapshot.records) {
        if (!validRecord(record)) return null;
        repository.add(record);
      }
      if (repository.listAll().length !== snapshot.records.length) return null;
    } catch { return null; }
    return { snapshot, repository, slot };
  }

  private async load(): Promise<void> {
    let values: readonly [string | null, string | null];
    try {
      values = await Promise.all(this.slotKeys.map((key) => this.storage.getItem(key))) as [string | null, string | null];
    } catch {
      this.setIntegrityState('unavailable');
      throw new ActivityError('PERSISTENCE_CORRUPT');
    }
    const occupied = values.map((value) => value !== null);
    const candidates: Candidate[] = [];
    for (let slot = 0; slot < values.length; slot++) {
      const raw = values[slot];
      if (raw === null) continue;
      try {
        const candidate = this.validateCandidate(decode(raw), slot);
        if (candidate) candidates.push(candidate);
      } catch { /* Invalid nonempty slots are evaluated as corrupt below. */ }
    }
    candidates.sort((left, right) => right.snapshot.generation - left.snapshot.generation);
    const chosen = candidates[0];
    if (!chosen) {
      if (occupied.some(Boolean)) {
        this.setIntegrityState('unavailable');
        throw new ActivityError('PERSISTENCE_CORRUPT');
      }
      this.stableIntegrityState = 'ready';
      this.setIntegrityState('ready');
      return;
    }

    this.generation = chosen.snapshot.generation;
    for (const record of chosen.repository.listAll()) this.memory.add(record);
    const hadCorruptSlot = occupied.some((isOccupied, slot) => isOccupied && !candidates.some((candidate) => candidate.slot === slot));
    if (!hadCorruptSlot) {
      this.stableIntegrityState = 'ready';
      this.setIntegrityState('ready');
      return;
    }

    // Repair the bad slot from the older complete snapshot before accepting writes.
    const repairGeneration = this.generation + 1;
    if (!Number.isSafeInteger(repairGeneration)) {
      this.setIntegrityState('unavailable');
      throw new ActivityError('PERSISTENCE_CORRUPT');
    }
    const repairSlot = chosen.slot === 0 ? 1 : 0;
    try {
      await this.storage.setItem(this.slotKeys[repairSlot], encode(makeSnapshot(this.walletId, repairGeneration, this.memory.listAll())));
      this.generation = repairGeneration;
      this.stableIntegrityState = 'recovered';
      this.setIntegrityState('recovered');
    } catch {
      this.setIntegrityState('unavailable');
      throw new ActivityError('PERSISTENCE_CORRUPT');
    }
  }
}
