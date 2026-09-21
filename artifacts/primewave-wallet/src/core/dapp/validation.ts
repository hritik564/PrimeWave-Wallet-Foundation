import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { DAppError } from './errors';
import {
  DAPP_CAPABILITIES,
  type DAppCapability,
  type DAppIdentity,
  type DAppPermission,
  type DAppRequestStatus,
  type DAppRequestType,
  type DAppSession,
  type DAppSessionStatus,
} from './models';
import type {
  DAppChainRequestPayload,
  DAppRequest,
  DAppRequestInput,
  DAppRequestPayload,
  DAppTransactionIntent,
} from './request-models';

export const DAPP_MAX_ID_LENGTH = 128;
export const DAPP_MAX_NAME_LENGTH = 128;
export const DAPP_MAX_DESCRIPTION_LENGTH = 1_000;
export const DAPP_MAX_URL_LENGTH = 2_048;
export const DAPP_MAX_PROVIDER_SESSION_ID_LENGTH = 256;
export const DAPP_MAX_METADATA_VERSION_LENGTH = 32;
export const DAPP_MAX_MESSAGE_LENGTH = 100_000;
export const DAPP_MAX_TYPED_DATA_LENGTH = 1_000_000;
export const DAPP_MAX_REQUEST_ID_LENGTH = 128;
export const DAPP_MAX_SESSION_ID_LENGTH = 256;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: DAppError['code'], message: string): never {
  throw new DAppError(code, message);
}

function stringValue(
  value: unknown,
  code: DAppError['code'],
  label: string,
  maxLength?: number,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(code, `${label} must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return fail('METADATA_TOO_LARGE', `${label} exceeds its maximum length.`);
  }
  return value;
}

function optionalString(
  value: unknown,
  code: DAppError['code'],
  label: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, code, label, maxLength);
}

function exactTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('INVALID_REQUEST', `${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function exactChainId(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    return fail('INVALID_REQUEST', `${label} must be a non-negative bigint.`);
  }
  return value;
}

function normalizeAddress(value: unknown, label: string): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    return fail('INVALID_REQUEST', `${label} must be a valid EVM address.`);
  }
}

function validateUrl(
  value: unknown,
  label: string,
  maxLength = DAPP_MAX_URL_LENGTH,
): string {
  const raw = stringValue(value, 'INVALID_URL', label, maxLength);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('INVALID_URL', `${label} must be a valid URL.`);
  }
  if (parsed.username || parsed.password) {
    return fail('INVALID_URL', `${label} must not contain credentials.`);
  }
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    new Set(['localhost', '127.0.0.1', '[::1]']).has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    return fail('INVALID_URL', `${label} must use HTTPS.`);
  }
  if (!parsed.hostname) return fail('INVALID_URL', `${label} must include a host.`);
  return raw;
}

function validateOrigin(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = validateUrl(value, 'DApp origin', DAPP_MAX_URL_LENGTH);
  const parsed = new URL(raw);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return fail('INVALID_URL', 'DApp origin must be an origin without a path or query.');
  }
  return parsed.origin;
}

function validateCapability(value: unknown): DAppCapability {
  if (
    typeof value !== 'string' ||
    !(DAPP_CAPABILITIES as readonly string[]).includes(value)
  ) {
    return fail('INVALID_PERMISSION', 'DApp capability is unsupported.');
  }
  return value as DAppCapability;
}

function uniqueCapabilities(value: unknown): readonly DAppCapability[] {
  if (!Array.isArray(value)) {
    return fail('INVALID_PERMISSION', 'DApp capabilities must be an array.');
  }
  const capabilities = value.map(validateCapability);
  if (new Set(capabilities).size !== capabilities.length) {
    return fail('INVALID_PERMISSION', 'DApp capabilities must be unique.');
  }
  return Object.freeze(capabilities);
}

function validateNoSecretMaterial(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return;
    seen.add(value);
  }
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (
      /(private|mnemonic|recovery|phrase|pin|secret|seed|signer|rawtransaction)/i.test(
        key,
      )
    ) {
      throw new DAppError(
        'SECRET_MATERIAL',
        'DApp requests cannot contain wallet secret fields.',
      );
    }
    validateNoSecretMaterial(child, seen);
  }
}

