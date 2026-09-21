import { hexToBytes, isAddress } from 'viem';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import {
  DAPP_MAX_MESSAGE_LENGTH,
  DAPP_MAX_TYPED_DATA_LENGTH,
  validateDAppRequest,
} from '../validation';
import { DAppError } from '../errors';
import type { DAppIdentity } from '../models';
import type {
  DAppMessageSigningRequest,
  DAppTypedDataSigningRequest,
} from '../request-models';
import type { DAppTypedDataDocument, DAppTypedDataField } from './models';

const MAX_DISPLAY_MESSAGE_LENGTH = 8_192;
const MAX_DISPLAY_LINE_LENGTH = 256;
const SUPPORTED_METHODS = new Set([
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
]);

export interface SigningSessionRequestInput {
  readonly requestId: string;
  readonly sessionId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly method: string;
  readonly params: unknown;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}

export interface BoundedDisplay {
  readonly text: string;
  readonly truncated: boolean;
  readonly normalized: boolean;
}

export interface ParsedPersonalMessage {
  readonly rawBytes: `0x${string}`;
  readonly display: BoundedDisplay;
  readonly walletAddress: string;
  readonly encoding: 'hex' | 'utf8';
}

export interface ParsedTypedData {
  readonly rawPayload: string;
  readonly document: DAppTypedDataDocument;
  readonly display: BoundedDisplay;
  readonly walletAddress: string;
  readonly chainId: bigint | null;
  readonly verifyingContract: string | null;
}

function fail(message: string): never {
  throw new DAppError('INVALID_REQUEST', message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedDisplay(value: string): BoundedDisplay {
  let normalized = false;
  const safe = value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
    () => {
      normalized = true;
      return '�';
    },
  );
  const lines = safe.split(/\r\n|\r|\n/).map((line) => {
    if (line.length <= MAX_DISPLAY_LINE_LENGTH) return line;
    normalized = true;
    return `${line.slice(0, MAX_DISPLAY_LINE_LENGTH)}…`;
  });
  const joined = lines.join('\n');
  if (joined.length <= MAX_DISPLAY_MESSAGE_LENGTH) {
    return { text: joined, truncated: false, normalized };
  }
  return {
    text: `${joined.slice(0, MAX_DISPLAY_MESSAGE_LENGTH)}…`,
    truncated: true,
    normalized,
  };
}

function addressAt(value: unknown): string | null {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) return null;
  return normalizePublicEvmAddress(value);
}

function paramsArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail('The signing request must contain exactly two parameters.');
  }
  return value;
}

function addressAndPayload(value: unknown): {
  readonly walletAddress: string;
  readonly payload: string;
} {
  const params = paramsArray(value);
  const first = addressAt(params[0]);
  const second = addressAt(params[1]);
  if (first && !second && typeof params[1] === 'string') {
    return { walletAddress: first, payload: params[1] };
  }
  if (second && !first && typeof params[0] === 'string') {
    return { walletAddress: second, payload: params[0] };
  }
  return fail('The signing request must contain one valid account address.');
}

function decodePersonalPayload(payload: string): {
  readonly rawBytes: `0x${string}`;
  readonly text: string;
  readonly encoding: 'hex' | 'utf8';
} {
  if (payload.startsWith('0x')) {
    if (!/^0x[0-9a-f]*$/i.test(payload) || (payload.length - 2) % 2 !== 0) {
      return fail('The personal-sign payload is not valid hexadecimal data.');
    }
    const bytes = hexToBytes(payload as `0x${string}`);
    return {
      rawBytes: payload as `0x${string}`,
      text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      encoding: 'hex',
    };
  }
  return {
    rawBytes: `0x${Array.from(new TextEncoder().encode(payload))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}` as `0x${string}`,
    text: payload,
    encoding: 'utf8',
  };
}

function exactChainId(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (
    typeof value === 'string' &&
    (/^[0-9]+$/.test(value) || /^0x[0-9a-f]+$/i.test(value))
  ) {
    try {
      return BigInt(value);
    } catch {
      return fail('The typed-data chain ID is invalid.');
    }
  }
  return fail('The typed-data chain ID is invalid.');
}

