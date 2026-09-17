import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type { AssetType } from '@/src/core/assets';
import type { SignedTransaction } from '@/src/core/transactions/signing';
import { ActivityError } from './errors';
import {
  InMemoryActivityRepository,
  type ActivityRepository,
} from './repository';
import type {
  ActivityConfirmation,
  ActivityDraftInput,
  ActivityExternalInput,
  ActivityProvenance,
  ActivityRecord,
  ActivityScope,
  ActivityStatus,
  ActivityTransactionType,
  BroadcastLifecycleResult,
  ConfirmationLifecycleResult,
} from './models';

const transitions: Record<ActivityStatus, readonly ActivityStatus[]> = {
  draft: ['signed', 'broadcasting', 'failed', 'unknown'],
  signed: ['broadcasting', 'broadcasted', 'failed', 'unknown'],
  broadcasting: ['broadcasted', 'failed', 'unknown'],
  broadcasted: ['confirming', 'confirmed', 'reverted', 'unknown'],
  confirming: ['confirmed', 'reverted', 'unknown'],
  confirmed: [],
  reverted: [],
  failed: [],
  unknown: ['confirmed', 'reverted', 'unknown'],
};

function assertTransition(current: ActivityStatus, next: ActivityStatus): void {
  if (current === next || transitions[current].includes(next)) return;
  throw new ActivityError('INVALID_STATUS_TRANSITION');
}

function nowMs(value: number | undefined): number {
  const result = value ?? Date.now();
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ActivityError('INVALID_RECORD');
  }
  return result;
}

function normalizeAddress(address: string): string {
  try {
    return normalizePublicEvmAddress(address);
  } catch {
    throw new ActivityError('INVALID_RECORD');
  }
}

function sameLifecycleContext(
  record: ActivityRecord,
  result: { readonly transactionHash: string; readonly networkId: string; readonly chainId: bigint; readonly from?: string },
): void {
  if (
    record.transactionHash?.toLowerCase() !== result.transactionHash.toLowerCase() ||
    record.networkId !== result.networkId ||
    record.chainId !== result.chainId ||
    (result.from !== undefined &&
      normalizeAddress(record.senderAddress) !== normalizeAddress(result.from))
  ) {
    throw new ActivityError('LIFECYCLE_MISMATCH');
  }
}

function confirmationSnapshot(result: ConfirmationLifecycleResult): ActivityConfirmation {
  return Object.freeze({
    state: result.state,
    receipt: result.receipt
      ? Object.freeze({ ...result.receipt })
      : null,
    polls: result.polls,
    checkedAtMs: result.checkedAtMs,
  });
}

export interface ActivityServiceOptions {
  readonly repository?: ActivityRepository;
  readonly now?: () => number;
  readonly createLocalTransactionId?: () => string;
}

export class ActivityService {
  private readonly repository: ActivityRepository;
  private readonly now: () => number;
  private readonly createLocalTransactionId: () => string;
  private localIdCounter = 0;
  private readonly localScopes = new Map<string, ActivityScope>();

  constructor(options: ActivityServiceOptions = {}) {
    this.repository = options.repository ?? new InMemoryActivityRepository();
    this.now = options.now ?? (() => Date.now());
    this.createLocalTransactionId =
      options.createLocalTransactionId ??
      (() => {
        this.localIdCounter += 1;
        return `wavex-local-${this.localIdCounter}`;
      });
  }

  createDraft(input: ActivityDraftInput): ActivityRecord {
    const createdAt = nowMs(this.now());
    const record = this.repository.add({
      ...input,
      localTransactionId: this.createLocalTransactionId(),
      transactionHash: null,
      createdAt,
      status: 'draft',
      provenance: 'local_wallet',
      observedAt: createdAt,
    });
    this.localScopes.set(record.localTransactionId!, record);
    return record;
  }

  recordSigned(
    localTransactionId: string,
    signed: SignedTransaction,
    options: { readonly explorerUrl?: string | null } = {},
  ): ActivityRecord {
    const current = this.requireLocal(localTransactionId);
    sameLifecycleContext(
      {
        ...current,
        transactionHash: current.transactionHash ?? signed.transactionHash,
      },
      {
        transactionHash: signed.transactionHash,
        networkId: signed.networkId,
        chainId: signed.chainId,
        from: signed.from,
      },
    );
    assertTransition(current.status, 'signed');
    return this.update(current, {
      status: 'signed',
      transactionHash: signed.transactionHash,
      explorerUrl: options.explorerUrl,
      provenance: 'local_wallet',
      observedAt: nowMs(this.now()),
    });
  }

