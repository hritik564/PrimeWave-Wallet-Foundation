import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetError,
  AssetRegistry,
  NativeAssetBalanceService,
  createAssetIdentity,
  formatAssetAmount,
  getAssetIdentityKey,
  parseAssetAmount,
  type AssetAvailabilityStatus,
} from '../index';
import {
  EvmAccountStateService,
} from '@/src/core/blockchain/account-state';
import {
  createEvmRpcProvider,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import {
  NetworkRegistry,
  supportedNetworks,
} from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

const ADDRESS =
  '0x52908400098527886e0f7030069857d2e4169ee7';
const CHECKSUMMED_ADDRESS =
  '0x52908400098527886E0F7030069857D2E4169EE7';

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

function network(id: string): EvmNetwork {
  return supportedNetworks.find((candidate) => candidate.id === id) as EvmNetwork;
}

function createRegistry(activeNetworkId = 'ethereum'): NetworkRegistry {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(activeNetworkId);
  return registry;
}

async function createBalanceFixture(
  responses: FakeResponse[],
  options: {
    networkId?: string;
    now?: () => number;
  } = {},
): Promise<{
  assets: AssetRegistry;
  balanceService: NativeAssetBalanceService;
  accountState: EvmAccountStateService;
  registry: NetworkRegistry;
  transport: FakeTransport;
}> {
  const networkId = options.networkId ?? 'ethereum';
  const registry = createRegistry(networkId);
  const transport = new FakeTransport(responses);
  const provider = await createEvmRpcProvider(registry, { transport });
  const accountState = new EvmAccountStateService(registry, provider);
  const assets = new AssetRegistry(createRegistry());
  const balanceService = new NativeAssetBalanceService(
    assets,
    [{ service: accountState }],
    { now: options.now ?? (() => 1_700_000_000_000) },
  );
  return { assets, balanceService, accountState, registry, transport };
}

async function expectAssetError(
  callback: () => unknown | Promise<unknown>,
  code: AssetError['code'],
): Promise<void> {
  await assert.rejects(async () => callback(), (error: unknown) => {
    return error instanceof AssetError && error.code === code;
  });
}

test('resolves configured native assets from network metadata', () => {
  const assets = new AssetRegistry(createRegistry());
  const expected: Record<string, [number, string, number]> = {
    ethereum: [1, 'ETH', 18],
    'bnb-smart-chain': [56, 'BNB', 18],
    polygon: [137, 'POL', 18],
    arbitrum: [42161, 'ETH', 18],
    base: [8453, 'ETH', 18],
    optimism: [10, 'ETH', 18],
  };

  for (const [networkId, [chainId, symbol, decimals]] of Object.entries(
    expected,
  )) {
    const asset = assets.resolveNativeAsset(networkId);
    assert.equal(asset.assetType, 'native');
    assert.equal(asset.assetId, 'native');
    assert.equal(asset.networkId, networkId);
    assert.equal(asset.chainId, chainId);
    assert.equal(asset.symbol, symbol);
    assert.equal(asset.decimals, decimals);
    assert.equal(asset.status, 'available');
  }
});

test('keeps native identity network-scoped and rejects unsupported asset types', async () => {
  const ethereum = createAssetIdentity('native', 'ethereum', 'native');
  const base = createAssetIdentity('native', 'base', 'native');
  assert.notEqual(getAssetIdentityKey(ethereum), getAssetIdentityKey(base));

  const assets = new AssetRegistry(createRegistry());
  await expectAssetError(
    () =>
      assets.resolveAsset(
        createAssetIdentity('fungible_token', 'ethereum', 'native'),
      ),
    'ASSET_UNSUPPORTED',
  );
});

test('reports unsupported, disabled, and unconfigured network asset states', () => {
  const disabledBase = { ...network('base'), enabled: false };
  const registry = new NetworkRegistry([
    network('primewave'),
    network('ethereum'),
    disabledBase,
  ]);
  const assets = new AssetRegistry(registry);

  const statuses: Record<string, AssetAvailabilityStatus> = {
    unknown: 'unsupported',
    primewave: 'unconfigured',
    base: 'disabled',
    ethereum: 'available',
  };
  for (const [networkId, status] of Object.entries(statuses)) {
    assert.equal(assets.getNativeAssetStatus(networkId).status, status);
  }
  assert.throws(
    () => assets.resolveNativeAsset('primewave'),
    (error: unknown) =>
      error instanceof AssetError &&
      error.code === 'ASSET_NETWORK_NOT_CONFIGURED',
  );
  assert.throws(
    () => assets.resolveNativeAsset('base'),
    (error: unknown) =>
      error instanceof AssetError &&
      error.code === 'ASSET_NETWORK_DISABLED',
  );
});

test('formats exact bigint amounts without floating-point arithmetic', () => {
  assert.equal(formatAssetAmount(0n, 18), '0');
  assert.equal(formatAssetAmount(1_000_000_000_000_000_000n, 18), '1');
  assert.equal(formatAssetAmount(1_500_000_000_000_000_000n, 18), '1.5');
  assert.equal(formatAssetAmount(1n, 18), '0.000000000000000001');
  assert.equal(formatAssetAmount(1_000_000_000_000_000_010n, 18), '1.00000000000000001');
  assert.equal(
    formatAssetAmount(123456789012345678901234567890n, 18),
    '123456789012.34567890123456789',
  );
  assert.equal(formatAssetAmount(123n, 0), '123');
});

test('parses exact decimal amounts and rejects unsafe grammar', async () => {
  assert.equal(parseAssetAmount('1', 18), 1_000_000_000_000_000_000n);
  assert.equal(parseAssetAmount('1.5', 18), 1_500_000_000_000_000_000n);
  assert.equal(parseAssetAmount('0.000000000000000001', 18), 1n);
  assert.equal(parseAssetAmount('0', 18), 0n);
  assert.equal(parseAssetAmount('1.000000000000000000', 18), 1_000_000_000_000_000_000n);

  for (const input of [
    '',
    ' ',
    ' 1',
    '1 ',
    '-1',
    '+1',
    '1e18',
    'NaN',
    'Infinity',
    '01.5',
    '1.',
    '0.0000000000000000001',
  ]) {
    await expectAssetError(() => parseAssetAmount(input, 18), input.includes('0000000000000000001') ? 'DECIMAL_OVERFLOW' : 'MALFORMED_AMOUNT');
  }
  await expectAssetError(() => parseAssetAmount('1', 37), 'ASSET_INVALID_METADATA');
  await expectAssetError(() => formatAssetAmount(-1n, 18), 'INVALID_AMOUNT');
});

test('retrieves a network-scoped native balance through account state', async () => {
  const rawBalance = 123456789012345678901234567890n;
  const fixture = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, `0x${rawBalance.toString(16)}`),
  ]);

  const result = await fixture.balanceService.getBalance({
    networkId: 'ethereum',
    accountId: 'account-7',
    address: ADDRESS,
  });

  assert.equal(result.kind, 'native-asset-balance');
  assert.equal(result.assetIdentity.networkId, 'ethereum');
  assert.equal(result.accountId, 'account-7');
  assert.equal(result.address, CHECKSUMMED_ADDRESS);
  assert.equal(result.chainId, 1n);
  assert.equal(result.rawBalance, rawBalance);
  assert.equal(result.displayAmount, '123456789012.34567890123456789');
  assert.equal(result.blockNumber, null);
  assert.equal(result.retrievedAtMs, 1_700_000_000_000);
  assert.deepEqual(
    fixture.transport.requests.map((request) => JSON.parse(request.body).method),
    ['eth_chainId', 'eth_chainId', 'eth_getBalance'],
  );
});

