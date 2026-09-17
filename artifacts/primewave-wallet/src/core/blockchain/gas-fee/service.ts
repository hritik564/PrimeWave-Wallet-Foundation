import { secureLogger } from '@/src/core/security/logging';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import {
  EvmRpcProvider,
  RpcProviderError,
  type EvmRpcMethod,
  type EvmRpcParams,
  type EvmRpcResult,
  type RpcCallObject,
} from '@/src/core/blockchain/rpc';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { GasFeeError } from './errors';
import { formatNativeUnits } from './format';
import type {
  Eip1559FeeData,
  Eip1559FeeQuote,
  FeeData,
  FeeModelPreference,
  FeeQuote,
  GasEstimate,
  GasEstimationRequest,
  GasFeeEngineOptions,
  LegacyFeeData,
  LegacyFeeQuote,
  NormalizedGasEstimationRequest,
  UnavailableFeeData,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new GasFeeError('INVALID_QUANTITY');
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new GasFeeError('INVALID_QUANTITY');
    }
    return parsed;
  } catch (error) {
    if (error instanceof GasFeeError) {
      throw error;
    }
    throw new GasFeeError('INVALID_QUANTITY');
  }
}

function normalizeQuantity(value: unknown): `0x${string}` {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new GasFeeError('INVALID_VALUE');
    }
    return `0x${value.toString(16)}`;
  }
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new GasFeeError('INVALID_VALUE');
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new GasFeeError('INVALID_VALUE');
    }
    return `0x${parsed.toString(16)}`;
  } catch (error) {
    if (error instanceof GasFeeError) {
      throw error;
    }
    throw new GasFeeError('INVALID_VALUE');
  }
}

function normalizeAddress(value: unknown): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    throw new GasFeeError('INVALID_ADDRESS');
  }
}

function normalizeCalldata(value: unknown): `0x${string}` {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(value) ||
    (value.length - 2) % 2 !== 0
  ) {
    throw new GasFeeError('INVALID_CALLDATA');
  }
  return value as `0x${string}`;
}

function normalizeRequest(
  request: GasEstimationRequest,
): NormalizedGasEstimationRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new GasFeeError('INVALID_TRANSACTION_REQUEST');
  }

  const normalized: NormalizedGasEstimationRequest = {
    ...(request.from === undefined
      ? {}
      : { from: normalizeAddress(request.from) }),
    ...(request.to === undefined ? {} : { to: normalizeAddress(request.to) }),
    ...(request.value === undefined
      ? {}
      : { value: normalizeQuantity(request.value) }),
    ...(request.data === undefined
      ? {}
      : { data: normalizeCalldata(request.data) }),
  };

  if (Object.keys(normalized).length === 0) {
    throw new GasFeeError('INVALID_TRANSACTION_REQUEST');
  }

  return normalized;
}

function toRpcCall(request: NormalizedGasEstimationRequest): RpcCallObject {
  return {
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.to === undefined ? {} : { to: request.to }),
    ...(request.value === undefined ? {} : { value: request.value }),
    ...(request.data === undefined ? {} : { data: request.data }),
  };
}

function normalizeRpcError(
  error: unknown,
  operation: 'estimate' | 'fee' | 'priority' | 'block' | 'chain',
): GasFeeError {
  if (error instanceof GasFeeError) {
    return error;
  }
  if (!(error instanceof RpcProviderError)) {
    return new GasFeeError(
      operation === 'estimate' ? 'ESTIMATION_FAILED' : 'RPC_UNAVAILABLE',
    );
  }

  switch (error.code) {
    case 'TIMEOUT':
      return new GasFeeError('RPC_TIMEOUT');
    case 'NETWORK_UNAVAILABLE':
    case 'ENDPOINT_UNAVAILABLE':
    case 'HTTP_FAILURE':
      return new GasFeeError('RPC_UNAVAILABLE');
    case 'MALFORMED_RESPONSE':
    case 'INVALID_RESPONSE':
      return new GasFeeError('RPC_MALFORMED_RESPONSE');
    case 'UNSUPPORTED_METHOD':
      return new GasFeeError('UNSUPPORTED_RPC_METHOD');
    case 'CHAIN_ID_MISMATCH':
      return new GasFeeError('CHAIN_ID_MISMATCH');
    case 'CONFIGURATION_ERROR':
    case 'PROVIDER_NOT_INITIALIZED':
      return new GasFeeError('CONFIGURATION_ERROR');
    case 'JSON_RPC_ERROR':
      if (operation === 'priority') {
        return new GasFeeError('UNSUPPORTED_FEE_MODEL');
      }
      return new GasFeeError(
        operation === 'estimate' ? 'ESTIMATION_FAILED' : 'RPC_UNAVAILABLE',
      );
    default:
      return new GasFeeError(
        operation === 'estimate' ? 'ESTIMATION_FAILED' : 'RPC_UNAVAILABLE',
      );
  }
}

