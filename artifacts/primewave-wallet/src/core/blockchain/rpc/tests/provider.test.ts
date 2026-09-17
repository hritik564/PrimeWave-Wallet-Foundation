import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvmRpcProvider,
  EvmRpcProvider,
  RpcProviderError,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '../index';
import {
  NetworkRegistry,
  NetworkRegistryError,
  supportedNetworks,
} from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

type FakeResponse =
  | RpcTransportResponse
  | Error
  | (() => Promise<RpcTransportResponse>);

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

function createRegistry(
  network: EvmNetwork = supportedNetworks.find(
    (candidate) => candidate.id === 'ethereum',
  ) as EvmNetwork,
): NetworkRegistry {
  const registry = new NetworkRegistry([
    supportedNetworks.find((candidate) => candidate.id === 'primewave') as EvmNetwork,
    network,
  ]);
  registry.selectActiveNetwork(network.id);
  return registry;
}

async function createInitializedProvider(
  responses: FakeResponse[],
  network?: EvmNetwork,
  timeoutMs?: number,
): Promise<{ provider: EvmRpcProvider; transport: FakeTransport }> {
  const transport = new FakeTransport(responses);
  const provider = await createEvmRpcProvider(createRegistry(network), {
    transport,
    timeoutMs,
  });
  return { provider, transport };
}

function expectRpcError(
  callback: () => unknown,
  code: RpcProviderError['code'],
): void {
  assert.throws(callback, (error: unknown) => {
    return error instanceof RpcProviderError && error.code === code;
  });
}

async function expectAsyncRpcError(
  callback: () => Promise<unknown>,
  code: RpcProviderError['code'],
): Promise<void> {
  await assert.rejects(callback, (error: unknown) => {
    return error instanceof RpcProviderError && error.code === code;
  });
}

test('creates JSON-RPC 2.0 requests with deterministic IDs and typed results', async () => {
  const { provider, transport } = await createInitializedProvider([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x2a'),
  ]);

  assert.equal(provider.isInitialized(), true);
  assert.equal(await provider.request('eth_blockNumber', []), '0x2a');
  assert.deepEqual(JSON.parse(transport.requests[0].body), {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: [],
  });
  assert.deepEqual(JSON.parse(transport.requests[1].body), {
    jsonrpc: '2.0',
    id: 2,
    method: 'eth_blockNumber',
    params: [],
  });
});

test('supports the foundation EVM method set without adding transaction behavior', async () => {
  const responses: FakeResponse[] = [
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x100'),
    jsonResponse(3, '0x10'),
    jsonResponse(4, '0x'),
    jsonResponse(5, '0x'),
    jsonResponse(6, { hash: '0xtransaction' }),
    jsonResponse(7, { status: '0x1' }),
    jsonResponse(8, '0x5208'),
    jsonResponse(9, '0x3b9aca00'),
    jsonResponse(10, { number: '0x100' }),
    jsonResponse(11, { number: '0x100' }),
    jsonResponse(12, '0xdeadbeef'),
  ];
  const { provider } = await createInitializedProvider(responses);

  assert.equal(await provider.request('eth_getBalance', ['0xabc', 'latest']), '0x100');
  assert.equal(
    await provider.request('eth_getTransactionCount', ['0xabc', 'latest']),
    '0x10',
  );
  assert.equal(await provider.request('eth_getCode', ['0xabc', 'latest']), '0x');
  assert.equal(
    await provider.request('eth_call', [{ to: '0xabc', data: '0x' }, 'latest']),
    '0x',
  );
  assert.deepEqual(
    await provider.request('eth_getTransactionByHash', ['0xhash']),
    { hash: '0xtransaction' },
  );
  assert.deepEqual(
    await provider.request('eth_getTransactionReceipt', ['0xhash']),
    { status: '0x1' },
  );
  assert.equal(
    await provider.request('eth_estimateGas', [{ to: '0xabc' }, 'latest']),
    '0x5208',
  );
  assert.equal(await provider.request('eth_gasPrice', []), '0x3b9aca00');
  assert.deepEqual(
    await provider.request('eth_getBlockByNumber', ['latest', false]),
    { number: '0x100' },
  );
  assert.deepEqual(
    await provider.request('eth_getBlockByHash', ['0xblock', false]),
    { number: '0x100' },
  );
  assert.equal(
    await provider.request('eth_sendRawTransaction', ['0xsigned']),
    '0xdeadbeef',
  );
});

test('rejects use before initialization and refuses an unselected or placeholder network', () => {
  const transport = new FakeTransport([]);
  expectRpcError(
    () =>
      new EvmRpcProvider(new NetworkRegistry(supportedNetworks), {
        transport,
      }),
    'CONFIGURATION_ERROR',
  );

  const registry = createRegistry();
  const provider = new EvmRpcProvider(registry, { transport });
  expectAsyncRpcError(
    () => provider.request('eth_blockNumber', []),
    'PROVIDER_NOT_INITIALIZED',
  );

  const placeholderRegistry = new NetworkRegistry([
    supportedNetworks.find((candidate) => candidate.id === 'primewave') as EvmNetwork,
    supportedNetworks.find((candidate) => candidate.id === 'ethereum') as EvmNetwork,
  ]);
  assert.throws(
    () => placeholderRegistry.selectActiveNetwork('primewave'),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'NETWORK_NOT_CONFIGURED',
  );
});