test('preserves zero balances and rejects invalid public addresses before RPC balance reads', async () => {
  const fixture = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x0'),
  ]);
  const result = await fixture.balanceService.getBalance({
    networkId: 'ethereum',
    accountId: 'account-0',
    address: ADDRESS,
  });
  assert.equal(result.rawBalance, 0n);
  assert.equal(result.displayAmount, '0');

  await expectAssetError(
    () =>
      fixture.balanceService.getBalance({
        networkId: 'ethereum',
        accountId: 'account-0',
        address: 'not-an-address',
      }),
    'BALANCE_INVALID_ADDRESS',
  );
  assert.equal(fixture.transport.requests.length, 3);
});

test('keeps balances separate for the same address on multiple networks', async () => {
  const ethereum = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x1'),
  ]);
  const bnbRegistry = new NetworkRegistry([
    network('primewave'),
    network('bnb-smart-chain'),
  ]);
  bnbRegistry.selectActiveNetwork('bnb-smart-chain');
  const bnbTransport = new FakeTransport([
    jsonResponse(1, '0x38'),
    jsonResponse(2, '0x38'),
    jsonResponse(3, '0x2'),
  ]);
  const bnbProvider = await createEvmRpcProvider(bnbRegistry, {
    transport: bnbTransport,
  });
  const bnbAccountState = new EvmAccountStateService(bnbRegistry, bnbProvider);
  const service = new NativeAssetBalanceService(
    ethereum.assets,
    [{ service: ethereum.accountState }, { service: bnbAccountState }],
  );

  const [ethBalance, bnbBalance] = await Promise.all([
    service.getBalance({ networkId: 'ethereum', accountId: 'a', address: ADDRESS }),
    service.getBalance({
      networkId: 'bnb-smart-chain',
      accountId: 'a',
      address: ADDRESS,
    }),
  ]);
  assert.equal(ethBalance.rawBalance, 1n);
  assert.equal(bnbBalance.rawBalance, 2n);
  assert.equal(ethBalance.assetIdentity.networkId, 'ethereum');
  assert.equal(bnbBalance.assetIdentity.networkId, 'bnb-smart-chain');
  assert.notEqual(
    getAssetIdentityKey(ethBalance.assetIdentity),
    getAssetIdentityKey(bnbBalance.assetIdentity),
  );
});

