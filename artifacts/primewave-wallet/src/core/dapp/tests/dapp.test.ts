import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DAppError,
  DAppRequestService,
  InMemoryDAppSessionRepository,
  assertDAppPermission,
  assertDAppRequestSessionContext,
  hasDAppPermission,
  validateDAppIdentity,
  validateDAppRequest,
  validateDAppSession,
} from '..';
import type { DAppSession } from '../models';

const identity = {
  dappId: 'example-dapp',
  name: 'Example DApp',
  description: 'An untrusted test identity.',
  url: 'https://example.test/app',
  iconUrl: 'https://example.test/icon.png',
  origin: 'https://example.test',
  providerSessionId: 'provider-session-1',
  metadataVersion: '1',
};

const walletAddress = '0x52908400098527886e0f7030069857d2e4169ee7';

function makeSession(
  overrides: Partial<DAppSession> = {},
): DAppSession {
  return validateDAppSession({
    sessionId: 'session-1',
    identity,
    accountId: 'account-1',
    walletAddress,
    networkId: 'ethereum',
    chainId: 1n,
    approvedCapabilities: [],
    permissions: [],
    createdAt: 100,
    lastActivityAt: 100,
    expiresAt: 1_000,
    status: 'active',
    ...overrides,
  });
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    identity,
    accountId: 'account-1',
    walletAddress,
    networkId: 'ethereum',
    chainId: 1n,
    requestType: 'message-signing',
    createdAt: 100,
    expiresAt: 1_000,
    payload: {
      kind: 'message-signing',
      message: 'hello',
    },
    ...overrides,
  };
}

function permission(
  capability:
    | 'account-access'
    | 'network-access'
    | 'message-signing'
    | 'transaction-signing',
  networkId: string | null = 'ethereum',
) {
  return {
    capability,
    accountId: 'account-1',
    networkId,
    grantedAt: 100,
    revokedAt: null,
  };
}

