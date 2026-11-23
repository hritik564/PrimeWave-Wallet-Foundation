import type { ActivityRecord, ActivityRecordInput } from './models';
import { ActivityError } from './errors';
import { InMemoryActivityRepository, type ActivityRepository } from './repository';

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

interface Snapshot {
  readonly format: 'wavex-activity';
  readonly version: 1;
  readonly walletId: string;
  readonly generation: number;
  readonly records: readonly unknown[];
}

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
  const statusMatchesConfirmation = record.status !== 'confirmed' && record.status !== 'reverted' ||
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
    safeOrNull(record.broadcastAt) && safeOrNull(record.confirmedAt) &&
    safeOrNull(record.blockTimestamp) &&
    (record.amountDecimals === null || (record.amountDecimals !== undefined && Number.isSafeInteger(record.amountDecimals) && record.amountDecimals >= 0 && record.amountDecimals <= 255)) &&
    (confirmation === null || (
      !!confirmation && typeof confirmation === 'object' &&
      CONFIRMATION_STATES.has(confirmation.state) &&
      Number.isSafeInteger(confirmation.polls) && confirmation.polls >= 0 &&
      Number.isSafeInteger(confirmation.checkedAtMs) &&
      (confirmation.receipt === null || typeof confirmation.receipt === 'object')
    ));
}

function validSnapshot(value: unknown, walletId: string): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<Snapshot>;
  return snapshot.format === 'wavex-activity' && snapshot.version === 1 &&
    snapshot.walletId === walletId && Number.isSafeInteger(snapshot.generation) &&
    (snapshot.generation ?? 0) >= 0 && Array.isArray(snapshot.records);
}

/** Wallet-partitioned public activity storage with two complete recovery snapshots. */
export class PersistentActivityRepository implements ActivityRepository {
  private readonly memory = new InMemoryActivityRepository();
  private readonly slotKeys: readonly [string, string];
  private generation = 0;
  private readonly readyPromise: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastWriteError: unknown = null;
  private writeScheduled = false;
  private persistenceRequested = false;

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
  async flush(): Promise<void> {
    await this.readyPromise;
    await this.writeQueue;
    if (this.lastWriteError) throw this.lastWriteError;
  }

  add(input: ActivityRecordInput): ActivityRecord {
    const record = this.memory.add(input);
    this.changed();
    return record;
  }
  upsert(input: ActivityRecordInput): ActivityRecord {
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
    const record = this.memory.updateStatus(id, scope, update);
    this.changed();
    return record;
  }
  remove(id: string, scope: Parameters<ActivityRepository['remove']>[1]): boolean {
    const removed = this.memory.remove(id, scope);
    if (removed) this.changed();
    return removed;
  }
  clear(): void { void this.clearDurable().catch(() => undefined); }

  async clearDurable(): Promise<void> {
    this.memory.clear();
    this.writeQueue = this.writeQueue.then(async () => {
      await this.readyPromise;
      await Promise.all(this.slotKeys.map((key) => this.storage.removeItem(key)));
      this.generation = 0;
      this.lastWriteError = null;
    });
    await this.writeQueue;
  }

  private changed(): void {
    this.prune();
    this.persistenceRequested = true;
    if (this.writeScheduled) return;
    this.writeScheduled = true;
    this.writeQueue = this.writeQueue.then(async () => {
      await this.readyPromise;
      do {
        this.persistenceRequested = false;
        const nextGeneration = this.generation + 1;
        const snapshot: Snapshot = {
          format: 'wavex-activity', version: 1, walletId: this.walletId,
          generation: nextGeneration, records: this.memory.listAll(),
        };
        const target = this.slotKeys[nextGeneration % 2];
        try {
          await this.storage.setItem(target, encode(snapshot));
          this.generation = nextGeneration;
          this.lastWriteError = null;
        } catch (error) {
          this.lastWriteError = error;
          throw error;
        }
      } while (this.persistenceRequested);
    }).catch((error: unknown) => { this.lastWriteError = error; });
    void this.writeQueue.finally(() => { this.writeScheduled = false; });
  }

  private prune(): void {
    const records = [...this.memory.listAll()];
    const cutoff = this.now() - MAX_AGE_MS;
    const expired = records.filter((record) => TERMINAL.has(record.status) && record.observedAt < cutoff);
    const candidates = records.filter((record) => !expired.includes(record));
    candidates.sort((left, right) => {
      const terminalOrder = Number(!TERMINAL.has(left.status)) - Number(!TERMINAL.has(right.status));
      return terminalOrder || left.observedAt - right.observedAt;
    });
    const overflow = Math.max(0, candidates.length - MAX_RECORDS);
    this.memory.prune([...expired, ...candidates.slice(0, overflow)]);
  }

  private async load(): Promise<void> {
    // An I/O error is not the same as an empty store. Keep writes disabled if the
    // old snapshots could not be read, so a later mutation cannot overwrite them.
    const values = await Promise.all(this.slotKeys.map((key) => this.storage.getItem(key)));
    const snapshots = values.flatMap((value) => {
      if (!value) return [];
      try {
        const parsed = decode(value);
        return validSnapshot(parsed, this.walletId) ? [parsed] : [];
      } catch { return []; }
    }).sort((left, right) => right.generation - left.generation);
    const snapshot = snapshots[0];
    if (!snapshot) return;
    this.generation = snapshot.generation;
    for (const value of snapshot.records) {
      if (!validRecord(value)) continue;
      try { this.memory.upsert(value); } catch { /* Discard invalid local record only. */ }
    }
    this.prune();
  }
}
