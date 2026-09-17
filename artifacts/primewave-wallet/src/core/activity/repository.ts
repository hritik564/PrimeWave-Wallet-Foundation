import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type { AssetIdentity } from '@/src/core/assets';
import { ActivityError } from './errors';
import type {
  ActivityListOptions,
  ActivityRecord,
  ActivityRecordInput,
  ActivityScope,
  ActivityStatusUpdate,
} from './models';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function scopeKey(scope: ActivityScope): string {
  return `${scope.accountId}|${scope.networkId}|${scope.chainId.toString()}`;
}

function hashKey(hash: string): string {
  return hash.toLowerCase();
}

function cloneAssetIdentity(identity: AssetIdentity | null): AssetIdentity | null {
  return identity ? Object.freeze({ ...identity }) : null;
}

function cloneRecord(record: ActivityRecord): ActivityRecord {
  return Object.freeze({
    ...record,
    chainId: record.chainId,
    assetIdentity: cloneAssetIdentity(record.assetIdentity),
    confirmation: record.confirmation
      ? Object.freeze({
          ...record.confirmation,
          receipt: record.confirmation.receipt
            ? Object.freeze({ ...record.confirmation.receipt })
            : null,
        })
      : null,
  });
}

function validateLimitOffset(options: ActivityListOptions): {
  readonly limit: number;
  readonly offset: number;
} {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new ActivityError('INVALID_QUERY');
  }
  return { limit, offset };
}

function validateScope(scope: ActivityScope): ActivityScope {
  if (
    typeof scope.accountId !== 'string' ||
    scope.accountId.trim().length === 0 ||
    typeof scope.networkId !== 'string' ||
    scope.networkId.trim().length === 0 ||
    typeof scope.chainId !== 'bigint' ||
    scope.chainId < 0n
  ) {
    throw new ActivityError('INVALID_QUERY');
  }
  return Object.freeze({
    accountId: scope.accountId,
    networkId: scope.networkId,
    chainId: scope.chainId,
  });
}

function normalizeOptionalAddress(address: string | null | undefined): string | null {
  if (address === null || address === undefined) return null;
  try {
    return normalizePublicEvmAddress(address);
  } catch {
    throw new ActivityError('INVALID_RECORD');
  }
}

function normalizeRecord(input: ActivityRecordInput): ActivityRecord {
  const scope = validateScope(input);
  const senderAddress = normalizeOptionalAddress(input.senderAddress);
  if (!senderAddress) throw new ActivityError('INVALID_RECORD');
  const recipient = normalizeOptionalAddress(input.recipient);
  const transactionHash = input.transactionHash
    ? hashKey(input.transactionHash) as `0x${string}`
    : null;
  const localTransactionId =
    input.localTransactionId === undefined ? null : input.localTransactionId;
  if (
    localTransactionId !== null &&
    (typeof localTransactionId !== 'string' || localTransactionId.trim().length === 0)
  ) {
    throw new ActivityError('INVALID_RECORD');
  }
  if (!transactionHash && !localTransactionId) {
    throw new ActivityError('INVALID_RECORD');
  }
  if (
    input.assetIdentity &&
    input.assetIdentity.networkId !== scope.networkId
  ) {
    throw new ActivityError('SCOPE_MISMATCH');
  }
  const tokenContractAddress = normalizeOptionalAddress(input.tokenContractAddress);
  if (
    input.amountDecimals !== null &&
    input.amountDecimals !== undefined &&
    (!Number.isSafeInteger(input.amountDecimals) ||
      input.amountDecimals < 0 ||
      input.amountDecimals > 255)
  ) {
    throw new ActivityError('INVALID_RECORD');
  }
  if (
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    (input.broadcastAt !== null &&
      input.broadcastAt !== undefined &&
      (!Number.isSafeInteger(input.broadcastAt) || input.broadcastAt < 0)) ||
    (input.confirmedAt !== null &&
      input.confirmedAt !== undefined &&
      (!Number.isSafeInteger(input.confirmedAt) || input.confirmedAt < 0))
  ) {
    throw new ActivityError('INVALID_RECORD');
  }
  const observedAt = input.observedAt ?? input.confirmedAt ?? input.broadcastAt ?? input.createdAt;
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new ActivityError('INVALID_RECORD');
  }
  return Object.freeze({
    kind: 'activity-record',
    ...scope,
    localTransactionId,
    transactionHash,
    senderAddress,
    transactionType: input.transactionType,
    direction: input.direction,
    assetIdentity: cloneAssetIdentity(input.assetIdentity ?? null),
    recipient,
    amountRaw: input.amountRaw ?? null,
    amountDecimals: input.amountDecimals ?? null,
    amountDisplay: input.amountDisplay ?? null,
    nativeValue: input.nativeValue ?? null,
    tokenContractAddress,
    nonce: input.nonce ?? null,
    gasLimit: input.gasLimit ?? null,
    feeModel: input.feeModel ?? null,
    feeAmount: input.feeAmount ?? null,
    createdAt: input.createdAt,
    broadcastAt: input.broadcastAt ?? null,
    confirmedAt: input.confirmedAt ?? null,
    status: input.status,
    confirmation: input.confirmation
      ? Object.freeze({
          ...input.confirmation,
          receipt: input.confirmation.receipt
            ? Object.freeze({ ...input.confirmation.receipt })
            : null,
        })
      : null,
    explorerUrl: input.explorerUrl ?? null,
    provenance: input.provenance,
    observedAt,
  });
}