test('selects the highest-priority enabled endpoint without automatic failover', async () => {
  const ethereum = supportedNetworks.find(
    (candidate) => candidate.id === 'ethereum',
  ) as EvmNetwork;
  const network: EvmNetwork = {
    ...ethereum,
    rpc: {
      endpoints: [
        {
          id: 'disabled-first',
          url: 'https://disabled.example.com',
          priority: 0,
          enabled: false,
        },
        {
          id: 'enabled-second',
          url: 'https://enabled.example.com',
          priority: 1,
          enabled: true,
        },
      ],
    },
  };
  const { provider, transport } = await createInitializedProvider(
    [jsonResponse(1, '0x1')],
    network,
  );

  assert.equal(provider.getEndpointId(), 'enabled-second');
  assert.equal(transport.requests[0].endpoint.id, 'enabled-second');

  const unavailableNetwork: EvmNetwork = {
    ...network,
    id: 'no-endpoints',
    chainId: 999,
    rpc: {
      endpoints: [
        {
          id: 'disabled',
          url: 'https://disabled.example.com',
          priority: 0,
          enabled: false,
        },
      ],
    },
  };
  expectRpcError(
    () => new EvmRpcProvider(createRegistry(unavailableNetwork)),
    'ENDPOINT_UNAVAILABLE',
  );
});

test('verifies the remote chain ID before initialization completes', async () => {
  await expectAsyncRpcError(
    () =>
      createEvmRpcProvider(createRegistry(), {
        transport: new FakeTransport([jsonResponse(1, '0x38')]),
      }),
    'CHAIN_ID_MISMATCH',
  );
});

test('normalizes timeout, network, HTTP, malformed, and JSON-RPC failures', async () => {
  const timeoutTransport = new FakeTransport([
    jsonResponse(1, '0x1'),
    () => new Promise<RpcTransportResponse>(() => {}),
  ]);
  const timeoutProvider = await createEvmRpcProvider(createRegistry(), {
    transport: timeoutTransport,
    timeoutMs: 5,
  });
  await expectAsyncRpcError(
    () => timeoutProvider.request('eth_blockNumber', []),
    'TIMEOUT',
  );

  const unavailableTransport = new FakeTransport([
    jsonResponse(1, '0x1'),
    new Error('contains an internal secret and stack'),
  ]);
  const unavailableProvider = await createEvmRpcProvider(createRegistry(), {
    transport: unavailableTransport,
  });
  await expectAsyncRpcError(
    () => unavailableProvider.request('eth_blockNumber', []),
    'NETWORK_UNAVAILABLE',
  );

  const httpTransport = new FakeTransport([
    jsonResponse(1, '0x1'),
    { status: 503, body: 'service unavailable' },
  ]);
  const httpProvider = await createEvmRpcProvider(createRegistry(), {
    transport: httpTransport,
  });
  await expectAsyncRpcError(
    () => httpProvider.request('eth_blockNumber', []),
    'HTTP_FAILURE',
  );

  const malformedTransport = new FakeTransport([
    jsonResponse(1, '0x1'),
    { status: 200, body: '{not-json' },
  ]);
  const malformedProvider = await createEvmRpcProvider(createRegistry(), {
    transport: malformedTransport,
  });
  await expectAsyncRpcError(
    () => malformedProvider.request('eth_blockNumber', []),
    'MALFORMED_RESPONSE',
  );

  const rpcErrorTransport = new FakeTransport([
    jsonResponse(1, '0x1'),
    errorResponse(2, -32000, 'private key leaked by a hostile endpoint'),
  ]);
  const rpcErrorProvider = await createEvmRpcProvider(createRegistry(), {
    transport: rpcErrorTransport,
  });
  await assert.rejects(
    () => rpcErrorProvider.request('eth_blockNumber', []),
    (error: unknown) => {
      assert.ok(error instanceof RpcProviderError);
      assert.equal(error.code, 'JSON_RPC_ERROR');
      assert.equal(error.message, 'The RPC endpoint rejected the request.');
      assert.equal(error.details?.rpcCode, -32000);
      assert.equal(error.message.includes('private key'), false);
      return true;
    },
  );
});

test('rejects malformed responses, mismatched IDs, invalid params, and unsupported methods', async () => {
  const mismatchedId = await createEvmRpcProvider(createRegistry(), {
    transport: new FakeTransport([
      jsonResponse(1, '0x1'),
      jsonResponse(999, '0x2'),
    ]),
  });
  await expectAsyncRpcError(
    () => mismatchedId.request('eth_blockNumber', []),
    'INVALID_RESPONSE',
  );

  const bothFields = await createEvmRpcProvider(createRegistry(), {
    transport: new FakeTransport([
      jsonResponse(1, '0x1'),
      {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: 2,
          result: '0x2',
          error: { code: -1, message: 'invalid' },
        },
      },
    ]),
  });
  await expectAsyncRpcError(
    () => bothFields.request('eth_blockNumber', []),
    'INVALID_RESPONSE',
  );

  const invalidResult = await createEvmRpcProvider(createRegistry(), {
    transport: new FakeTransport([
      jsonResponse(1, '0x1'),
      jsonResponse(2, 'not-hex'),
    ]),
  });
  await expectAsyncRpcError(
    () => invalidResult.request('eth_blockNumber', []),
    'INVALID_RESPONSE',
  );

  await expectAsyncRpcError(
    () =>
      invalidResult.request(
        'eth_blockNumber' as 'eth_blockNumber',
        ['unexpected'] as never,
      ),
    'CONFIGURATION_ERROR',
  );
  await expectAsyncRpcError(
    () =>
      invalidResult.request(
        'eth_notARealMethod' as never,
        [] as never,
      ),
    'UNSUPPORTED_METHOD',
  );
});