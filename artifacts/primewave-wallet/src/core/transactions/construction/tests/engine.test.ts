import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TransactionConstructionEngine,
  TransactionConstructionError,
  createTransactionConstructionEngine,
  serializeUnsignedTransaction,
  type PublicWalletAccount,
} from '../index';
import {
  createEvmRpcProvider,
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

const FROM =
  '0x52908400098527886e0f7030069857d2e4169ee7';
const FROM_CHECKSUMMED =
  '0x52908400098527886E0F7030069857D2E4169EE7';
const TO = '0x1111111111111111111111111111111111111111';
const UNKNOWN = '0x2222222222222222222222222222222222222222';

type RpcHandler = (
  request: RpcTransportRequest,
) => RpcTransportResponse | Promise<RpcTransportResponse>;

class FakeTransport implements RpcTransport {
  readonly requests: RpcTransportRequest[] = [];

  constructor(private readonly handler: RpcHandler) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    const body = JSON.parse(request.body) as { method?: string };
    if (body.method === 'eth_sendRawTransaction') {
      throw new Error('Broadcasting is forbidden in construction tests.');
    }
    this.requests.push(request);
    return this.handler(request);
  }
}

function response(request: RpcTransportRequest, result: unknown): RpcTransportResponse {
  const body = JSON.parse(request.body) as { id: number };
  return {
    status: 200,
    body: { jsonrpc: '2.0', id: body.id, result },
  };
}

function rpcError(
  request: RpcTransportRequest,
  code: number,
  message: string,
): RpcTransportResponse {
  const body = JSON.parse(request.body) as { id: number };
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: body.id,
      error: { code, message },
    },
  };
}

function createRegistry(includeBase = false): NetworkRegistry {
  const networks = supportedNetworks.filter(
    (network) =>
      network.id === 'primewave' ||
      network.id === 'ethereum' ||
      (includeBase && network.id === 'base'),
  );
  const registry = new NetworkRegistry(networks);
  registry.selectActiveNetwork('ethereum');
  return registry;
}

function standardHandler(options: {
  nonce?: string;
  gas?: string;
  gasPrice?: string;
  baseFee?: string | null;
  priorityFee?: string;
  chainIds?: string[];
  onRequest?: (method: string, registry: NetworkRegistry) => void;
} = {}): {
  handler: RpcHandler;
  registry: NetworkRegistry;
} {
  const registry = createRegistry(options.onRequest !== undefined);
  const chainIds = [...(options.chainIds ?? ['0x1'])];
  return {
    registry,
    handler: (request) => {
      const body = JSON.parse(request.body) as { method: string };
      options.onRequest?.(body.method, registry);
      switch (body.method) {
        case 'eth_chainId':
          return response(request, chainIds.length > 1 ? chainIds.shift() : chainIds[0]);
        case 'eth_getTransactionCount':
          return response(request, options.nonce ?? '0x0');
        case 'eth_estimateGas':
          return response(request, options.gas ?? '0x5208');
        case 'eth_gasPrice':
          return response(request, options.gasPrice ?? '0x3b9aca00');
        case 'eth_getBlockByNumber':
          return response(
            request,
            options.baseFee === null
              ? { number: '0x1' }
              : { number: '0x1', baseFeePerGas: options.baseFee ?? '0x3b9aca00' },
          );
        case 'eth_maxPriorityFeePerGas':
          return response(request, options.priorityFee ?? '0x59682f00');
        default:
          throw new Error(`Unexpected RPC method: ${body.method}`);
      }
    },
  };
}

async function createEngine(
  options: {
    nonce?: string;
    gas?: string;
    gasPrice?: string;
    baseFee?: string | null;
    priorityFee?: string;
    chainIds?: string[];
    timeoutMs?: number;
    onRequest?: (method: string, registry: NetworkRegistry) => void;
  } = {},
): Promise<{
  engine: TransactionConstructionEngine;
  registry: NetworkRegistry;
  transport: FakeTransport;
}> {
  const configured = standardHandler(options);
  const transport = new FakeTransport(configured.handler);
  const provider = await createEvmRpcProvider(configured.registry, {
    transport,
    timeoutMs: options.timeoutMs,
  });
  const accounts: readonly PublicWalletAccount[] = [
    { accountId: 'account-0', address: FROM },
  ];
  const engine = await createTransactionConstructionEngine(
    configured.registry,
    provider,
    accounts,
  );
  return { engine, registry: configured.registry, transport };
}

