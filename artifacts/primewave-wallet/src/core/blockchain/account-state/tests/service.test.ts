import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountStateError,
  EvmAccountStateService,
  createEvmAccountStateService,
} from '../index';
import {
  createEvmRpcProvider,
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

function createRegistry(
  includeBase = false,
): NetworkRegistry {
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

async function createService(
  responses: FakeResponse[],
  options: { timeoutMs?: number; includeBase?: boolean } = {},
): Promise<{
  service: EvmAccountStateService;
  registry: NetworkRegistry;
  transport: FakeTransport;
}> {
  const registry = createRegistry(options.includeBase);
  const transport = new FakeTransport(responses);
  const provider = await createEvmRpcProvider(registry, {
    transport,
    timeoutMs: options.timeoutMs,
  });
  const service = new EvmAccountStateService(registry, provider, {
    now: () => 1_700_000_000_000,
  });
  return { service, registry, transport };
}

async function expectAccountError(
  callback: () => Promise<unknown>,
  code: AccountStateError['code'],
): Promise<void> {
  await assert.rejects(callback, (error: unknown) => {
    return error instanceof AccountStateError && error.code === code;
  });
}

async function expectAsyncAccountError(
  callback: () => Promise<unknown>,
  code: AccountStateError['code'],
): Promise<void> {
  await assert.rejects(callback, (error: unknown) => {
    return error instanceof AccountStateError && error.code === code;
  });
}

const ADDRESS_LOWERCASE =
  '0x52908400098527886e0f7030069857d2e4169ee7';
const ADDRESS_CHECKSUMMED =
  '0x52908400098527886E0F7030069857D2E4169EE7';

test('validates and normalizes public addresses without querying secrets', async () => {
  const { service, transport } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x0'),
  ]);

  await expectAccountError(
    () => service.getNativeBalance('not-an-address'),
    'INVALID_ADDRESS',
  );
  await expectAccountError(
    () => service.getNativeBalance('0x123'),
    'INVALID_ADDRESS',
  );
  assert.equal(transport.requests.length, 1);

  const valid = await service.getNativeBalance(ADDRESS_LOWERCASE);
  assert.equal(valid.address, ADDRESS_CHECKSUMMED);
});

test('retrieves zero and very large native balances losslessly', async () => {
  const largeBalance = 123456789012345678901234567890n;
  const { service } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x0'),
    jsonResponse(4, '0x1'),
    jsonResponse(5, `0x${largeBalance.toString(16)}`),
  ]);

  const zero = await service.getNativeBalance(ADDRESS_LOWERCASE);
  assert.equal(zero.raw, 0n);
  assert.equal(zero.display, '0');
  assert.equal(zero.symbol, 'ETH');
  assert.equal(zero.decimals, 18);

  const large = await service.getNativeBalance(ADDRESS_LOWERCASE);
  assert.equal(large.raw, largeBalance);
  assert.equal(large.display, '123456789012.34567890123456789');
});

test('retrieves chain state, nonce, contract code, and latest block with bigint values', async () => {
  const { service } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x123456789abcdef'),
    jsonResponse(4, '0x1'),
    jsonResponse(5, '0x2a'),
    jsonResponse(6, '0x1'),
    jsonResponse(7, '0x5208'),
    jsonResponse(8, '0x1'),
    jsonResponse(9, '0x2a'),
    jsonResponse(10, {
      number: '0x2a',
      hash: '0xblockhash',
      timestamp: '0x65',
    }),
  ]);

  const chain = await service.getChainState();
  assert.equal(chain.chainId, 1n);
  assert.equal(chain.latestBlockNumber, 0x123456789abcdefn);

  const nonce = await service.getNonce(ADDRESS_LOWERCASE);
  assert.equal(nonce.value, 0x2an);

  const contract = await service.getContractCode(ADDRESS_LOWERCASE);
  assert.equal(contract.kind, 'contract');
  assert.equal(contract.hasCode, true);
  assert.equal(contract.code, '0x5208');

  const block = await service.getLatestBlock();
  assert.deepEqual(block, {
    number: 0x2an,
    hash: '0xblockhash',
    timestamp: 0x65n,
  });
});