export function validateDAppIdentity(value: unknown): DAppIdentity {
  if (!isRecord(value)) {
    return fail('INVALID_IDENTITY', 'DApp identity must be an object.');
  }
  const identity = Object.freeze({
    dappId: stringValue(value.dappId, 'INVALID_IDENTITY', 'DApp ID', DAPP_MAX_ID_LENGTH),
    name: stringValue(value.name, 'INVALID_IDENTITY', 'DApp name', DAPP_MAX_NAME_LENGTH),
    description: optionalString(
      value.description,
      'INVALID_IDENTITY',
      'DApp description',
      DAPP_MAX_DESCRIPTION_LENGTH,
    ),
    url: validateUrl(value.url, 'DApp URL'),
    iconUrl:
      value.iconUrl === null || value.iconUrl === undefined
        ? null
        : validateUrl(value.iconUrl, 'DApp icon URL'),
    origin: validateOrigin(value.origin),
    providerSessionId: optionalString(
      value.providerSessionId,
      'INVALID_IDENTITY',
      'Provider session ID',
      DAPP_MAX_PROVIDER_SESSION_ID_LENGTH,
    ),
    metadataVersion: stringValue(
      value.metadataVersion,
      'INVALID_IDENTITY',
      'Metadata version',
      DAPP_MAX_METADATA_VERSION_LENGTH,
    ),
  });
  return identity;
}

function validatePermission(
  value: unknown,
  sessionAccountId: string,
  sessionNetworkId: string,
): DAppPermission {
  if (!isRecord(value)) {
    return fail('INVALID_PERMISSION', 'DApp permission must be an object.');
  }
  const accountId = stringValue(
    value.accountId,
    'INVALID_PERMISSION',
    'Permission account ID',
    DAPP_MAX_ID_LENGTH,
  );
  if (accountId !== sessionAccountId) {
    return fail('ACCOUNT_MISMATCH', 'DApp permission account does not match the session.');
  }
  const networkId =
    value.networkId === null || value.networkId === undefined
      ? null
      : stringValue(
          value.networkId,
          'INVALID_PERMISSION',
          'Permission network ID',
          DAPP_MAX_ID_LENGTH,
        );
  if (networkId !== null && networkId !== sessionNetworkId) {
    return fail('NETWORK_MISMATCH', 'DApp permission network does not match the session.');
  }
  const grantedAt = exactTimestamp(value.grantedAt, 'Permission grant time');
  const revokedAt =
    value.revokedAt === null || value.revokedAt === undefined
      ? null
      : exactTimestamp(value.revokedAt, 'Permission revoke time');
  if (revokedAt !== null && revokedAt < grantedAt) {
    return fail('INVALID_PERMISSION', 'Permission revoke time precedes its grant time.');
  }
  return Object.freeze({
    capability: validateCapability(value.capability),
    accountId,
    networkId,
    grantedAt,
    revokedAt,
  });
}

export function validateDAppSession(value: unknown): DAppSession {
  if (!isRecord(value)) {
    return fail('INVALID_SESSION', 'DApp session must be an object.');
  }
  const sessionId = stringValue(
    value.sessionId,
    'INVALID_SESSION',
    'Session ID',
    DAPP_MAX_SESSION_ID_LENGTH,
  );
  const accountId = stringValue(
    value.accountId,
    'INVALID_SESSION',
    'Account ID',
    DAPP_MAX_ID_LENGTH,
  );
  const networkId = stringValue(
    value.networkId,
    'INVALID_SESSION',
    'Network ID',
    DAPP_MAX_ID_LENGTH,
  );
  const status = value.status;
  const statuses: readonly DAppSessionStatus[] = [
    'pending',
    'active',
    'expired',
    'disconnected',
    'revoked',
  ];
  if (!statuses.includes(status as DAppSessionStatus)) {
    return fail('INVALID_SESSION', 'DApp session status is unsupported.');
  }
  const approvedCapabilities = uniqueCapabilities(value.approvedCapabilities);
  const permissions = Array.isArray(value.permissions)
    ? Object.freeze(
        value.permissions.map((permission) =>
          validatePermission(permission, accountId, networkId),
        ),
      )
    : fail('INVALID_PERMISSION', 'DApp session permissions must be an array.');
  const permissionCapabilities = new Set(
    permissions
      .filter((permission) => permission.revokedAt === null)
      .map((permission) => permission.capability),
  );
  if (
    approvedCapabilities.some(
      (capability) => !permissionCapabilities.has(capability),
    )
  ) {
    return fail(
      'INVALID_PERMISSION',
      'Approved capabilities must have active permission records.',
    );
  }
  const createdAt = exactTimestamp(value.createdAt, 'Session creation time');
  const lastActivityAt = exactTimestamp(
    value.lastActivityAt,
    'Session activity time',
  );
  if (lastActivityAt < createdAt) {
    return fail('INVALID_SESSION', 'Session activity time precedes creation time.');
  }
  const expiresAt =
    value.expiresAt === null || value.expiresAt === undefined
      ? null
      : exactTimestamp(value.expiresAt, 'Session expiration time');
  if (expiresAt !== null && expiresAt <= createdAt) {
    return fail('INVALID_SESSION', 'Session expiration must follow creation time.');
  }
  return Object.freeze({
    sessionId,
    identity: validateDAppIdentity(value.identity),
    accountId,
    walletAddress: normalizeAddress(value.walletAddress, 'Session wallet address'),
    networkId,
    chainId: exactChainId(value.chainId, 'Session chain ID'),
    approvedCapabilities,
    permissions,
    createdAt,
    lastActivityAt,
    expiresAt,
    status: status as DAppSessionStatus,
  });
}

