import { DAppError } from '@/src/core/dapp';
import type {
  DAppIdentity,
  DAppMessageSigningRequest,
  DAppRequest,
  DAppTypedDataSigningRequest,
} from '@/src/core/dapp';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';

export type DAppSigningStatus =
  | 'received'
  | 'signing'
  | 'rejecting'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'stale'
  | 'failed';

export interface DAppTypedDataPresentation {
  readonly domain: readonly { label: string; value: string }[];
  readonly fields: readonly { label: string; value: string }[];
  readonly warnings: readonly string[];
}

export interface DAppSigningViewModel {
  readonly requestId: string;
  readonly identity: DAppIdentity;
  readonly accountAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly method: string;
  readonly kind: 'personal' | 'typed-data';
  readonly message: string | null;
  readonly displayWasNormalized: boolean;
  readonly displayWasTruncated: boolean;
  readonly typedData: DAppTypedDataPresentation | null;
}

export interface DAppSigningContext {
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
}

function bounded(value: unknown, max = 512): string {
  const raw =
    typeof value === 'string' ? value : JSON.stringify(value) ?? '[raw value]';
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}

function typedDataPresentation(request: DAppTypedDataSigningRequest): DAppTypedDataPresentation {
  const warnings: string[] = [];
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(request.payload.typedData);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not object');
    }
    root = parsed as Record<string, unknown>;
  } catch {
    return {
      domain: [{ label: 'Payload', value: 'Raw data could not be parsed for display.' }],
      fields: [{ label: 'Raw payload', value: bounded(request.payload.typedData, 2_048) }],
      warnings: ['The typed-data payload is displayed as bounded raw data.'],
    };
  }
  const domain =
    typeof root.domain === 'object' && root.domain !== null
      ? Object.entries(root.domain as Record<string, unknown>).map(([key, value]) => ({
          label: key,
          value: bounded(value),
        }))
      : [];
  const message =
    typeof root.message === 'object' && root.message !== null
      ? Object.entries(root.message as Record<string, unknown>).map(([key, value]) => ({
          label: key,
          value: bounded(value),
        }))
      : [];
  if (domain.length === 0) warnings.push('The typed-data domain is missing or empty.');
  if (root.verifyingContract || (root.domain as Record<string, unknown> | undefined)?.verifyingContract) {
    warnings.push('A verifying contract is present. Review the address carefully.');
  }
  if (message.some((field) => field.value.includes('…'))) {
    warnings.push('Some message values are bounded for display; the original payload remains unchanged.');
  }
  return { domain, fields: message, warnings };
}

export function toDAppSigningViewModel(
  request: DAppMessageSigningRequest | DAppTypedDataSigningRequest,
): DAppSigningViewModel {
  if (request.payload.kind === 'message-signing') {
    return {
      requestId: request.requestId,
      identity: request.identity,
      accountAddress: request.walletAddress,
      networkId: request.networkId,
      chainId: request.chainId,
      method: request.payload.method ?? 'personal_sign',
      kind: 'personal',
      message: request.payload.message,
      displayWasNormalized: request.payload.displayWasNormalized ?? false,
      displayWasTruncated: request.payload.displayWasTruncated ?? false,
      typedData: null,
    };
  }
  return {
    requestId: request.requestId,
    identity: request.identity,
    accountAddress: request.walletAddress,
    networkId: request.networkId,
    chainId: request.chainId,
    method: request.payload.method ?? 'eth_signTypedData_v4',
    kind: 'typed-data',
    message: null,
    displayWasNormalized: false,
    displayWasTruncated:
      request.payload.displayWasTruncated ?? request.payload.typedData.length > 8_192,
    typedData: typedDataPresentation(request as DAppTypedDataSigningRequest),
  };
}

export function validateDAppSigningRequest(
  request: DAppRequest,
  context: DAppSigningContext,
  now = Date.now(),
): asserts request is DAppMessageSigningRequest | DAppTypedDataSigningRequest {
  if (request.requestType !== 'message-signing' && request.requestType !== 'typed-data-signing') {
    throw new DAppError('UNSUPPORTED_REQUEST', 'This request is not a message-signing request.');
  }
  if (request.status !== 'pending' && request.status !== 'created') {
    throw new DAppError('INVALID_LIFECYCLE', 'This signing request is no longer pending.');
  }
  if (request.expiresAt !== null && request.expiresAt <= now) {
    throw new DAppError('REQUEST_EXPIRED', 'This signing request has expired.');
  }
  if (
    request.accountId !== context.accountId ||
    normalizePublicEvmAddress(request.walletAddress) !== normalizePublicEvmAddress(context.walletAddress)
  ) {
    throw new DAppError('ACCOUNT_MISMATCH', 'The signing account changed while the request was open.');
  }
  if (
    request.networkId !== context.networkId ||
    request.chainId !== context.chainId
  ) {
    throw new DAppError('NETWORK_MISMATCH', 'The active network changed while the request was open.');
  }
}
