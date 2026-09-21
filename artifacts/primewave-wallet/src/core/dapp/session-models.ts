import { DAppError } from './errors';
import { validateDAppSession } from './validation';
import type {
  DAppPermission,
  DAppSession,
  DAppSessionStatus,
} from './models';

export interface DAppSessionScope {
  readonly accountId: string;
  readonly networkId: string;
}

export interface DAppSessionUpdate {
  readonly lastActivityAt?: number;
  readonly expiresAt?: number | null;
  readonly status?: DAppSessionStatus;
  readonly approvedCapabilities?: readonly DAppSession['approvedCapabilities'][number][];
  readonly permissions?: readonly DAppPermission[];
}

export interface DAppSessionRepository {
  create(session: DAppSession): DAppSession;
  get(sessionId: string, scope: DAppSessionScope): DAppSession | null;
  list(scope: DAppSessionScope): readonly DAppSession[];
  update(
    sessionId: string,
    scope: DAppSessionScope,
    update: DAppSessionUpdate,
  ): DAppSession;
  revoke(sessionId: string, scope: DAppSessionScope, now?: number): DAppSession;
  remove(sessionId: string, scope: DAppSessionScope): boolean;
  clear(scope?: DAppSessionScope): void;
}

function cloneSession(session: DAppSession): DAppSession {
  return Object.freeze({
    ...session,
    identity: Object.freeze({ ...session.identity }),
    approvedCapabilities: Object.freeze([...session.approvedCapabilities]),
    permissions: Object.freeze(
      session.permissions.map((permission) => Object.freeze({ ...permission })),
    ),
  });
}

function scopeMatches(session: DAppSession, scope: DAppSessionScope): boolean {
  return (
    session.accountId === scope.accountId && session.networkId === scope.networkId
  );
}

function assertScope(scope: DAppSessionScope): void {
  if (
    typeof scope.accountId !== 'string' ||
    scope.accountId.trim().length === 0 ||
    typeof scope.networkId !== 'string' ||
    scope.networkId.trim().length === 0
  ) {
    throw new DAppError('SESSION_SCOPE_MISMATCH', 'DApp session scope is invalid.');
  }
}

export class InMemoryDAppSessionRepository implements DAppSessionRepository {
  private readonly sessions = new Map<string, DAppSession>();

  constructor(private readonly maxSessions = 100) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
      throw new DAppError('INVALID_SESSION', 'DApp session capacity is invalid.');
    }
  }

  create(session: DAppSession): DAppSession {
    const validated = validateDAppSession(session);
    if (this.sessions.has(validated.sessionId)) {
      throw new DAppError('DUPLICATE_SESSION', 'DApp session ID already exists.');
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new DAppError('INVALID_SESSION', 'DApp session capacity has been reached.');
    }
    const stored = cloneSession(validated);
    this.sessions.set(stored.sessionId, stored);
    return cloneSession(stored);
  }

  get(sessionId: string, scope: DAppSessionScope): DAppSession | null {
    assertScope(scope);
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (!scopeMatches(session, scope)) {
      throw new DAppError(
        'SESSION_SCOPE_MISMATCH',
        'DApp session does not belong to the requested account and network.',
      );
    }
    return cloneSession(session);
  }

  list(scope: DAppSessionScope): readonly DAppSession[] {
    assertScope(scope);
    return Object.freeze(
      [...this.sessions.values()]
        .filter((session) => scopeMatches(session, scope))
        .map(cloneSession),
    );
  }

  update(
    sessionId: string,
    scope: DAppSessionScope,
    update: DAppSessionUpdate,
  ): DAppSession {
    const current = this.require(sessionId, scope);
    const next = validateDAppSession({
      ...current,
      ...update,
      sessionId: current.sessionId,
      accountId: current.accountId,
      networkId: current.networkId,
      identity: current.identity,
      permissions: update.permissions ?? current.permissions,
      approvedCapabilities:
        update.approvedCapabilities ?? current.approvedCapabilities,
    });
    this.sessions.set(sessionId, next);
    return cloneSession(next);
  }

  revoke(sessionId: string, scope: DAppSessionScope, now = Date.now()): DAppSession {
    return this.update(sessionId, scope, {
      status: 'revoked',
      lastActivityAt: now,
    });
  }

  remove(sessionId: string, scope: DAppSessionScope): boolean {
    const current = this.get(sessionId, scope);
    if (!current) return false;
    return this.sessions.delete(sessionId);
  }

  clear(scope?: DAppSessionScope): void {
    if (!scope) {
      this.sessions.clear();
      return;
    }
    for (const session of this.sessions.values()) {
      if (scopeMatches(session, scope)) this.sessions.delete(session.sessionId);
    }
  }

  private require(sessionId: string, scope: DAppSessionScope): DAppSession {
    const session = this.get(sessionId, scope);
    if (!session) {
      throw new DAppError('SESSION_NOT_FOUND', 'DApp session was not found.');
    }
    return session;
  }
}