function identityKey(record: Pick<ActivityRecord, 'localTransactionId' | 'transactionHash' | 'accountId' | 'networkId' | 'chainId'>): string {
  const scope = scopeKey(record);
  return record.localTransactionId
    ? `local|${scope}|${record.localTransactionId}`
    : `hash|${scope}|${hashKey(record.transactionHash as string)}`;
}

function sameScope(record: ActivityRecord, scope: ActivityScope): boolean {
  return (
    record.accountId === scope.accountId &&
    record.networkId === scope.networkId &&
    record.chainId === scope.chainId
  );
}

function sortRecords(left: ActivityRecord, right: ActivityRecord): number {
  const leftHasBlock = left.confirmation?.receipt?.blockNumber !== undefined &&
    left.confirmation?.receipt?.blockNumber !== null;
  const rightHasBlock = right.confirmation?.receipt?.blockNumber !== undefined &&
    right.confirmation?.receipt?.blockNumber !== null;
  const leftRank = leftHasBlock ? 0 : left.transactionHash ? 1 : 2;
  const rightRank = rightHasBlock ? 0 : right.transactionHash ? 1 : 2;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftHasBlock && rightHasBlock) {
    const blockDifference =
      right.confirmation!.receipt!.blockNumber -
      left.confirmation!.receipt!.blockNumber;
    if (blockDifference !== 0n) return blockDifference > 0n ? 1 : -1;
  }
  if (right.observedAt !== left.observedAt) {
    return right.observedAt - left.observedAt;
  }
  const leftIdentity = identityKey(left);
  const rightIdentity = identityKey(right);
  return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
}

export interface ActivityRepository {
  add(input: ActivityRecordInput): ActivityRecord;
  upsert(input: ActivityRecordInput): ActivityRecord;
  getById(localTransactionId: string, scope: ActivityScope): ActivityRecord | null;
  getByHash(transactionHash: string, scope: ActivityScope): ActivityRecord | null;
  listByAccountAndNetwork(
    scope: ActivityScope,
    options?: ActivityListOptions,
  ): readonly ActivityRecord[];
  updateStatus(
    localTransactionId: string,
    scope: ActivityScope,
    update: ActivityStatusUpdate,
  ): ActivityRecord;
  remove(localTransactionId: string, scope: ActivityScope): boolean;
  clear(): void;
}

export class InMemoryActivityRepository implements ActivityRepository {
  private readonly records = new Map<string, ActivityRecord>();

  add(input: ActivityRecordInput): ActivityRecord {
    const record = normalizeRecord(input);
    if (this.findMatching(record)) {
      throw new ActivityError('DUPLICATE_RECORD');
    }
    this.records.set(identityKey(record), record);
    return cloneRecord(record);
  }

