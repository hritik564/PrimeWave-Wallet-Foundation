import { DAppError } from './errors';
import type { DAppRequest } from './request-models';
import { validateDAppRequest } from './validation';

const TERMINAL_STATUSES = new Set<DAppRequest['status']>([
  'rejected',
  'completed',
  'failed',
  'expired',
]);

const TRANSITIONS: Record<
  DAppRequest['status'],
  readonly DAppRequest['status'][]
> = {
  created: ['pending', 'approved', 'rejected', 'failed', 'expired'],
  pending: ['approved', 'rejected', 'failed', 'expired'],
  approved: ['completed', 'failed', 'expired'],
  rejected: [],
  completed: [],
  failed: [],
  expired: [],
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

  create(input: unknown): DAppRequest {
    const request = validateDAppRequest(input);
    if (this.requests.has(request.requestId)) {
      throw new DAppError('DUPLICATE_REQUEST', 'DApp request ID already exists.');
    }
    const created = cloneRequest({ ...request, status: 'created' });
    this.requests.set(created.requestId, created);
    return cloneRequest(created);
  }

  get(requestId: string): DAppRequest | null {
    const request = this.requests.get(requestId);
    return request ? cloneRequest(request) : null;
  }

  markPending(requestId: string): DAppRequest {
    return this.transition(requestId, 'pending');
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

  clear(): void {
    this.requests.clear();
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
        nextStatus === 'expired' ? 'REQUEST_EXPIRED' : 'INVALID_LIFECYCLE',
        `DApp request cannot transition from ${current.status} to ${nextStatus}.`,
      );
    }
    const next = cloneRequest({ ...current, status: nextStatus });
    this.requests.set(requestId, next);
    return cloneRequest(next);
  }
}