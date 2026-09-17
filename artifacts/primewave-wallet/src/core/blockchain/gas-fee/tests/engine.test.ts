import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GasFeeEngine,
  GasFeeError,
  createGasFeeEngine,
  formatNativeUnits,
} from '../index';
import {
  createEvmRpcProvider,
  EvmRpcProvider,
  RpcProviderError,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import {
  NetworkRegistry,
  NetworkRegistryError,
  supportedNetworks,
} from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

type FakeResponse =
  | RpcTransportResponse
  | Error
  | (() => RpcTransportResponse | Promise<RpcTransportResponse>);

class FakeTransport implements RpcTransport {
  readonly requests: RpcTransportRequest[] = [];

  constructor(private readonly responses: FakeResponse[]) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No fake response configured.');
    }
    if (response instanceof Error) {
      throw response;
    }
    return typeof response === 'function' ? response() : response;
  }
}

function jsonResponse(id: number, result: unknown): RpcTransportResponse {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id, result },
  };
}

function errorResponse(
  id: number,
  code: number,
  message: string,
): RpcTransportResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    },
  };
}

function createRegistry(includeBase = false): NetworkRegistry {
  const primewave = supportedNetworks.find(
    (network) => network.id === 'primewave',
  ) as EvmNetwork;
  const ethereum = supportedNetworks.find(
    (network) => network.id === 'ethereum',
  ) as EvmNetwork;
  const networks = [primewave, ethereum];
  if (includeBase) {
    networks.push(
      supportedNetworks.find((network) => network.id === 'base') as EvmNetwork,
    );
  }
  const registry = new NetworkRegistry(networks);
  registry.selectActiveNetwork('ethereum');
  return registry;
}

async function createEngine(
  responses: FakeResponse[],
  options: { includeBase?: boolean; timeoutMs?: number } = {},
): Promise<{
  engine: GasFeeEngine;
  registry: NetworkRegistry;
  transport: FakeTransport;
}> {
  const registry = createRegistry(options.includeBase);
  const transport = new FakeTransport(responses);
  const provider = await createEvmRpcProvider(registry, {
    transport,
    timeoutMs: options.timeoutMs,
  });
  const engine = await createGasFeeEngine(registry, provider);
  return { engine, registry, transport };
}

async function expectGasError(
  callback: () => Promise<unknown>,
  code: GasFeeError['code'],
): Promise<void> {
  await assert.rejects(callback, (error: unknown) => {
    return error instanceof GasFeeError && error.code === code;
  });
}

const FROM_ADDRESS = '0x52908400098527886e0f7030069857d2e4169ee7';
const FROM_CHECKSUMMED = '0x52908400098527886E0F7030069857D2E4169EE7';
const TO_ADDRESS = '0x1111111111111111111111111111111111111111';

test('estimates gas with normalized public transaction fields', async () => {
  const { engine, transport } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x5208'),
  ]);

  const estimate = await engine.estimateGas({
    from: FROM_ADDRESS,
    to: TO_ADDRESS,
    value: 1_000n,
    data: '0xabcdef',
  });

  assert.equal(estimate.gasLimit, 21_000n);
  assert.equal(estimate.chainId, 1n);
  assert.equal(estimate.request.from, FROM_CHECKSUMMED);
  assert.equal(estimate.request.value, '0x3e8');
  assert.equal(estimate.request.data, '0xabcdef');
  const rpcRequest = JSON.parse(transport.requests[2].body);
  assert.deepEqual(rpcRequest.params, [
    {
      from: FROM_CHECKSUMMED,
      to: TO_ADDRESS,
      value: '0x3e8',
      data: '0xabcdef',
    },
    'latest',
  ]);
});