function parseTypedData(rawPayload: string): {
  readonly document: DAppTypedDataDocument;
  readonly chainId: bigint | null;
  readonly verifyingContract: string | null;
} {
  if (rawPayload.length > DAPP_MAX_TYPED_DATA_LENGTH) {
    return fail('The typed-data payload is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return fail('The typed-data payload is not valid JSON.');
  }
  const root = record(parsed, 'Typed-data payload');
  const domain = record(root.domain, 'Typed-data domain');
  const typesRecord = record(root.types, 'Typed-data types');
  const message = record(root.message, 'Typed-data message');
  if (typeof root.primaryType !== 'string' || root.primaryType.trim().length === 0) {
    return fail('The typed-data primary type is missing.');
  }
  const types: Record<string, readonly DAppTypedDataField[]> = {};
  for (const [typeName, fields] of Object.entries(typesRecord)) {
    if (!Array.isArray(fields) || fields.length > 128) {
      return fail('The typed-data type definition is invalid.');
    }
    types[typeName] = fields.map((field) => {
      const item = record(field, 'Typed-data field');
      if (typeof item.name !== 'string' || typeof item.type !== 'string') {
        return fail('The typed-data field is invalid.');
      }
      return Object.freeze({ name: item.name, type: item.type });
    });
  }
  if (!types[root.primaryType]) {
    return fail('The typed-data primary type is not declared.');
  }
  const chainId = exactChainId(domain.chainId);
  let verifyingContract: string | null = null;
  if (domain.verifyingContract !== undefined) {
    verifyingContract = addressAt(domain.verifyingContract);
    if (!verifyingContract) return fail('The verifying contract address is invalid.');
  }
  return {
    document: Object.freeze({
      domain,
      types: Object.freeze(types),
      primaryType: root.primaryType,
      message,
    }),
    chainId,
    verifyingContract,
  };
}

export function parsePersonalSigningRequest(
  input: SigningSessionRequestInput,
): ParsedPersonalMessage {
  if (input.method !== 'personal_sign') {
    return fail('The requested signing method is unsupported.');
  }
  const { walletAddress, payload } = addressAndPayload(input.params);
  const decoded = decodePersonalPayload(payload);
  return {
    rawBytes: decoded.rawBytes,
    display: boundedDisplay(decoded.text),
    walletAddress,
    encoding: decoded.encoding,
  };
}

export function parseTypedDataSigningRequest(
  input: SigningSessionRequestInput,
): ParsedTypedData {
  if (
    input.method !== 'eth_signTypedData' &&
    input.method !== 'eth_signTypedData_v4'
  ) {
    return fail('The requested typed-data signing method is unsupported.');
  }
  const { walletAddress, payload } = addressAndPayload(input.params);
  const parsed = parseTypedData(payload);
  return {
    rawPayload: payload,
    document: parsed.document,
    display: boundedDisplay(payload),
    walletAddress,
    chainId: parsed.chainId,
    verifyingContract: parsed.verifyingContract,
  };
}

export function normalizeSigningRequest(
  input: SigningSessionRequestInput,
): DAppMessageSigningRequest | DAppTypedDataSigningRequest {
  if (!SUPPORTED_METHODS.has(input.method)) {
    return fail('The requested signing method is unsupported.');
  }
  const walletAddress = (() => {
    const params = paramsArray(input.params);
    const first = addressAt(params[0]);
    const second = addressAt(params[1]);
    return first ?? second;
  })();
  if (!walletAddress || walletAddress !== normalizePublicEvmAddress(input.walletAddress)) {
    return fail('The signing account does not match the connected wallet.');
  }
  if (input.method === 'personal_sign') {
    const parsed = parsePersonalSigningRequest(input);
    return validateDAppRequest({
      ...input,
      requestType: 'message-signing',
      status: 'pending',
      payload: {
        kind: 'message-signing',
        method: 'personal_sign',
        message: parsed.display.text,
        rawPayload: parsed.rawBytes,
        encoding: parsed.encoding,
        displayWasNormalized: parsed.display.normalized,
        displayWasTruncated: parsed.display.truncated,
      },
    }) as DAppMessageSigningRequest;
  }
  const parsed = parseTypedDataSigningRequest(input);
  if (parsed.chainId !== null && parsed.chainId !== input.chainId) {
    return fail('The typed-data chain ID does not match the session network.');
  }
  return validateDAppRequest({
    ...input,
    requestType: 'typed-data-signing',
    status: 'pending',
    payload: {
      kind: 'typed-data-signing',
      method: input.method,
      typedData: parsed.rawPayload,
      displayWasTruncated: parsed.display.truncated,
    },
  }) as DAppTypedDataSigningRequest;
}