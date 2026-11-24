import { sha256 } from '@noble/hashes/sha2.js';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { AssetError } from '../../errors';
import { getAssetIdentityKey } from '../../registry';
import type {
  TokenAssetIdentity,
} from '../../models';
import type {
  TokenPreferencePersistenceState,
  TokenPreferenceRecord,
  TokenPreferenceRepository,
  TokenProvenance,
  TokenVisibility,
} from './models';

export interface TokenPreferenceKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface SnapshotBody {
  readonly format: 'wavex-token-preferences';
  readonly version: 1;
  readonly walletId: string;
  readonly generation: number;
  readonly records: readonly unknown[];
}
interface Snapshot extends SnapshotBody { readonly checksum: string; }
interface Candidate { readonly snapshot: Snapshot; readonly slot: number; }

const PROVENANCE = new Set<TokenProvenance>(['user_added', 'discovered', 'registry', 'external_source']);
const VISIBILITY = new Set<TokenVisibility>(['visible', 'hidden']);
const MAX_RECORDS = 500;

function encode(value: unknown): string { return JSON.stringify(value); }
function body(walletId: string, generation: number, records: readonly unknown[]): SnapshotBody {
  return { format: 'wavex-token-preferences', version: 1, walletId, generation, records };
}
function checksum(value: SnapshotBody): string {
  return [...sha256(new TextEncoder().encode(encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function makeSnapshot(walletId: string, generation: number, records: readonly TokenPreferenceRecord[]): Snapshot {
  const snapshotBody = body(walletId, generation, records);
  return { ...snapshotBody, checksum: checksum(snapshotBody) };
}

function normalizeRecord(value: unknown): TokenPreferenceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TokenPreferenceRecord>;
  const identity = record.assetIdentity;
  if (!identity || identity.assetType !== 'fungible_token' || typeof identity.networkId !== 'string' || !identity.networkId.trim() || identity.networkId.length > 128) return null;
  let address: string;
  try { address = normalizePublicEvmAddress(identity.contractAddress); } catch { return null; }
  if (address !== identity.contractAddress || address !== identity.assetId) return null;
  if (!Number.isSafeInteger(record.chainId) || (record.chainId ?? -1) < 0) return null;
  if (!VISIBILITY.has(record.visibility as TokenVisibility)) return null;
  if (!Array.isArray(record.provenance) || record.provenance.length === 0 || record.provenance.some((source) => !PROVENANCE.has(source))) return null;
  const metadata = record.metadataSnapshot;
  if (!metadata || typeof metadata !== 'object' ||
      !['complete', 'partial', 'unavailable', 'invalid'].includes(metadata.metadataStatus) ||
      (metadata.name !== null && typeof metadata.name !== 'string') ||
      (metadata.symbol !== null && typeof metadata.symbol !== 'string') ||
      (typeof metadata.name === 'string' && (metadata.name.length > 256 || /[\u0000-\u001f\u007f]/.test(metadata.name))) ||
      (typeof metadata.symbol === 'string' && (metadata.symbol.length > 64 || /[\u0000-\u001f\u007f]/.test(metadata.symbol))) ||
      (metadata.decimals !== null && (!Number.isSafeInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 36)) ||
      !Number.isSafeInteger(metadata.observedAtMs) || metadata.observedAtMs < 0) return null;
  if (!Number.isSafeInteger(record.createdAtMs) || (record.createdAtMs ?? -1) < 0 ||
      !Number.isSafeInteger(record.updatedAtMs) || (record.updatedAtMs ?? -1) < 0) return null;
  const canonicalIdentity: TokenAssetIdentity = Object.freeze({
    assetType: 'fungible_token', networkId: identity.networkId, assetId: address, contractAddress: address,
  });
  return Object.freeze({
    assetIdentity: canonicalIdentity,
    chainId: record.chainId!,
    visibility: record.visibility as TokenVisibility,
    provenance: Object.freeze([...new Set(record.provenance as TokenProvenance[])]),
    metadataSnapshot: Object.freeze({ ...metadata }),
    createdAtMs: record.createdAtMs!,
    updatedAtMs: record.updatedAtMs!,
  });
}

function decodeCandidate(raw: string, walletId: string, slot: number): Candidate | null {
  if (raw.length > 1_000_000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const snapshot = parsed as Partial<Snapshot>;
  if (snapshot.format !== 'wavex-token-preferences' || snapshot.version !== 1 || snapshot.walletId !== walletId ||
      !Number.isSafeInteger(snapshot.generation) || (snapshot.generation ?? -1) < 0 || !Array.isArray(snapshot.records) ||
      snapshot.records.length > MAX_RECORDS || typeof snapshot.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.checksum)) return null;
  const normalized = snapshot.records.map(normalizeRecord);
  if (normalized.some((record) => record === null)) return null;
  const unique = new Set(normalized.map((record) => getAssetIdentityKey(record!.assetIdentity)));
  if (unique.size !== normalized.length) return null;
  const cleanBody = body(walletId, snapshot.generation!, normalized as TokenPreferenceRecord[]);
  if (checksum(cleanBody) !== snapshot.checksum) return null;
  return { snapshot: { ...cleanBody, checksum: snapshot.checksum }, slot };
}

/** Wallet-partitioned local storage for public ERC-20 identities and display preferences. */
export class PersistentTokenPreferenceRepository implements TokenPreferenceRepository {
  private readonly keys: readonly [string, string];
  private records = new Map<string, TokenPreferenceRecord>();
  private generation = 0;
  private readonly readyPromise: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private state: TokenPreferencePersistenceState = 'loading';
  private listeners = new Set<(state: TokenPreferencePersistenceState) => void>();
  private retired = false;
  private clearPromise: Promise<void> | null = null;

  constructor(private readonly walletId: string, private readonly storage: TokenPreferenceKeyValueStorage) {
    if (!walletId.trim()) throw new AssetError('DISCOVERY_PERSISTENCE_FAILED');
    const prefix = `wavex.token-preferences.v1.${encodeURIComponent(walletId)}`;
    this.keys = [`${prefix}.a`, `${prefix}.b`];
    this.readyPromise = this.load();
    void this.readyPromise.catch(() => undefined);
  }

  ready(): Promise<void> { return this.readyPromise; }
  getPersistenceState(): TokenPreferencePersistenceState { return this.state; }
  subscribePersistenceState(listener: (state: TokenPreferencePersistenceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async get(identity: TokenAssetIdentity): Promise<TokenPreferenceRecord | undefined> {
    await this.readyPromise;
    this.assertReadable();
    const value = this.records.get(getAssetIdentityKey(identity));
    return value ? normalizeRecord(value) ?? undefined : undefined;
  }

  async list(): Promise<readonly TokenPreferenceRecord[]> {
    await this.readyPromise;
    this.assertReadable();
    return Object.freeze([...this.records.values()].map((record) => normalizeRecord(record)!));
  }

  async save(record: TokenPreferenceRecord): Promise<void> {
    await this.readyPromise;
    const normalized = normalizeRecord(record);
    if (!normalized) throw new AssetError('DISCOVERY_INVALID_TOKEN');
    await this.enqueue(async () => {
      this.assertWritable();
      const next = new Map(this.records);
      next.set(getAssetIdentityKey(normalized.assetIdentity), normalized);
      if (next.size > MAX_RECORDS) throw new AssetError('DISCOVERY_PERSISTENCE_FAILED');
      await this.write(next);
    });
  }

  async delete(identity: TokenAssetIdentity): Promise<void> {
    await this.readyPromise;
    await this.enqueue(async () => {
      this.assertWritable();
      const next = new Map(this.records);
      next.delete(getAssetIdentityKey(identity));
      await this.write(next);
    });
  }

  clearDurable(): Promise<void> {
    if (this.clearPromise) return this.clearPromise;
    this.retired = true;
    this.clearPromise = this.enqueue(async () => {
      await Promise.all(this.keys.map((key) => this.storage.removeItem(key)));
      this.records.clear();
      this.generation = 0;
      this.setState('cleared');
    }, true).catch((error: unknown) => {
      this.setState('unavailable');
      throw error;
    });
    void this.clearPromise.catch(() => undefined);
    return this.clearPromise;
  }

  private async load(): Promise<void> {
    let values: readonly [string | null, string | null];
    try { values = await Promise.all(this.keys.map((key) => this.storage.getItem(key))) as [string | null, string | null]; }
    catch { this.setState('unavailable'); throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE'); }
    const candidates = values.flatMap((raw, slot) => raw === null ? [] : [decodeCandidate(raw, this.walletId, slot)].filter((value): value is Candidate => value !== null));
    candidates.sort((left, right) => right.snapshot.generation - left.snapshot.generation);
    const selected = candidates[0];
    if (!selected) {
      if (values.some((value) => value !== null)) {
        this.setState('unavailable');
        throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE');
      }
      this.setState('ready');
      return;
    }
    this.generation = selected.snapshot.generation;
    for (const value of selected.snapshot.records) {
      const record = normalizeRecord(value);
      if (!record) { this.setState('unavailable'); throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE'); }
      this.records.set(getAssetIdentityKey(record.assetIdentity), record);
    }
    const corruptSlot = values.some((raw, slot) => raw !== null && !candidates.some((candidate) => candidate.slot === slot));
    if (corruptSlot) {
      const nextGeneration = this.generation + 1;
      const target = selected.slot === 0 ? 1 : 0;
      try {
        await this.storage.setItem(this.keys[target]!, encode(makeSnapshot(this.walletId, nextGeneration, [...this.records.values()])));
        this.generation = nextGeneration;
      } catch {
        this.setState('unavailable');
        throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE');
      }
    }
    this.setState('ready');
  }

  private async write(next: Map<string, TokenPreferenceRecord>): Promise<void> {
    const nextGeneration = this.generation + 1;
    const target = this.keys[nextGeneration % 2]!;
    try {
      await this.storage.setItem(target, encode(makeSnapshot(this.walletId, nextGeneration, [...next.values()])));
      this.records = next;
      this.generation = nextGeneration;
      this.setState('ready');
    } catch {
      this.setState('write-failed');
      throw new AssetError('DISCOVERY_PERSISTENCE_FAILED');
    }
  }

  private enqueue(operation: () => Promise<void>, allowRetired = false): Promise<void> {
    const task = this.queue.then(async () => {
      if (allowRetired) await this.readyPromise.catch(() => undefined);
      else await this.readyPromise;
      if (!allowRetired) this.assertWritable();
      await operation();
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private assertReadable(): void {
    if (this.state === 'unavailable') throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE');
    if (this.retired) throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE');
  }
  private assertWritable(): void {
    if (this.retired || this.state === 'unavailable') throw new AssetError('DISCOVERY_PREFERENCES_UNAVAILABLE');
  }
  private setState(state: TokenPreferencePersistenceState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) { try { listener(state); } catch { /* Observational listeners cannot affect persistence. */ } }
  }
}