const REQUEST_TYPES: readonly DAppRequestType[] = [
  'connect',
  'disconnect',
  'account-access',
  'network-information',
  'message-signing',
  'typed-data-signing',
  'transaction',
  'chain-request',
];

const REQUEST_STATUSES: readonly DAppRequestStatus[] = [
  'created',
  'pending',
  'approved',
  'rejected',
  'completed',
  'failed',
  'expired',
];

function validateRequestContext(value: RecordValue): {
  readonly requestId: string;
  readonly sessionId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly requestType: DAppRequestType;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly status: DAppRequestStatus;
} {
  const requestType = value.requestType;
  if (!REQUEST_TYPES.includes(requestType as DAppRequestType)) {
    return fail('UNSUPPORTED_REQUEST', 'DApp request type is unsupported.');
  }
  const status =
    value.status === undefined ? 'created' : value.status;
  if (!REQUEST_STATUSES.includes(status as DAppRequestStatus)) {
    return fail('INVALID_REQUEST', 'DApp request status is unsupported.');
  }
  const createdAt = exactTimestamp(value.createdAt, 'Request creation time');
  const expiresAt =
    value.expiresAt === null || value.expiresAt === undefined
      ? null
      : exactTimestamp(value.expiresAt, 'Request expiration time');
  if (expiresAt !== null && expiresAt <= createdAt) {
    return fail('INVALID_REQUEST', 'Request expiration must follow creation time.');
  }
  return {
    requestId: stringValue(
      value.requestId,
      'INVALID_REQUEST',
      'Request ID',
      DAPP_MAX_REQUEST_ID_LENGTH,
    ),
    sessionId: stringValue(
      value.sessionId,
      'INVALID_REQUEST',
      'Session ID',
      DAPP_MAX_SESSION_ID_LENGTH,
    ),
    identity: validateDAppIdentity(value.identity),
    accountId: stringValue(
      value.accountId,
      'INVALID_REQUEST',
      'Account ID',
      DAPP_MAX_ID_LENGTH,
    ),
    walletAddress: normalizeAddress(value.walletAddress, 'Request wallet address'),
    networkId: stringValue(
      value.networkId,
      'INVALID_REQUEST',
      'Network ID',
      DAPP_MAX_ID_LENGTH,
    ),
    chainId: exactChainId(value.chainId, 'Request chain ID'),
    requestType: requestType as DAppRequestType,
    createdAt,
    expiresAt,
    status: status as DAppRequestStatus,
  };
}

function validateTransactionPayload(value: unknown): DAppTransactionIntent {
  if (!isRecord(value) || value.kind !== 'transaction') {
    return fail('INVALID_REQUEST', 'Transaction request payload is invalid.');
  }
  const calldata = value.calldata;
  if (
    typeof calldata !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(calldata) ||
    (calldata.length - 2) % 2 !== 0
  ) {
    return fail('INVALID_REQUEST', 'Transaction calldata must be even-length hex.');
  }
  const gasLimit =
    value.gasLimit === null || value.gasLimit === undefined
      ? null
      : exactChainId(value.gasLimit, 'Transaction gas limit');
  const nonce =
    value.nonce === null || value.nonce === undefined
      ? null
      : exactChainId(value.nonce, 'Transaction nonce');
  return Object.freeze({
    kind: 'transaction' as const,
    from: normalizeAddress(value.from, 'Transaction sender'),
    to: normalizeAddress(value.to, 'Transaction recipient'),
    value: exactChainId(value.value, 'Transaction value'),
    calldata: calldata.toLowerCase() as `0x${string}`,
    chainId: exactChainId(value.chainId, 'Transaction chain ID'),
    gasLimit,
    nonce,
  });
}

