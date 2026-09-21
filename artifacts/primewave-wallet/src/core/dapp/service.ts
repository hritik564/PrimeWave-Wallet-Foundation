import { DAppError } from './errors';
import type { DAppRequest } from './request-models';
import { validateDAppRequest } from './validation';

const TERMINAL_STATUSES = new Set<DAppRequest['status']>([
  'rejected',
  'completed',
  'failed',
  'expired',
  'stale',
  'cancelled',
]);

const TRANSITIONS: Record<
  DAppRequest['status'],
  readonly DAppRequest['status'][]
> = {
  created: ['pending', 'reviewing', 'approved', 'rejected', 'failed', 'expired', 'stale', 'cancelled'],
  pending: ['reviewing', 'approved', 'rejected', 'failed', 'expired', 'stale', 'cancelled'],
  reviewing: ['authenticating', 'approved', 'rejected', 'failed', 'expired', 'stale', 'cancelled'],
  authenticating: ['signing', 'approved', 'rejected', 'failed', 'expired', 'stale', 'cancelled'],
  signing: ['broadcasting', 'completed', 'failed', 'expired', 'stale', 'cancelled'],
  broadcasting: ['completed', 'failed', 'expired', 'stale', 'cancelled'],
  approved: ['completed', 'failed', 'expired', 'stale', 'cancelled'],
  rejected: [],
  completed: [],
  failed: [],
  expired: [],
  stale: [],
  cancelled: [],
};

function clonePayload<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(clonePayload)) as T;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, clonePayload(child)]),
    ),
  ) as T;
}

function cloneRequest(request: DAppRequest): DAppRequest {
  return Object.freeze({
    ...request,
    identity: Object.freeze({ ...request.identity }),
    payload: clonePayload(request.payload),
  });
}

export class DAppRequestService {
  private readonly requests = new Map<string, DAppRequest>();

  constructor(private readonly maxRequests = 100) {
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
      throw new DAppError('INVALID_REQUEST', 'DApp request capacity is invalid.');
    }
  }

  create(input: unknown): DAppRequest {
    const request = validateDAppRequest(input);
    if (this.requests.has(request.requestId)) {
      throw new DAppError('DUPLICATE_REQUEST', 'DApp request ID already exists.');
    }
    if (this.requests.size >= this.maxRequests) {
      throw new DAppError('INVALID_REQUEST', 'DApp request capacity has been reached.');
    }
    const created = cloneRequest({ ...request, status: 'created' });
    this.requests.set(created.requestId, created);
    return cloneRequest(created);
  }

  get(requestId: string): DAppRequest | null {
    const request = this.requests.get(requestId);
    return request ? cloneRequest(request) : null;
  }

  list(): readonly DAppRequest[] {
    return Object.freeze([...this.requests.values()].map(cloneRequest));
  }

  listForSession(sessionId: string): readonly DAppRequest[] {
    return Object.freeze(
      [...this.requests.values()]
        .filter((request) => request.sessionId === sessionId)
        .map(cloneRequest),
    );
  }

  markPending(requestId: string): DAppRequest {
    return this.transition(requestId, 'pending');
  }

  markReviewing(requestId: string): DAppRequest {
    return this.transition(requestId, 'reviewing');
  }

  markAuthenticating(requestId: string): DAppRequest {
    return this.transition(requestId, 'authenticating');
  }

  markSigning(requestId: string): DAppRequest {
    return this.transition(requestId, 'signing');
  }

  markBroadcasting(requestId: string): DAppRequest {
    return this.transition(requestId, 'broadcasting');
  }

  approve(requestId: string): DAppRequest {
    return this.transition(requestId, 'approved');
  }

  reject(requestId: string): DAppRequest {
    return this.transition(requestId, 'rejected');
  }

  complete(requestId: string): DAppRequest {
    return this.transition(requestId, 'completed');
  }

  fail(requestId: string): DAppRequest {
    return this.transition(requestId, 'failed');
  }

  expire(requestId: string): DAppRequest {
    return this.transition(requestId, 'expired');
  }

  stale(requestId: string): DAppRequest {
    return this.transition(requestId, 'stale');
  }

  cancel(requestId: string): DAppRequest {
    return this.transition(requestId, 'cancelled');
  }

  invalidateSession(
    sessionId: string,
    reason: 'stale' | 'cancelled' = 'cancelled',
  ): readonly DAppRequest[] {
    return this.invalidate(
      [...this.requests.values()]
        .filter(
          (request) =>
            request.sessionId === sessionId &&
            !TERMINAL_STATUSES.has(request.status),
        )
        .map((request) => request.requestId),
      reason,
    );
  }

  invalidateContext(context: {
    readonly accountId: string;
    readonly walletAddress: string;
    readonly networkId: string;
  }): readonly DAppRequest[] {
    return this.invalidate(
      [...this.requests.values()]
        .filter(
          (request) =>
            !TERMINAL_STATUSES.has(request.status) &&
            (request.accountId !== context.accountId ||
              request.walletAddress !== context.walletAddress ||
              request.networkId !== context.networkId),
        )
        .map((request) => request.requestId),
      'stale',
    );
  }

  clear(): void {
    this.requests.clear();
  }

  private invalidate(
    requestIds: readonly string[],
    reason: 'stale' | 'cancelled',
  ): readonly DAppRequest[] {
    const invalidated: DAppRequest[] = [];
    for (const requestId of requestIds) {
      const current = this.requests.get(requestId);
      if (!current || TERMINAL_STATUSES.has(current.status)) continue;
      const next = cloneRequest({ ...current, status: reason });
      this.requests.set(requestId, next);
      invalidated.push(cloneRequest(next));
    }
    return Object.freeze(invalidated);
  }

  private transition(
    requestId: string,
    nextStatus: DAppRequest['status'],
  ): DAppRequest {
    const current = this.requests.get(requestId);
    if (!current) {
      throw new DAppError('REQUEST_NOT_FOUND', 'DApp request was not found.');
    }
    if (
      TERMINAL_STATUSES.has(current.status) ||
      !TRANSITIONS[current.status].includes(nextStatus)
    ) {
      throw new DAppError(
        nextStatus === 'expired'
          ? 'REQUEST_EXPIRED'
          : nextStatus === 'stale'
            ? 'REQUEST_STALE'
            : nextStatus === 'cancelled'
              ? 'REQUEST_CANCELLED'
              : 'INVALID_LIFECYCLE',
        `DApp request cannot transition from ${current.status} to ${nextStatus}.`,
      );
    }
    const next = cloneRequest({ ...current, status: nextStatus });
    this.requests.set(requestId, next);
    return cloneRequest(next);
  }
}