function errorCategory(error: unknown): string {
  if (error instanceof GasFeeError) {
    return error.code;
  }
  if (error instanceof RpcProviderError) {
    return error.code;
  }
  return 'UNEXPECTED_ERROR';
}

function maskAddress(address: string | undefined): string | null {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;
}

export class GasFeeEngine {
  private readonly network: EvmNetwork;
  private readonly now: () => number;

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly provider: EvmRpcProvider,
    options: GasFeeEngineOptions = {},
  ) {
    this.network = provider.getNetwork();
    this.now = options.now ?? (() => Date.now());
    this.assertNetworkUnchanged();
  }

  getNetwork(): EvmNetwork {
    return this.network;
  }

  async estimateGas(request: GasEstimationRequest): Promise<GasEstimate> {
    const normalized = normalizeRequest(request);
    return this.runLogged('gas-estimate', normalized.from, async () => {
      const chainId = await this.readVerifiedChainId();
      const rawGasLimit = await this.request(
        'eth_estimateGas',
        [toRpcCall(normalized), 'latest'],
        'estimate',
      );
      this.assertNetworkUnchanged();
      const gasLimit = parseQuantity(rawGasLimit);
      if (gasLimit === 0n) {
        throw new GasFeeError('ZERO_GAS_LIMIT');
      }
      return {
        request: normalized,
        networkId: this.network.id,
        chainId,
        gasLimit,
      };
    });
  }

  async getLegacyFeeData(): Promise<LegacyFeeData> {
    return this.runLogged('legacy-fee-data', undefined, async () => {
      const chainId = await this.readVerifiedChainId();
      const rawGasPrice = await this.request(
        'eth_gasPrice',
        [],
        'fee',
      );
      this.assertNetworkUnchanged();
      const gasPrice = parseQuantity(rawGasPrice);
      if (gasPrice === 0n) {
        throw new GasFeeError('ZERO_GAS_PRICE');
      }
      return {
        model: 'legacy',
        networkId: this.network.id,
        chainId,
        gasPrice,
        symbol: this.network.nativeCurrency.symbol,
        decimals: this.network.nativeCurrency.decimals,
      };
    });
  }

  async getEip1559FeeData(): Promise<Eip1559FeeData> {
    return this.runLogged('eip1559-fee-data', undefined, async () => {
      const chainId = await this.readVerifiedChainId();
      const [block, rawPriorityFee] = await Promise.all([
        this.request('eth_getBlockByNumber', ['latest', false], 'block'),
        this.request(
          'eth_maxPriorityFeePerGas',
          [],
          'priority',
        ),
      ]);
      this.assertNetworkUnchanged();

      if (
        !isRecord(block) ||
        block.baseFeePerGas === undefined ||
        block.baseFeePerGas === null
      ) {
        throw new GasFeeError('MISSING_FEE_DATA');
      }

      const baseFeePerGas = parseQuantity(block.baseFeePerGas);
      const maxPriorityFeePerGas = parseQuantity(rawPriorityFee);
      const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
      if (maxFeePerGas === 0n) {
        throw new GasFeeError('ZERO_GAS_PRICE');
      }

      return {
        model: 'eip1559',
        networkId: this.network.id,
        chainId,
        baseFeePerGas,
        maxPriorityFeePerGas,
        maxFeePerGas,
        symbol: this.network.nativeCurrency.symbol,
        decimals: this.network.nativeCurrency.decimals,
      };
    });
  }

  async getFeeData(): Promise<FeeData> {
    try {
      return await this.getEip1559FeeData();
    } catch (error) {
      const normalized = normalizeRpcError(error, 'fee');
      if (
        normalized.code !== 'MISSING_FEE_DATA' &&
        normalized.code !== 'UNSUPPORTED_FEE_MODEL'
      ) {
        throw normalized;
      }

      try {
        return await this.getLegacyFeeData();
      } catch (legacyError) {
        const legacy = normalizeRpcError(legacyError, 'fee');
        if (legacy.code === 'ZERO_GAS_PRICE') {
          return this.createUnavailableFeeData(
            normalized.code === 'UNSUPPORTED_FEE_MODEL'
              ? 'unsupported'
              : 'missing',
          );
        }
        throw legacy;
      }
    }
  }

  async getFeeQuote(
    request: GasEstimationRequest,
    preference: FeeModelPreference = 'auto',
  ): Promise<FeeQuote> {
    const estimate = await this.estimateGas(request);
    const data =
      preference === 'legacy'
        ? await this.getLegacyFeeData()
        : preference === 'eip1559'
          ? await this.getEip1559FeeData()
          : await this.getFeeData();

    if (data.model === 'unavailable') {
      throw new GasFeeError('UNSUPPORTED_FEE_MODEL');
    }

    const estimatedNetworkFee = estimate.gasLimit *
      (data.model === 'legacy' ? data.gasPrice : data.maxFeePerGas);
    const common = {
      request: estimate.request,
      networkId: estimate.networkId,
      chainId: estimate.chainId,
      gasLimit: estimate.gasLimit,
      symbol: data.symbol,
      decimals: data.decimals,
      estimatedNetworkFee,
      estimatedNetworkFeeDisplay: formatNativeUnits(
        estimatedNetworkFee,
        data.decimals,
      ),
    };

    if (data.model === 'legacy') {
      const quote: LegacyFeeQuote = {
        ...common,
        model: data.model,
        gasPrice: data.gasPrice,
      };
      return quote;
    }

    const quote: Eip1559FeeQuote = {
      ...common,
      model: data.model,
      baseFeePerGas: data.baseFeePerGas,
      maxPriorityFeePerGas: data.maxPriorityFeePerGas,
      maxFeePerGas: data.maxFeePerGas,
    };
    return quote;
  }

  private createUnavailableFeeData(
    reason: UnavailableFeeData['reason'],
  ): UnavailableFeeData {
    const chainId = BigInt(this.network.chainId as number);
    return {
      model: 'unavailable',
      reason,
      networkId: this.network.id,
      chainId,
      symbol: this.network.nativeCurrency.symbol,
      decimals: this.network.nativeCurrency.decimals,
    };
  }

  private async readVerifiedChainId(): Promise<bigint> {
    this.assertNetworkUnchanged();
    const chainIdHex = await this.request('eth_chainId', [], 'chain');
    const chainId = parseQuantity(chainIdHex);
    const expectedChainId = BigInt(this.network.chainId as number);
    if (chainId !== expectedChainId) {
      throw new GasFeeError('CHAIN_ID_MISMATCH');
    }
    this.assertNetworkUnchanged();
    return chainId;
  }

  private async request<M extends EvmRpcMethod>(
    method: M,
    params: EvmRpcParams<M>,
    operation: 'estimate' | 'fee' | 'priority' | 'block' | 'chain',
  ): Promise<EvmRpcResult<M>> {
    try {
      return await this.provider.request(method, params);
    } catch (error) {
      throw normalizeRpcError(error, operation);
    }
  }

  private assertNetworkUnchanged(): void {
    const activeNetwork = this.registry.getActiveNetwork();
    if (
      !activeNetwork ||
      activeNetwork.id !== this.network.id ||
      activeNetwork.chainId !== this.network.chainId
    ) {
      throw new GasFeeError('NETWORK_CHANGED');
    }
    if (
      this.network.configurationStatus !== 'configured' ||
      this.network.chainId === null ||
      !this.provider.isInitialized()
    ) {
      throw new GasFeeError('CONFIGURATION_ERROR');
    }
  }

  private async runLogged<T>(
    operation: string,
    address: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await action();
      secureLogger.debug('Gas and fee read completed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        operation,
        address: maskAddress(address),
        durationMs: Math.max(0, this.now() - startedAt),
        success: true,
      });
      return result;
    } catch (error) {
      secureLogger.warning('Gas and fee read failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        operation,
        address: maskAddress(address),
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: errorCategory(error),
      });
      throw error;
    }
  }
}

export async function createGasFeeEngine(
  registry: NetworkRegistry,
  provider: EvmRpcProvider,
  options: GasFeeEngineOptions = {},
): Promise<GasFeeEngine> {
  if (!provider.isInitialized()) {
    await provider.initialize();
  }
  return new GasFeeEngine(registry, provider, options);
}