test('classifies no-code accounts without claiming ownership', async () => {
  const { service } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x'),
  ]);

  const code = await service.getContractCode(ADDRESS_LOWERCASE);
  assert.equal(code.kind, 'externally-owned-account');
  assert.equal(code.hasCode, false);
  assert.equal(code.code, '0x');
});

test('builds a coherent non-persistent snapshot at one block context', async () => {
  const largeBalance = 1234567890000000001n;
  const { service, transport } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x2a'),
    jsonResponse(4, `0x${largeBalance.toString(16)}`),
    jsonResponse(5, '0x7'),
    jsonResponse(6, '0x'),
    jsonResponse(7, {
      number: '0x2a',
      hash: '0xblockhash',
      timestamp: '0x65',
    }),
    jsonResponse(8, '0x1'),
    jsonResponse(9, '0x2b'),
    jsonResponse(10, '0x2'),
    jsonResponse(11, '0x8'),
    jsonResponse(12, '0x'),
    jsonResponse(13, {
      number: '0x2b',
      hash: '0xnextblockhash',
      timestamp: '0x66',
    }),
  ]);

  const snapshot = await service.getSnapshot(ADDRESS_LOWERCASE);
  assert.equal(snapshot.address, ADDRESS_CHECKSUMMED);
  assert.equal(snapshot.networkId, 'ethereum');
  assert.equal(snapshot.chainId, 1n);
  assert.equal(snapshot.nativeBalance.raw, largeBalance);
  assert.equal(snapshot.nativeBalance.display, '1.234567890000000001');
  assert.equal(snapshot.nonce, 7n);
  assert.equal(snapshot.code.kind, 'externally-owned-account');
  assert.equal(snapshot.latestBlock?.number, 42n);
  assert.equal(snapshot.latestBlock?.hash, '0xblockhash');
  assert.equal(snapshot.retrievedAtMs, 1_700_000_000_000);

  const snapshotBlockTag = JSON.parse(transport.requests[3].body).params[1];
  assert.equal(snapshotBlockTag, '0x2a');
  assert.equal(transport.requests.length, 7);

  const refreshed = await service.refresh(ADDRESS_LOWERCASE);
  assert.equal(refreshed.networkId, 'ethereum');
  assert.equal(transport.requests.length, 13);
});

test('rejects stale results if the selected network changes during a read', async () => {
  let registry: NetworkRegistry;
  const transport = new FakeTransport([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    () => {
      registry.selectActiveNetwork('base');
      return jsonResponse(3, '0x2a');
    },
  ]);
  registry = createRegistry(true);
  const provider = await createEvmRpcProvider(registry, { transport });
  const service = new EvmAccountStateService(registry, provider);

  await expectAsyncAccountError(
    () => service.getSnapshot(ADDRESS_LOWERCASE),
    'NETWORK_CHANGED',
  );
  assert.equal(transport.requests.length, 3);
});

test('propagates normalized provider timeout and chain mismatch errors', async () => {
  const timeout = await createService(
    [
      jsonResponse(1, '0x1'),
      () => new Promise<RpcTransportResponse>(() => {}),
    ],
    { timeoutMs: 5 },
  );
  await assert.rejects(
    () => timeout.service.getChainState(),
    (error: unknown) =>
      error instanceof RpcProviderError && error.code === 'TIMEOUT',
  );

  const mismatch = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x38'),
  ]);
  await assert.rejects(
    () => mismatch.service.getChainState(),
    (error: unknown) =>
      error instanceof RpcProviderError && error.code === 'CHAIN_ID_MISMATCH',
  );
});

test('supports concurrent account reads without shared snapshot state', async () => {
  const { service, transport } = await createService([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x1'),
    jsonResponse(4, '0x0'),
    jsonResponse(5, '0x1'),
  ]);

  const [first, second] = await Promise.all([
    service.getNativeBalance(ADDRESS_LOWERCASE),
    service.getNativeBalance('0x1111111111111111111111111111111111111111'),
  ]);
  assert.equal(first.raw, 0n);
  assert.equal(second.raw, 1n);
  assert.equal(transport.requests.length, 5);
});

test('refuses the unconfigured PrimeWave placeholder before account reads', () => {
  const registry = new NetworkRegistry(supportedNetworks);
  assert.throws(
    () => registry.selectActiveNetwork('primewave'),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'NETWORK_NOT_CONFIGURED',
  );
});