  recordBroadcasting(localTransactionId: string): ActivityRecord {
    const current = this.requireLocal(localTransactionId);
    assertTransition(current.status, 'broadcasting');
    return this.update(current, {
      status: 'broadcasting',
      provenance: 'broadcast_engine',
      observedAt: nowMs(this.now()),
    });
  }

  recordBroadcast(
    localTransactionId: string,
    result: BroadcastLifecycleResult,
    options: { readonly explorerUrl?: string | null } = {},
  ): ActivityRecord {
    const current = this.requireLocal(localTransactionId);
    sameLifecycleContext(current, result);
    const status: Extract<ActivityStatus, 'broadcasted' | 'unknown'> = result.state;
    assertTransition(current.status, status);
    const observedAt = result.submittedAtMs ?? nowMs(this.now());
    return this.update(current, {
      status,
      transactionHash: result.transactionHash,
      broadcastAt: observedAt,
      explorerUrl: options.explorerUrl,
      provenance: 'broadcast_engine',
      observedAt,
    });
  }

  recordConfirmation(
    localTransactionId: string,
    result: ConfirmationLifecycleResult,
    options: { readonly explorerUrl?: string | null } = {},
  ): ActivityRecord {
    const current = this.requireLocal(localTransactionId);
    sameLifecycleContext(current, result);
    const status: Extract<ActivityStatus, 'confirmed' | 'reverted' | 'unknown'> =
      result.state;
    assertTransition(current.status, status);
    const confirmedAt =
      status === 'confirmed' || status === 'reverted'
        ? result.checkedAtMs
        : current.confirmedAt;
    return this.update(current, {
      status,
      confirmation: confirmationSnapshot(result),
      confirmedAt,
      explorerUrl: options.explorerUrl,
      provenance: 'confirmation_engine',
      observedAt: result.checkedAtMs,
    });
  }

  recordFailed(localTransactionId: string): ActivityRecord {
    const current = this.requireLocal(localTransactionId);
    assertTransition(current.status, 'failed');
    return this.update(current, {
      status: 'failed',
      provenance: 'local_wallet',
      observedAt: nowMs(this.now()),
    });
  }

  recordExternal(input: ActivityExternalInput): ActivityRecord {
    const observedAt = nowMs(input.observedAt ?? this.now());
    return this.repository.upsert({
      ...input,
      localTransactionId: null,
      status: input.status ?? 'unknown',
      transactionType: input.transactionType ?? 'unknown',
      createdAt: observedAt,
      provenance: 'blockchain_read',
      observedAt,
    });
  }

  getRepository(): ActivityRepository {
    return this.repository;
  }

  private requireLocal(localTransactionId: string): ActivityRecord {
    const scope = this.localScopes.get(localTransactionId);
    if (!scope) throw new ActivityError('RECORD_NOT_FOUND');
    const record = this.repository.getById(localTransactionId, scope);
    if (!record) throw new ActivityError('RECORD_NOT_FOUND');
    return record;
  }

  private update(
    current: ActivityRecord,
    update: {
      readonly status: ActivityStatus;
      readonly transactionHash?: `0x${string}` | null;
      readonly broadcastAt?: number | null;
      readonly confirmedAt?: number | null;
      readonly confirmation?: ActivityConfirmation | null;
      readonly explorerUrl?: string | null;
      readonly provenance: ActivityProvenance;
      readonly observedAt: number;
    },
  ): ActivityRecord {
    if (!current.localTransactionId) {
      throw new ActivityError('RECORD_NOT_FOUND');
    }
    return this.repository.updateStatus(
      current.localTransactionId,
      current,
      update,
    );
  }
}

export function activityTransactionTypeFor(
  assetType: AssetType,
  hasCalldata: boolean,
): ActivityTransactionType {
  if (assetType === 'native') return 'native-transfer';
  if (assetType === 'fungible_token' && hasCalldata) return 'erc20-transfer';
  return 'contract-interaction';
}

export function activityDirection(
  senderAddress: string,
  recipient: string | null,
): 'outgoing' | 'self-transfer' | 'unknown' {
  if (!recipient) return 'unknown';
  return normalizeAddress(senderAddress) === normalizeAddress(recipient)
    ? 'self-transfer'
    : 'outgoing';
}