async function expectError(
  action: () => Promise<unknown>,
  code: TransactionConstructionError['code'],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return error instanceof TransactionConstructionError && error.code === code;
  });
}

test('constructs a valid native transfer with resolved nonce and gas', async () => {
  const { engine, transport } = await createEngine({ nonce: '0x7' });

  const preview = await engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: '0xde0b6b3a7640000',
  });

  assert.equal(preview.transactionType, 'native-transfer');
  assert.equal(preview.from, FROM_CHECKSUMMED);
  assert.equal(preview.to, TO);
  assert.equal(preview.value, 1_000_000_000_000_000_000n);
  assert.equal(preview.data, '0x');
  assert.equal(preview.hasCalldata, false);
  assert.equal(preview.nonce, 7n);
  assert.equal(preview.gasLimit, 21_000n);
  assert.equal(preview.feeModel, 'eip1559');
  assert.equal(preview.totalMaximumNativeAmount, 1_000_052_500_000_000_000n);
  assert.equal(transport.requests.some((request) =>
    JSON.parse(request.body).method === 'eth_sendRawTransaction'), false);
});

test('constructs a generic contract call without ABI decoding', async () => {
  const { engine } = await createEngine({ nonce: '0x1' });

  const preview = await engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    data: '0xAABB',
  });

  assert.equal(preview.transactionType, 'contract-call');
  assert.equal(preview.data, '0xaabb');
  assert.equal(preview.hasCalldata, true);
  assert.deepEqual(preview.warnings, [
    'Contract interaction: review the transaction details carefully.',
  ]);
});

test('rejects invalid sender and recipient addresses', async () => {
  const { engine } = await createEngine();

  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: 'not-an-address',
      to: TO,
      value: 0n,
    }),
    'INVALID_FROM_ADDRESS',
  );
  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: '0x123',
      value: 0n,
    }),
    'INVALID_RECIPIENT',
  );
});

test('rejects a sender that is not a known local public account', async () => {
  const { engine } = await createEngine();

  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: UNKNOWN,
      to: TO,
      value: 0n,
    }),
    'UNKNOWN_ACCOUNT',
  );
});

test('rejects negative, decimal, malformed, unsafe, NaN, and infinite values', async () => {
  const { engine } = await createEngine();
  const baseIntent = {
    networkId: 'ethereum',
    from: FROM,
    to: TO,
  };

  await expectError(
    () => engine.construct({ ...baseIntent, value: -1n }),
    'INVALID_VALUE',
  );
  await expectError(
    () => engine.construct({ ...baseIntent, value: '1.5' }),
    'INVALID_VALUE',
  );
  await expectError(
    () => engine.construct({ ...baseIntent, value: '0x' }),
    'INVALID_VALUE',
  );
  await expectError(
    () => engine.construct({
      ...baseIntent,
      value: Number.MAX_SAFE_INTEGER as unknown as bigint,
    }),
    'INVALID_VALUE',
  );
  await expectError(
    () => engine.construct({
      ...baseIntent,
      value: Number.NaN as unknown as bigint,
    }),
    'INVALID_VALUE',
  );
  await expectError(
    () => engine.construct({
      ...baseIntent,
      value: Number.POSITIVE_INFINITY as unknown as bigint,
    }),
    'INVALID_VALUE',
  );
});

test('accepts valid empty calldata and rejects malformed calldata', async () => {
  const { engine } = await createEngine();

  const preview = await engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    data: '0x',
  });
  assert.equal(preview.data, '0x');
  assert.equal(preview.transactionType, 'native-transfer');

  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
      data: '0x123',
    }),
    'INVALID_CALLDATA',
  );
});

