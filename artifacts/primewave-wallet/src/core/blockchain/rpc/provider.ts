import { secureLogger } from '@/src/core/security/logging';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type {
  EvmNetwork,
  RpcEndpoint,
} from '@/src/core/networks/types';
import { RpcProviderError } from './errors';
import type {
  EvmRpcMethod,
  EvmRpcParams,
  EvmRpcResult,
  HexQuantity,
  JsonRpcId,
  JsonRpcRequest,
  RpcProviderOptions,
  RpcTransport,
  RpcTransportRequest,
  RpcTransportResponse,
} from './types';

export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

const RPC_METHODS = new Set<EvmRpcMethod>([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_getCode',
  'eth_call',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_sendRawTransaction',
]);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RpcProviderError('CONFIGURATION_ERROR');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        throw new RpcProviderError('CONFIGURATION_ERROR');
      }
      assertJsonValue(item, `${path}.${key}`);
    }
    return;
  }
  throw new RpcProviderError('CONFIGURATION_ERROR');
}

function isRpcMethod(value: unknown): value is EvmRpcMethod {
  return typeof value === 'string' && RPC_METHODS.has(value as EvmRpcMethod);
}

function validateRequestId(id: JsonRpcId): void {
  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    (typeof id === 'number' &&
      (!Number.isSafeInteger(id) || id < 0)) ||
    (typeof id === 'string' && id.length === 0)
  ) {
    throw new RpcProviderError('CONFIGURATION_ERROR');
  }
}

function validateParams(method: EvmRpcMethod, params: unknown): void {
  if (!Array.isArray(params)) {
    throw new RpcProviderError('CONFIGURATION_ERROR', { method });
  }
  assertJsonValue(params, 'params');

  const [first, second] = params;
  const requireLength = (length: number): void => {
    if (params.length !== length) {
      throw new RpcProviderError('CONFIGURATION_ERROR', { method });
    }
  };
  const requireLengthRange = (minimum: number, maximum: number): void => {
    if (params.length < minimum || params.length > maximum) {
      throw new RpcProviderError('CONFIGURATION_ERROR', { method });
    }
  };
  const requireNonEmptyString: (
    value: unknown,
  ) => asserts value is string = (value) => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new RpcProviderError('CONFIGURATION_ERROR', { method });
    }
  };
  const requireBlockTag = (value: unknown): void => {
    requireNonEmptyString(value);
    if (
      value !== 'latest' &&
      value !== 'earliest' &&
      value !== 'pending' &&
      !/^0x[0-9a-f]+$/i.test(value)
    ) {
      throw new RpcProviderError('CONFIGURATION_ERROR', { method });
    }
  };

  switch (method) {
    case 'eth_chainId':
    case 'eth_blockNumber':
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      requireLength(0);
      break;
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
    case 'eth_getCode':
      requireLengthRange(1, 2);
      requireNonEmptyString(first);
      if (params.length === 2) {
        requireBlockTag(second);
      }
      break;
    case 'eth_call':
    case 'eth_estimateGas':
      requireLengthRange(1, 2);
      if (!isPlainRecord(first)) {
        throw new RpcProviderError('CONFIGURATION_ERROR', { method });
      }
      if (params.length === 2) {
        requireBlockTag(second);
      }
      break;
    case 'eth_getTransactionByHash':
    case 'eth_getTransactionReceipt':
    case 'eth_getBlockByHash':
    case 'eth_sendRawTransaction':
      requireLength(method === 'eth_getBlockByHash' ? 2 : 1);
      requireNonEmptyString(first);
      if (method === 'eth_getBlockByHash') {
        if (typeof second !== 'boolean') {
          throw new RpcProviderError('CONFIGURATION_ERROR', { method });
        }
      }
      break;
    case 'eth_getBlockByNumber':
      requireLength(2);
      requireBlockTag(first);
      if (typeof second !== 'boolean') {
        throw new RpcProviderError('CONFIGURATION_ERROR', { method });
      }
      break;
    default:
      throw new RpcProviderError('UNSUPPORTED_METHOD', { method });
  }
}