function validateChainPayload(value: unknown): DAppChainRequestPayload {
  if (!isRecord(value) || value.kind !== 'chain-request') {
    return fail('INVALID_REQUEST', 'Chain request payload is invalid.');
  }
  const sessionApprovedNetworkIds = value.sessionApprovedNetworkIds;
  if (
    !Array.isArray(sessionApprovedNetworkIds) ||
    sessionApprovedNetworkIds.some(
      (networkId) =>
        typeof networkId !== 'string' || networkId.trim().length === 0,
    )
  ) {
    return fail('INVALID_REQUEST', 'Approved network IDs are invalid.');
  }
  if (typeof value.configured !== 'boolean' || typeof value.enabled !== 'boolean') {
    return fail('INVALID_REQUEST', 'Chain configuration state is invalid.');
  }
  return Object.freeze({
    kind: 'chain-request' as const,
    requestedNetworkId: stringValue(
      value.requestedNetworkId,
      'INVALID_REQUEST',
      'Requested network ID',
      DAPP_MAX_ID_LENGTH,
    ),
    requestedChainId: exactChainId(value.requestedChainId, 'Requested chain ID'),
    activeNetworkId: stringValue(
      value.activeNetworkId,
      'INVALID_REQUEST',
      'Active network ID',
      DAPP_MAX_ID_LENGTH,
    ),
    activeChainId: exactChainId(value.activeChainId, 'Active chain ID'),
    sessionApprovedNetworkIds: Object.freeze([...sessionApprovedNetworkIds]),
    configured: value.configured,
    enabled: value.enabled,
  });
}

function validatePayload(
  requestType: DAppRequestType,
  value: unknown,
): DAppRequestPayload {
  if (!isRecord(value)) {
    return fail('INVALID_REQUEST', 'DApp request payload must be an object.');
  }
  switch (requestType) {
    case 'connect':
      return Object.freeze({
        kind: 'connect' as const,
        requestedCapabilities: uniqueCapabilities(value.requestedCapabilities),
      });
    case 'disconnect':
      return Object.freeze({
        kind: 'disconnect' as const,
        reason:
          value.reason === null || value.reason === undefined
            ? null
            : stringValue(value.reason, 'INVALID_REQUEST', 'Disconnect reason', 500),
      });
    case 'account-access':
      return Object.freeze({
        kind: 'account-access' as const,
        requestedAccountId:
          value.requestedAccountId === null ||
          value.requestedAccountId === undefined
            ? null
            : stringValue(
                value.requestedAccountId,
                'INVALID_REQUEST',
                'Requested account ID',
                DAPP_MAX_ID_LENGTH,
              ),
      });
    case 'network-information':
      return Object.freeze({
        kind: 'network-information' as const,
        requestedNetworkId:
          value.requestedNetworkId === null ||
          value.requestedNetworkId === undefined
            ? null
            : stringValue(
                value.requestedNetworkId,
                'INVALID_REQUEST',
                'Requested network ID',
                DAPP_MAX_ID_LENGTH,
              ),
      });
    case 'message-signing':
      return Object.freeze({
        kind: 'message-signing' as const,
        message: stringValue(
          value.message,
          'INVALID_REQUEST',
          'Message',
          DAPP_MAX_MESSAGE_LENGTH,
        ),
      });
    case 'typed-data-signing':
      return Object.freeze({
        kind: 'typed-data-signing' as const,
        typedData: stringValue(
          value.typedData,
          'INVALID_REQUEST',
          'Typed-data payload',
          DAPP_MAX_TYPED_DATA_LENGTH,
        ),
      });
    case 'transaction':
      return validateTransactionPayload(value);
    case 'chain-request':
      return validateChainPayload(value);
  }
}

export function validateDAppRequest(value: unknown): DAppRequest {
  if (!isRecord(value)) {
    return fail('INVALID_REQUEST', 'DApp request must be an object.');
  }
  validateNoSecretMaterial(value);
  const context = validateRequestContext(value);
  const payload = validatePayload(context.requestType, value.payload);
  if (
    context.requestType === 'transaction' &&
    (payload.chainId !== context.chainId ||
      payload.from !== context.walletAddress)
  ) {
    return fail(
      payload.chainId !== context.chainId
        ? 'NETWORK_MISMATCH'
        : 'ACCOUNT_MISMATCH',
      'Transaction context does not match the request scope.',
    );
  }
  return Object.freeze({
    ...context,
    payload,
  });
}

export function validateDAppRequestInput(
  value: unknown,
): Omit<DAppRequest, 'status'> & { readonly status?: DAppRequestStatus } {
  return validateDAppRequest(value);
}

export function assertDAppRequestSessionContext(
  request: DAppRequest,
  session: DAppSession,
): void {
  if (request.sessionId !== session.sessionId || request.identity.dappId !== session.identity.dappId) {
    return fail(
      'SESSION_SCOPE_MISMATCH',
      'DApp request does not belong to the session identity.',
    );
  }
  if (request.accountId !== session.accountId || request.walletAddress !== session.walletAddress) {
    return fail('ACCOUNT_MISMATCH', 'DApp request account does not match the session.');
  }
  if (request.networkId !== session.networkId || request.chainId !== session.chainId) {
    return fail('NETWORK_MISMATCH', 'DApp request network does not match the session.');
  }
}