test('rejects malformed identities, invalid URLs, and oversized metadata', () => {
  assert.throws(
    () => validateDAppIdentity({ ...identity, name: '' }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_IDENTITY',
  );
  assert.throws(
    () => validateDAppIdentity({ ...identity, url: 'javascript:alert(1)' }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_URL',
  );
  assert.throws(
    () => validateDAppIdentity({ ...identity, description: 'x'.repeat(1_001) }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'METADATA_TOO_LARGE',
  );
  assert.throws(
    () => validateDAppIdentity({ ...identity, url: 'https://user:pass@example.test' }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_URL',
  );
});

test('treats identity metadata as untrusted public input', () => {
  const validated = validateDAppIdentity(identity);
  assert.equal(validated.name, identity.name);
  assert.equal(validated.origin, 'https://example.test');
  assert.equal(Object.isFrozen(validated), true);
  assert.equal('trusted' in validated, false);
});

test('rejects duplicate sessions and isolates accounts and networks', () => {
  const repository = new InMemoryDAppSessionRepository();
  const first = makeSession();
  assert.throws(
    () =>
      repository.create({
        ...first,
        approvedCapabilities: ['message-signing'],
      } as DAppSession),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_PERMISSION',
  );
  repository.create(first);
  assert.throws(
    () => repository.create(first),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'DUPLICATE_SESSION',
  );
  assert.throws(
    () => repository.get(first.sessionId, { accountId: 'account-2', networkId: 'ethereum' }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'SESSION_SCOPE_MISMATCH',
  );
  assert.throws(
    () => repository.get(first.sessionId, { accountId: 'account-1', networkId: 'polygon' }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'SESSION_SCOPE_MISMATCH',
  );
  assert.equal(
    repository.list({ accountId: 'account-2', networkId: 'ethereum' }).length,
    0,
  );
});

test('keeps revoked and expired session states distinct and denies permissions', () => {
  const active = makeSession({
    approvedCapabilities: ['account-access'],
    permissions: [permission('account-access')],
  });
  assert.equal(hasDAppPermission(active, 'account-access', 'account-1', 'ethereum', 500), true);
  assert.equal(
    hasDAppPermission(
      makeSession({ status: 'revoked', approvedCapabilities: ['account-access'], permissions: [permission('account-access')] }),
      'account-access',
      'account-1',
      'ethereum',
      500,
    ),
    false,
  );
  assert.equal(
    hasDAppPermission(
      makeSession({
        status: 'expired',
        approvedCapabilities: ['account-access'],
        permissions: [permission('account-access')],
      }),
      'account-access',
      'account-1',
      'ethereum',
      1_001,
    ),
    false,
  );
  assert.throws(
    () => assertDAppPermission(active, 'transaction-signing', 'account-1', 'ethereum', 500),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'PERMISSION_DENIED',
  );
});

test('requires account and network scoped permissions independently', () => {
  const session = makeSession({
    approvedCapabilities: ['account-access', 'transaction-signing'],
    permissions: [
      permission('account-access'),
      permission('transaction-signing', 'ethereum'),
    ],
  });
  assert.equal(hasDAppPermission(session, 'account-access', 'account-1', 'ethereum', 500), true);
  assert.equal(hasDAppPermission(session, 'transaction-signing', 'account-1', 'polygon', 500), false);
  assert.equal(hasDAppPermission(session, 'message-signing', 'account-1', 'ethereum', 500), false);
  assert.equal(hasDAppPermission(session, 'transaction-signing', 'account-2', 'ethereum', 500), false);
});

test('rejects unsupported request types and malformed payloads', () => {
  assert.throws(
    () => validateDAppRequest(makeRequest({ requestType: 'wallet-export' })),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'UNSUPPORTED_REQUEST',
  );
  assert.throws(
    () => validateDAppRequest(makeRequest({ payload: { kind: 'message-signing' } })),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_REQUEST',
  );
});

test('rejects account and network mismatches in transaction requests', () => {
  const transaction = {
    kind: 'transaction',
    from: walletAddress,
    to: walletAddress,
    value: 1n,
    calldata: '0x',
    chainId: 1n,
    gasLimit: null,
    nonce: null,
  };
  assert.throws(
    () =>
      validateDAppRequest(
        makeRequest({ requestType: 'transaction', payload: { ...transaction, from: '0x0000000000000000000000000000000000000001' } }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'ACCOUNT_MISMATCH',
  );
  assert.throws(
    () =>
      validateDAppRequest(
        makeRequest({ requestType: 'transaction', payload: { ...transaction, chainId: 137n } }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'NETWORK_MISMATCH',
  );
});

test('keeps chain requests explicit and does not silently switch the active network', () => {
  const request = validateDAppRequest(
    makeRequest({
      requestType: 'chain-request',
      payload: {
        kind: 'chain-request',
        requestedNetworkId: 'polygon',
        requestedChainId: 137n,
        activeNetworkId: 'ethereum',
        activeChainId: 1n,
        sessionApprovedNetworkIds: ['ethereum'],
        configured: true,
        enabled: true,
      },
    }),
  );
  assert.equal(request.requestType, 'chain-request');
  assert.equal(request.payload.kind, 'chain-request');
  assert.equal(request.payload.activeNetworkId, 'ethereum');
  assert.equal(request.payload.requestedNetworkId, 'polygon');
});

test('connection permission does not imply signing permission', () => {
  const session = makeSession({
    approvedCapabilities: ['account-access'],
    permissions: [permission('account-access')],
  });
  assert.equal(hasDAppPermission(session, 'account-access', 'account-1', 'ethereum', 500), true);
  assert.equal(hasDAppPermission(session, 'message-signing', 'account-1', 'ethereum', 500), false);
  assert.equal(hasDAppPermission(session, 'transaction-signing', 'account-1', 'ethereum', 500), false);
});

test('rejects secret-shaped fields from request models', () => {
  assert.throws(
    () =>
      validateDAppRequest(
        makeRequest({
          payload: {
            kind: 'message-signing',
            message: 'hello',
            privateKey: 'must-not-enter-the-boundary',
          },
        }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'SECRET_MATERIAL',
  );
  assert.throws(
    () =>
      validateDAppRequest(
        makeRequest({
          requestType: 'transaction',
          mnemonic: 'must-not-enter-the-boundary',
          payload: {
            kind: 'transaction',
            from: walletAddress,
            to: walletAddress,
            value: 1n,
            calldata: '0x',
            chainId: 1n,
            gasLimit: null,
            nonce: null,
          },
        }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'SECRET_MATERIAL',
  );
});

test('preserves typed-data payload exactly without parsing or rewriting', () => {
  const typedData = '{"types":{"Mail":[{"name":"from","type":"address"}]},"message":{"from":"0x01"}}';
  const request = validateDAppRequest(
    makeRequest({
      requestType: 'typed-data-signing',
      payload: { kind: 'typed-data-signing', typedData },
    }),
  );
  assert.equal(request.payload.kind, 'typed-data-signing');
  assert.equal(request.payload.typedData, typedData);
});

test('binds requests to their session identity and public account context', () => {
  const session = makeSession();
  const request = validateDAppRequest(makeRequest());
  assert.doesNotThrow(() => assertDAppRequestSessionContext(request, session));
  assert.throws(
    () =>
      assertDAppRequestSessionContext(
        validateDAppRequest(makeRequest({ accountId: 'account-2' })),
        session,
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'ACCOUNT_MISMATCH',
  );
});

test('keeps request lifecycle states deterministic and distinguishes rejection from failure', () => {
  const service = new DAppRequestService();
  assert.equal(service.create(makeRequest()).status, 'created');
  assert.equal(service.markPending('request-1').status, 'pending');
  assert.equal(service.reject('request-1').status, 'rejected');
  assert.throws(
    () => service.complete('request-1'),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_LIFECYCLE',
  );

  const second = new DAppRequestService();
  second.create(makeRequest({ requestId: 'request-2' }));
  assert.equal(second.approve('request-2').status, 'approved');
  assert.equal(second.fail('request-2').status, 'failed');
  assert.throws(
    () => second.expire('request-2'),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'REQUEST_EXPIRED',
  );
});

test('bounds in-memory session storage', () => {
  const repository = new InMemoryDAppSessionRepository(1);
  repository.create(makeSession());
  assert.throws(
    () => repository.create(makeSession({ sessionId: 'session-2' })),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_SESSION',
  );
});

test('does not introduce secret-wallet or direct-broadcast access into the DApp core', () => {
  const dappDirectory = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]tests$/, '');
  const sourceFiles = readdirSync(dappDirectory)
    .filter((file) => file.endsWith('.ts') && file !== 'tests')
    .map((file) => readFileSync(join(dappDirectory, file), 'utf8'))
    .join('\n');
  assert.equal(/expo-secure-store|SecureStore|LocalWalletEngine|eth_sendRawTransaction/.test(sourceFiles), false);
});