function createJsonRpcRequest<M extends EvmRpcMethod>(
  id: JsonRpcId,
  method: M,
  params: EvmRpcParams<M>,
): JsonRpcRequest<M> {
  validateRequestId(id);
  if (!isRpcMethod(method)) {
    throw new RpcProviderError('UNSUPPORTED_METHOD', { method });
  }
  validateParams(method, params);
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

function isHexQuantity(value: unknown): value is HexQuantity {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
}

function isHexData(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value);
}

function validateResult(method: EvmRpcMethod, result: unknown): void {
  switch (method) {
    case 'eth_chainId':
    case 'eth_blockNumber':
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
    case 'eth_estimateGas':
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      if (!isHexQuantity(result)) {
        throw new RpcProviderError('INVALID_RESPONSE', { method });
      }
      return;
    case 'eth_getCode':
    case 'eth_call':
      if (!isHexData(result)) {
        throw new RpcProviderError('INVALID_RESPONSE', { method });
      }
      return;
    case 'eth_sendRawTransaction':
      if (!isHexData(result) || result === '0x') {
        throw new RpcProviderError('INVALID_RESPONSE', { method });
      }
      return;
    case 'eth_getTransactionByHash':
    case 'eth_getTransactionReceipt':
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash':
      if (result !== null && !isPlainRecord(result)) {
        throw new RpcProviderError('INVALID_RESPONSE', { method });
      }
      return;
    default:
      throw new RpcProviderError('UNSUPPORTED_METHOD', { method });
  }
}

function sameJsonRpcId(left: unknown, right: JsonRpcId): boolean {
  return (
    (typeof left === 'number' || typeof left === 'string') &&
    left === right
  );
}

function parseJsonRpcResponse<M extends EvmRpcMethod>(
  body: unknown,
  expectedId: JsonRpcId,
  method: M,
): EvmRpcResult<M> {
  if (!isPlainRecord(body) || body.jsonrpc !== '2.0') {
    throw new RpcProviderError('INVALID_RESPONSE', { method });
  }
  if (!sameJsonRpcId(body.id, expectedId)) {
    throw new RpcProviderError('INVALID_RESPONSE', { method });
  }

  const hasResult = Object.prototype.hasOwnProperty.call(body, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(body, 'error');
  if (hasResult === hasError) {
    throw new RpcProviderError('INVALID_RESPONSE', { method });
  }

  if (hasError) {
    const error = body.error;
    if (
      !isPlainRecord(error) ||
      typeof error.code !== 'number' ||
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== 'string' ||
      error.message.length === 0
    ) {
      throw new RpcProviderError('INVALID_RESPONSE', { method });
    }
    throw new RpcProviderError('JSON_RPC_ERROR', {
      method,
      rpcCode: error.code,
    });
  }

  validateResult(method, body.result);
  return body.result as EvmRpcResult<M>;
}

function parseChainId(value: HexQuantity): bigint {
  try {
    const chainId = BigInt(value);
    if (chainId <= 0n) {
      throw new Error('invalid chain ID');
    }
    return chainId;
  } catch {
    throw new RpcProviderError('INVALID_RESPONSE', {
      method: 'eth_chainId',
    });
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (isPlainRecord(error) && error.name === 'AbortError')
  );
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new RpcProviderError('TIMEOUT')),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

function normalizeTransportError(
  error: unknown,
  endpointId: string,
  method: string,
): RpcProviderError {
  if (error instanceof RpcProviderError) {
    return error;
  }
  if (isAbortError(error)) {
    return new RpcProviderError('TIMEOUT', { endpointId, method });
  }
  return new RpcProviderError('NETWORK_UNAVAILABLE', { endpointId, method });
}

function parseBody(body: unknown, endpointId: string, method: string): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RpcProviderError('MALFORMED_RESPONSE', { endpointId, method });
  }
}

function chooseEndpoint(network: EvmNetwork): RpcEndpoint {
  const endpoint = [...network.rpc.endpoints]
    .filter((candidate) => candidate.enabled !== false)
    .sort((left, right) => left.priority - right.priority)[0];
  if (!endpoint) {
    throw new RpcProviderError('ENDPOINT_UNAVAILABLE');
  }
  return endpoint;
}