test('uses an explicit nonce and gas limit exactly as supplied', async () => {
  const { engine, transport } = await createEngine();

  const preview = await engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    nonce: '0x2a',
    gasLimit: 50_000n,
    fee: { preference: 'legacy' },
  });

  assert.equal(preview.nonce, 42n);
  assert.equal(preview.gasLimit, 50_000n);
  assert.equal(preview.feeModel, 'legacy');
  assert.equal(preview.gasPrice, 1_000_000_000n);
  assert.equal(
    transport.requests.some((request) =>
      JSON.parse(request.body).method === 'eth_getTransactionCount',
    ),
    false,
  );
  assert.equal(
    transport.requests.some((request) =>
      JSON.parse(request.body).method === 'eth_estimateGas',
    ),
    false,
  );
});

test('rejects malformed, negative, and zero nonce or gas-limit inputs', async () => {
  const { engine } = await createEngine();
  const baseIntent = { networkId: 'ethereum', from: FROM, to: TO, value: 0n };

  await expectError(
    () => engine.construct({ ...baseIntent, nonce: '7' }),
    'INVALID_NONCE',
  );
  await expectError(
    () => engine.construct({ ...baseIntent, nonce: -1n }),
    'INVALID_NONCE',
  );
  await expectError(
    () => engine.construct({ ...baseIntent, gasLimit: 0n }),
    'INVALID_GAS_LIMIT',
  );
  await expectError(
    () => engine.construct({
      ...baseIntent,
      gasLimit: '21000',
    }),
    'INVALID_GAS_LIMIT',
  );
});

test('constructs explicit Legacy and EIP-1559 transactions with exact fee formulas', async () => {
  const legacy = await createEngine();
  const legacyPreview = await legacy.engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    gasLimit: 21_000n,
    fee: { preference: 'legacy' },
  });
  assert.equal(legacyPreview.feeModel, 'legacy');
  assert.equal(legacyPreview.gasPrice, 1_000_000_000n);
  assert.equal(legacyPreview.estimatedNetworkFee, 21_000_000_000_000n);

  const eip1559 = await createEngine();
  const eipPreview = await eip1559.engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    gasLimit: 21_000n,
    fee: { preference: 'eip1559' },
  });
  assert.equal(eipPreview.feeModel, 'eip1559');
  assert.equal(eipPreview.maxFeePerGas, 2_500_000_000n);
  assert.equal(eipPreview.maxPriorityFeePerGas, 1_500_000_000n);
  assert.equal(eipPreview.estimatedNetworkFee, 52_500_000_000_000n);
});

test('falls back to Legacy when EIP-1559 data is missing or unsupported', async () => {
  const missing = await createEngine({ baseFee: null });
  const missingPreview = await missing.engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    gasLimit: 21_000n,
  });
  assert.equal(missingPreview.feeModel, 'legacy');

  const unsupportedHandler = standardHandler();
  const unsupportedTransport = new FakeTransport((request) => {
    const body = JSON.parse(request.body) as { method: string };
    if (body.method === 'eth_maxPriorityFeePerGas') {
      return rpcError(request, -32601, 'method not found');
    }
    return unsupportedHandler.handler(request);
  });
  const unsupportedProvider = await createEvmRpcProvider(
    unsupportedHandler.registry,
    { transport: unsupportedTransport },
  );
  const unsupportedEngine = await createTransactionConstructionEngine(
    unsupportedHandler.registry,
    unsupportedProvider,
    [{ accountId: 'account-0', address: FROM }],
  );
  const unsupportedPreview = await unsupportedEngine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    gasLimit: 21_000n,
  });
  assert.equal(unsupportedPreview.feeModel, 'legacy');
});