test('rejects invalid addresses, values, calldata, and empty requests before RPC reads', async () => {
  const { engine, transport } = await createEngine([jsonResponse(1, '0x1')]);

  await expectGasError(
    () => engine.estimateGas({ from: 'not-an-address' }),
    'INVALID_ADDRESS',
  );
  await expectGasError(
    () => engine.estimateGas({ to: '0x123' }),
    'INVALID_ADDRESS',
  );
  await expectGasError(
    () => engine.estimateGas({ to: TO_ADDRESS, value: -1n }),
    'INVALID_VALUE',
  );
  await expectGasError(
    () => engine.estimateGas({ to: TO_ADDRESS, value: '0x' }),
    'INVALID_VALUE',
  );
  await expectGasError(
    () => engine.estimateGas({ to: TO_ADDRESS, data: '0x123' }),
    'INVALID_CALLDATA',
  );
  await expectGasError(() => engine.estimateGas({}), 'INVALID_TRANSACTION_REQUEST');
  assert.equal(transport.requests.length, 1);
});

test('keeps very large gas limits, prices, and fees lossless', async () => {
  const gasLimit = 123456789012345678901234567890n;
  const gasPrice = 98765432109876543210987654321n;
  const { engine } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, `0x${gasLimit.toString(16)}`),
    jsonResponse(4, '0x1'),
    jsonResponse(5, `0x${gasPrice.toString(16)}`),
  ]);

  const quote = await engine.getFeeQuote(
    { from: FROM_ADDRESS, to: TO_ADDRESS },
    'legacy',
  );
  if (quote.model !== 'legacy') {
    throw new Error('Expected a legacy fee quote.');
  }

  assert.equal(quote.model, 'legacy');
  assert.equal(quote.gasLimit, gasLimit);
  assert.equal(quote.gasPrice, gasPrice);
  assert.equal(quote.estimatedNetworkFee, gasLimit * gasPrice);
  assert.equal(quote.estimatedNetworkFeeDisplay, formatNativeUnits(gasLimit * gasPrice, 18));
});

test('retrieves legacy gas pricing and calculates the maximum estimated fee', async () => {
  const { engine } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x5208'),
    jsonResponse(4, '0x1'),
    jsonResponse(5, '0x3b9aca00'),
  ]);

  const quote = await engine.getFeeQuote(
    { to: TO_ADDRESS, value: 0n },
    'legacy',
  );
  if (quote.model !== 'legacy') {
    throw new Error('Expected a legacy fee quote.');
  }

  assert.deepEqual(
    {
      model: quote.model,
      gasLimit: quote.gasLimit,
      gasPrice: quote.gasPrice,
      estimatedNetworkFee: quote.estimatedNetworkFee,
      symbol: quote.symbol,
    },
    {
      model: 'legacy',
      gasLimit: 21_000n,
      gasPrice: 1_000_000_000n,
      estimatedNetworkFee: 21_000_000_000_000n,
      symbol: 'ETH',
    },
  );
});

test('retrieves EIP-1559 data without hidden gas or fee multipliers', async () => {
  const { engine } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x5208'),
    jsonResponse(4, '0x1'),
    jsonResponse(5, { number: '0x2a', baseFeePerGas: '0x3b9aca00' }),
    jsonResponse(6, '0x59682f00'),
  ]);

  const quote = await engine.getFeeQuote(
    { from: FROM_ADDRESS, to: TO_ADDRESS },
    'eip1559',
  );

  assert.equal(quote.model, 'eip1559');
  assert.equal(quote.baseFeePerGas, 1_000_000_000n);
  assert.equal(quote.maxPriorityFeePerGas, 1_500_000_000n);
  assert.equal(quote.maxFeePerGas, 2_500_000_000n);
  assert.equal(quote.estimatedNetworkFee, 52_500_000_000_000n);
});

test('falls back from missing EIP-1559 data to a legacy fee model', async () => {
  const { engine } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, { number: '0x2a' }),
    jsonResponse(4, '0x59682f00'),
    jsonResponse(5, '0x1'),
    jsonResponse(6, '0x3b9aca00'),
  ]);

  const feeData = await engine.getFeeData();

  assert.equal(feeData.model, 'legacy');
  assert.equal(feeData.gasPrice, 1_000_000_000n);
});