export class FetchRpcTransport implements RpcTransport {
  constructor(
    private readonly fetchImplementation: (
      url: string,
      init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal?: unknown;
      },
    ) => Promise<{
      status: number;
      text(): Promise<string>;
    }> = globalThis.fetch as unknown as (
      url: string,
      init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal?: unknown;
      },
    ) => Promise<{
      status: number;
      text(): Promise<string>;
    }>,
  ) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(
      () => controller?.abort(),
      request.timeoutMs,
    );
    try {
      const response = await this.fetchImplementation(request.endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: request.body,
        signal: controller?.signal,
      });
      const body = await response.text();
      let parsedBody: unknown = body;
      try {
        parsedBody = JSON.parse(body) as unknown;
      } catch {
        // The provider normalizes non-JSON bodies as malformed responses.
      }
      return { status: response.status, body: parsedBody };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class EvmRpcProvider {
  private readonly network: EvmNetwork;
  private readonly endpoint: RpcEndpoint;
  private readonly transport: RpcTransport;
  private readonly timeoutMs: number;
  private requestId = 0;
  private initialized = false;

  constructor(
    registry: NetworkRegistry,
    options: RpcProviderOptions = {},
  ) {
    const activeNetwork = registry.getActiveNetwork();
    if (!activeNetwork) {
      throw new RpcProviderError('CONFIGURATION_ERROR');
    }
    if (
      activeNetwork.configurationStatus !== 'configured' ||
      activeNetwork.chainId === null
    ) {
      throw new RpcProviderError('CONFIGURATION_ERROR');
    }

    this.network = activeNetwork;
    this.endpoint = chooseEndpoint(activeNetwork);
    this.transport = options.transport ?? new FetchRpcTransport();
    this.timeoutMs = Math.max(
      1,
      options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    );
  }

  getNetwork(): EvmNetwork {
    return this.network;
  }

  getEndpointId(): string {
    return this.endpoint.id;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const remoteChainId = await this.requestInternal('eth_chainId', []);
    if (parseChainId(remoteChainId) !== BigInt(this.network.chainId as number)) {
      throw new RpcProviderError('CHAIN_ID_MISMATCH', {
        endpointId: this.endpoint.id,
        method: 'eth_chainId',
      });
    }
    this.initialized = true;
  }

  async request<M extends EvmRpcMethod>(
    method: M,
    params: EvmRpcParams<M>,
  ): Promise<EvmRpcResult<M>> {
    if (!this.initialized) {
      throw new RpcProviderError('PROVIDER_NOT_INITIALIZED', { method });
    }
    return this.requestInternal(method, params);
  }

  private async requestInternal<M extends EvmRpcMethod>(
    method: M,
    params: EvmRpcParams<M>,
  ): Promise<EvmRpcResult<M>> {
    const id = this.nextRequestId();
    const request = createJsonRpcRequest(id, method, params);
    let response: RpcTransportResponse;
    try {
      response = await withTimeout(
        this.transport.request({
          endpoint: this.endpoint,
          body: JSON.stringify(request),
          timeoutMs: this.timeoutMs,
        }),
        this.timeoutMs,
      );
    } catch (error) {
      const normalized = normalizeTransportError(
        error,
        this.endpoint.id,
        method,
      );
      secureLogger.warning('RPC request failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.endpoint.id,
        method,
        errorCode: normalized.code,
      });
      throw normalized;
    }

    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      const error = new RpcProviderError('HTTP_FAILURE', {
        endpointId: this.endpoint.id,
        method,
        status: response.status,
      });
      secureLogger.warning('RPC request failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.endpoint.id,
        method,
        errorCode: error.code,
      });
      throw error;
    }

    try {
      const result = parseJsonRpcResponse(
        parseBody(response.body, this.endpoint.id, method),
        id,
        method,
      );
      secureLogger.debug('RPC request completed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.endpoint.id,
        method,
        success: true,
      });
      return result;
    } catch (error) {
      const normalized =
        error instanceof RpcProviderError
          ? error
          : new RpcProviderError('INVALID_RESPONSE', {
              endpointId: this.endpoint.id,
              method,
            });
      secureLogger.warning('RPC request failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.endpoint.id,
        method,
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }
}

export async function createEvmRpcProvider(
  registry: NetworkRegistry,
  options: RpcProviderOptions = {},
): Promise<EvmRpcProvider> {
  const provider = new EvmRpcProvider(registry, options);
  await provider.initialize();
  return provider;
}