test('reports explicit fee unavailability and unsupported fee preference', async () => {
  const unavailable = await createEngine({ baseFee: null, gasPrice: '0x0' });
  await expectError(
    () => unavailable.engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
      gasLimit: 21_000n,
    }),
    'FEE_UNAVAILABLE',
  );

  const unsupportedHandler = standardHandler();
  const transport = new FakeTransport((request) => {
    const body = JSON.parse(request.body) as { method: string };
    if (body.method === 'eth_maxPriorityFeePerGas') {
      return rpcError(request, -32601, 'method not found');
    }
    return unsupportedHandler.handler(request);
  });
  const provider = await createEvmRpcProvider(unsupportedHandler.registry, { transport });
  const engine = await createTransactionConstructionEngine(
    unsupportedHandler.registry,
    provider,
    [{ accountId: 'account-0', address: FROM }],
  );
  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
      gasLimit: 21_000n,
      fee: { preference: 'eip1559' },
    }),
    'UNSUPPORTED_FEE_MODEL',
  );
});

test('estimates gas only from public transaction fields and rejects zero estimates', async () => {
  const { engine, transport } = await createEngine({ gas: '0x0' });
  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 1n,
      data: '0x',
    }),
    'GAS_ESTIMATION_FAILED',
  );

  const estimation = await createEngine();
  await estimation.engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 1n,
    data: '0x',
  });
  const estimateRequest = estimation.transport.requests.find((request) =>
    JSON.parse(request.body).method === 'eth_estimateGas',
  );
  assert(estimateRequest);
  const estimateBody = JSON.parse(estimateRequest.body) as {
    params: unknown[];
  };
  assert.deepEqual(estimateBody.params[0], {
    from: FROM_CHECKSUMMED,
    to: TO,
    value: '0x1',
    data: '0x',
  });
  assert.equal(
    transport.requests.some((request) =>
      JSON.parse(request.body).method === 'eth_estimateGas',
    ),
    true,
  );
});

test('rejects network mismatches, unselected networks, disabled networks, and placeholders', async () => {
  const { engine, registry } = await createEngine();
  await expectError(
    () => engine.construct({
      networkId: 'base',
      from: FROM,
      to: TO,
      value: 0n,
    }),
    'NETWORK_MISMATCH',
  );

  registry.clearActiveNetwork();
  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
    }),
    'NETWORK_NOT_SELECTED',
  );

  const disabledNetwork: EvmNetwork = {
    ...(supportedNetworks.find((network) => network.id === 'base') as EvmNetwork),
    id: 'disabled',
    enabled: false,
  };
  const disabledRegistry = new NetworkRegistry([
    supportedNetworks.find((network) => network.id === 'primewave') as EvmNetwork,
    disabledNetwork,
  ]);
  assert.throws(
    () => disabledRegistry.selectActiveNetwork('disabled'),
    (error: unknown) =>
      error instanceof NetworkRegistryError && error.code === 'NETWORK_DISABLED',
  );

  const placeholderRegistry = new NetworkRegistry(supportedNetworks);
  assert.throws(
    () => placeholderRegistry.selectActiveNetwork('primewave'),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'NETWORK_NOT_CONFIGURED',
  );
});

test('rejects chain mismatch and active-network changes during construction', async () => {
  const mismatch = await createEngine({ chainIds: ['0x1', '0x2'] });
  await expectError(
    () => mismatch.engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
      gasLimit: 21_000n,
    }),
    'CHAIN_ID_MISMATCH',
  );

  const raced = await createEngine({
    onRequest: (method, registry) => {
      if (method === 'eth_getTransactionCount') {
        registry.selectActiveNetwork('base');
      }
    },
  });
  await expectError(
    () => raced.engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
    }),
    'NETWORK_CHANGED',
  );
});

test('normalizes RPC failures and never exposes raw provider messages', async () => {
  const configured = standardHandler();
  const transport = new FakeTransport((request) => {
    const body = JSON.parse(request.body) as { method: string };
    if (body.method === 'eth_getTransactionCount') {
      return rpcError(request, -32000, 'private key should never be surfaced');
    }
    return configured.handler(request);
  });
  const provider = await createEvmRpcProvider(configured.registry, { transport });
  const engine = await createTransactionConstructionEngine(
    configured.registry,
    provider,
    [{ accountId: 'account-0', address: FROM }],
  );
  await assert.rejects(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
    }),
    (error: unknown) => {
      assert(error instanceof TransactionConstructionError);
      assert.equal(error.message.includes('private key'), false);
      return error.code === 'CONSTRUCTION_FAILED';
    },
  );
});