  upsert(input: ActivityRecordInput): ActivityRecord {
    const record = normalizeRecord(input);
    const matching = this.findMatching(record);
    if (matching) {
      this.deleteRecord(matching);
    }
    this.records.set(identityKey(record), record);
    return cloneRecord(record);
  }

  getById(localTransactionId: string, scope: ActivityScope): ActivityRecord | null {
    const validatedScope = validateScope(scope);
    const record = this.records.get(
      `local|${scopeKey(validatedScope)}|${localTransactionId}`,
    );
    if (!record) return null;
    if (!sameScope(record, validatedScope)) {
      throw new ActivityError('SCOPE_MISMATCH');
    }
    return cloneRecord(record);
  }

  getByHash(transactionHash: string, scope: ActivityScope): ActivityRecord | null {
    const validatedScope = validateScope(scope);
    const record = this.records.get(
      `hash|${scopeKey(validatedScope)}|${hashKey(transactionHash)}`,
    );
    if (!record) return null;
    if (!sameScope(record, validatedScope)) {
      throw new ActivityError('SCOPE_MISMATCH');
    }
    return cloneRecord(record);
  }

  listByAccountAndNetwork(
    scope: ActivityScope,
    options: ActivityListOptions = {},
  ): readonly ActivityRecord[] {
    const validatedScope = validateScope(scope);
    const { limit, offset } = validateLimitOffset(options);
    return Object.freeze(
      [...this.records.values()]
        .filter((record) => sameScope(record, validatedScope))
        .sort(sortRecords)
        .slice(offset, offset + limit)
        .map(cloneRecord),
    );
  }

  updateStatus(
    localTransactionId: string,
    scope: ActivityScope,
    update: ActivityStatusUpdate,
  ): ActivityRecord {
    const validatedScope = validateScope(scope);
    const current = this.getById(localTransactionId, validatedScope);
    if (!current) throw new ActivityError('RECORD_NOT_FOUND');
    const next = normalizeRecord({
      ...current,
      ...update,
      localTransactionId: current.localTransactionId,
      accountId: current.accountId,
      networkId: current.networkId,
      chainId: current.chainId,
      senderAddress: current.senderAddress,
      transactionHash:
        update.transactionHash === undefined
          ? current.transactionHash
          : update.transactionHash,
      assetIdentity: current.assetIdentity,
      createdAt: current.createdAt,
      amountRaw: current.amountRaw,
      amountDecimals: current.amountDecimals,
      amountDisplay: current.amountDisplay,
      nativeValue: current.nativeValue,
      tokenContractAddress: current.tokenContractAddress,
      nonce: current.nonce,
      gasLimit: current.gasLimit,
      feeModel: current.feeModel,
      feeAmount: current.feeAmount,
      direction: current.direction,
      transactionType: current.transactionType,
      recipient: current.recipient,
      explorerUrl:
        update.explorerUrl === undefined ? current.explorerUrl : update.explorerUrl,
      provenance: update.provenance ?? current.provenance,
      observedAt: update.observedAt ?? current.observedAt,
    });
    this.deleteRecord(current);
    this.records.set(identityKey(next), next);
    return cloneRecord(next);
  }

  remove(localTransactionId: string, scope: ActivityScope): boolean {
    const record = this.getById(localTransactionId, scope);
    if (!record) return false;
    this.deleteRecord(record);
    return true;
  }

  clear(): void {
    this.records.clear();
  }

  private findMatching(record: ActivityRecord): ActivityRecord | null {
    const byLocal = record.localTransactionId
      ? [...this.records.values()].find(
          (candidate) =>
            candidate.localTransactionId === record.localTransactionId &&
            sameScope(candidate, record),
        )
      : null;
    const byHash = record.transactionHash
      ? [...this.records.values()].find(
          (candidate) =>
            candidate.transactionHash?.toLowerCase() === record.transactionHash!.toLowerCase() &&
            sameScope(candidate, record),
        )
      : null;
    if (byLocal && byHash && byLocal !== byHash) {
      throw new ActivityError('IDENTITY_CONFLICT');
    }
    return byLocal ?? byHash ?? null;
  }

  private deleteRecord(record: ActivityRecord): void {
    this.records.delete(identityKey(record));
  }
}