test('reports missing EIP-1559 data and unsupported priority-fee methods safely', async () => {
  const missing = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, { number: '0x2a' }),
    jsonResponse(4, '0x1'),
  ]);
  await expectGasError(
    () => missing.engine.getEip1559FeeData(),
    'MISSING_FEE_DATA',
  );

  const unsupported = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, { number: '0x2a', baseFeePerGas: '0x1' }),
    errorResponse(4, -32601, 'method not found'),
  ]);
  await expectGasError(
    () => unsupported.engine.getEip1559FeeData(),
    'UNSUPPORTED_FEE_MODEL',
  );
});

test('rejects zero and malformed fee quantities', async () => {
  const zeroGas = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x0'),
  ]);
  await expectGasError(
    () => zeroGas.engine.estimateGas({ to: TO_ADDRESS }),
    'ZERO_GAS_LIMIT',
  );

  const zeroPrice = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x0'),
  ]);
  await expectGasError(
    () => zeroPrice.engine.getLegacyFeeData(),
    'ZERO_GAS_PRICE',
  );

  const malformed = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x'),
  ]);
  await expectGasError(
    () => malformed.engine.getLegacyFeeData(),
    'RPC_MALFORMED_RESPONSE',
  );
});

test('normalizes estimation RPC errors and timeouts without provider internals', async () => {
  const rejected = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    errorResponse(3, -32000, 'execution reverted'),
  ]);
  await expectGasError(
    () => rejected.engine.estimateGas({ to: TO_ADDRESS }),
    'ESTIMATION_FAILED',
  );

  const timeout = await createEngine(
    [
      jsonResponse(1, '0x1'),
      jsonResponse(2, '0x1'),
      () => new Promise<RpcTransportResponse>(() => {}),
    ],
    { timeoutMs: 5 },
  );
  await expectGasError(
    () => timeout.engine.estimateGas({ to: TO_ADDRESS }),
    'RPC_TIMEOUT',
  );
});

test('rejects chain mismatches and stale network results', async () => {
  const mismatch = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x38'),
  ]);
  await expectGasError(
    () => mismatch.engine.getLegacyFeeData(),
    'CHAIN_ID_MISMATCH',
  );

  let registry: NetworkRegistry;
  const transport = new FakeTransport([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    () => {
      registry.selectActiveNetwork('base');
      return jsonResponse(3, '0x5208');
    },
  ]);
  registry = createRegistry(true);
  const provider = await createEvmRpcProvider(registry, { transport });
  const engine = await createGasFeeEngine(registry, provider);
  await expectGasError(
    () => engine.estimateGas({ to: TO_ADDRESS }),
    'NETWORK_CHANGED',
  );
});

test('rejects the unconfigured PrimeWave placeholder and does not persist fee data', async () => {
  const registry = new NetworkRegistry(supportedNetworks);
  assert.throws(
    () => registry.selectActiveNetwork('primewave'),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'NETWORK_NOT_CONFIGURED',
  );

  const engineMethods = Object.getOwnPropertyNames(GasFeeEngine.prototype);
  assert.equal(engineMethods.includes('save'), false);
  assert.equal(engineMethods.includes('persist'), false);
});

test('formats native fee quantities without floating-point arithmetic', () => {
  assert.equal(formatNativeUnits(1_234_567_890_123_456_789n, 18), '1.234567890123456789');
  assert.equal(formatNativeUnits(42n, 0), '42');
});

test('does not expose raw RPC error messages through normalized gas errors', async () => {
  const { engine } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    errorResponse(3, -32000, 'private key should never be surfaced'),
  ]);

  await assert.rejects(
    () => engine.estimateGas({ to: TO_ADDRESS }),
    (error: unknown) => {
      assert(error instanceof GasFeeError);
      assert.equal(error.message, 'The network rejected gas estimation.');
      assert.equal(error.message.includes('private key'), false);
      return true;
    },
  );
});

test('keeps provider errors normalized at the provider boundary', async () => {
  const registry = createRegistry();
  const transport = new FakeTransport([jsonResponse(1, '0x1')]);
  const provider = new EvmRpcProvider(registry, { transport });
  await assert.rejects(
    () => provider.request('eth_maxPriorityFeePerGas', []),
    (error: unknown) =>
      error instanceof RpcProviderError &&
      error.code === 'PROVIDER_NOT_INITIALIZED',
  );
});