test('produces deterministic bigint-safe unsigned representations and previews', async () => {
  const gas = '0x123456789012345678901234567890';
  const value = '0x987654321098765432109876543210';
  const first = await createEngine({ gas, nonce: '0x10' });
  const second = await createEngine({ gas, nonce: '0x10' });
  const intent = {
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value,
    data: '0xabcdef',
    fee: { preference: 'legacy' as const },
  };
  const firstPreview = await first.engine.construct(intent);
  const secondPreview = await second.engine.construct(intent);

  assert.equal(
    firstPreview.unsignedTransaction.canonicalRepresentation,
    secondPreview.unsignedTransaction.canonicalRepresentation,
  );
  assert.equal(
    serializeUnsignedTransaction(firstPreview.unsignedTransaction),
    firstPreview.unsignedTransaction.canonicalRepresentation,
  );
  assert.equal(
    firstPreview.unsignedTransaction.canonicalRepresentation.includes(
      'privateKey',
    ),
    false,
  );
  assert.equal(typeof firstPreview.unsignedTransaction.value, 'bigint');
  assert.equal(typeof firstPreview.unsignedTransaction.gasLimit, 'bigint');
});

test('has no signing, broadcasting, persistence, or secret-access capability', async () => {
  const { engine, transport } = await createEngine();
  const methods = Object.getOwnPropertyNames(TransactionConstructionEngine.prototype);
  assert.equal(methods.includes('sign'), false);
  assert.equal(methods.includes('broadcast'), false);
  assert.equal(methods.includes('save'), false);
  assert.equal(methods.includes('persist'), false);
  assert.equal(
    transport.requests.some((request) =>
      JSON.parse(request.body).method === 'eth_sendRawTransaction',
    ),
    false,
  );

  const preview = await engine.construct({
    networkId: 'ethereum',
    from: FROM,
    to: TO,
    value: 0n,
    gasLimit: 21_000n,
  });
  const serialized = JSON.stringify(preview, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  assert.equal(serialized.includes('mnemonic'), false);
  assert.equal(serialized.includes('privateKey'), false);
  assert.equal(serialized.includes('SecureStore'), false);
  assert.equal(serialized.includes('signingCapability'), false);
});

test('supports concurrent construction without shared nonce or network state', async () => {
  const configured = standardHandler({ nonce: '0x3' });
  const transport = new FakeTransport(async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return configured.handler(request);
  });
  const provider = await createEvmRpcProvider(configured.registry, { transport });
  const engine = await createTransactionConstructionEngine(
    configured.registry,
    provider,
    [{ accountId: 'account-0', address: FROM }],
  );
  const [first, second] = await Promise.all([
    engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 1n,
      gasLimit: 21_000n,
      fee: { preference: 'legacy' },
    }),
    engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 2n,
      gasLimit: 21_000n,
      fee: { preference: 'legacy' },
    }),
  ]);
  assert.equal(first.nonce, 3n);
  assert.equal(second.nonce, 3n);
  assert.notEqual(first.value, second.value);
});

test('maps RPC timeouts during nonce resolution safely', async () => {
  const configured = standardHandler();
  const transport = new FakeTransport((request) => {
    const body = JSON.parse(request.body) as { method: string };
    if (body.method === 'eth_getTransactionCount') {
      return new Promise<RpcTransportResponse>(() => {});
    }
    return configured.handler(request);
  });
  const provider = await createEvmRpcProvider(configured.registry, {
    transport,
    timeoutMs: 5,
  });
  const engine = await createTransactionConstructionEngine(
    configured.registry,
    provider,
    [{ accountId: 'account-0', address: FROM }],
  );
  await expectError(
    () => engine.construct({
      networkId: 'ethereum',
      from: FROM,
      to: TO,
      value: 0n,
    }),
    'RPC_TIMEOUT',
  );
});