test('rejects a missing network service instead of switching or using another network', async () => {
  const fixture = await createBalanceFixture([
    jsonResponse(1, '0x1'),
  ]);
  await expectAssetError(
    () =>
      fixture.balanceService.getBalance({
        networkId: 'base',
        accountId: 'account-0',
        address: ADDRESS,
      }),
    'BALANCE_NETWORK_UNAVAILABLE',
  );
  assert.equal(fixture.transport.requests.length, 1);
});

test('normalizes network changes, chain mismatches, and provider failures', async () => {
  let registry!: NetworkRegistry;
  const transport = new FakeTransport([
    jsonResponse(1, '0x1'),
    () => {
      registry.selectActiveNetwork('base');
      return jsonResponse(2, '0x1');
    },
  ]);
  registry = new NetworkRegistry([
    network('primewave'),
    network('ethereum'),
    network('base'),
  ]);
  registry.selectActiveNetwork('ethereum');
  const provider = await createEvmRpcProvider(registry, { transport });
  const accountState = new EvmAccountStateService(registry, provider);
  const service = new NativeAssetBalanceService(
    new AssetRegistry(createRegistry()),
    [{ service: accountState }],
  );
  await expectAssetError(
    () =>
      service.getBalance({
        networkId: 'ethereum',
        accountId: 'account-0',
        address: ADDRESS,
      }),
    'BALANCE_NETWORK_CHANGED',
  );

  const mismatch = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x38'),
  ]);
  await expectAssetError(
    () =>
      mismatch.balanceService.getBalance({
        networkId: 'ethereum',
        accountId: 'account-0',
        address: ADDRESS,
      }),
    'BALANCE_CHAIN_MISMATCH',
  );

  const failed = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    new Error('private key should never appear'),
  ]);
  await assert.rejects(
    () =>
      failed.balanceService.getBalance({
        networkId: 'ethereum',
        accountId: 'account-0',
        address: ADDRESS,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AssetError);
      assert.equal(error.code, 'BALANCE_NETWORK_UNAVAILABLE');
      assert.equal(error.message.includes('private key'), false);
      return true;
    },
  );
});

test('does not expose secrets, persist balances, call token methods, sign, or broadcast', async () => {
  const fixture = await createBalanceFixture([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1'),
    jsonResponse(3, '0x1'),
  ]);
  const result = await fixture.balanceService.getBalance({
    networkId: 'ethereum',
    accountId: 'account-0',
    address: ADDRESS,
  });
  const serialized = JSON.stringify(result, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  assert.equal(serialized.includes('privateKey'), false);
  assert.equal(serialized.includes('mnemonic'), false);
  assert.equal(serialized.includes('vault'), false);
  const methods = fixture.transport.requests.map((request) =>
    JSON.parse(request.body).method,
  );
  assert.deepEqual(methods, ['eth_chainId', 'eth_chainId', 'eth_getBalance']);
  assert.equal(methods.includes('eth_sendRawTransaction'), false);
  assert.equal(methods.some((method) => method === 'balanceOf'), false);
  assert.equal(methods.some((method) => method === 'decimals'), false);
  assert.equal(methods.some((method) => method === 'symbol'), false);
  assert.equal(methods.some((method) => method === 'name'), false);
});