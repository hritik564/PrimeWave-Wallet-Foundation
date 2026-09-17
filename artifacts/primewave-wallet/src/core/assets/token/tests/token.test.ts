import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetError,
  AssetRegistry,
  ERC20_READ_ABI,
  ERC20TokenService,
  TokenRegistry,
  createTokenAssetIdentity,
  formatAssetAmount,
  getAssetIdentityKey,
  type ERC20Token,
} from '../../index';
import {
  EvmAccountStateService,
  normalizePublicEvmAddress,
} from '@/src/core/blockchain/account-state';
import {
  createEvmRpcProvider,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import { encodeAbiParameters, encodeFunctionData, stringToHex } from 'viem';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

const ACCOUNT =
  '0x52908400098527886e0f7030069857d2e4169ee7';
const CONTRACT =
  '0x1111111111111111111111111111111111111111';
const CHECKSUMMED_CONTRACT =
  '0x1111111111111111111111111111111111111111';

function network(id: string): EvmNetwork {
  return supportedNetworks.find((candidate) => candidate.id === id) as EvmNetwork;
}

function createRegistry(activeNetworkId = 'ethereum'): NetworkRegistry {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(activeNetworkId);
  return registry;
}

function responseFor(id: number | string, result: unknown): RpcTransportResponse {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function rpcErrorFor(
  id: number | string,
  code = 3,
): RpcTransportResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message: 'execution reverted: secret data must not leak' },
    },
  };
}

type Handler = (
  method: string,
  params: unknown[],
  id: number | string,
) => RpcTransportResponse | Error | Promise<RpcTransportResponse | Error>;

class FakeTransport implements RpcTransport {
  readonly requests: RpcTransportRequest[] = [];

  constructor(private readonly handler: Handler) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    this.requests.push(request);
    const body = JSON.parse(request.body) as {
      id: number | string;
      method: string;
      params: unknown[];
    };
    const response = await this.handler(body.method, body.params, body.id);
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

function selectorData(
  functionName: 'name' | 'symbol' | 'decimals' | 'balanceOf',
  accountAddress = ACCOUNT,
): string {
  return encodeFunctionData({
    abi: ERC20_READ_ABI,
    functionName,
    args: functionName === 'balanceOf'
      ? [normalizePublicEvmAddress(accountAddress) as `0x${string}`]
      : undefined,
  });
}

function encodeString(value: string): `0x${string}` {
  return encodeAbiParameters([{ type: 'string' }], [value]);
}

function encodeUint(value: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

function encodeBytes32String(value: string): `0x${string}` {
  return stringToHex(value, { size: 32 });
}

function createTokenFixture(
  handler: Handler,
  options: { now?: () => number; networkId?: string } = {},
): Promise<{
  registry: NetworkRegistry;
  assets: AssetRegistry;
  service: ERC20TokenService;
  accountState: EvmAccountStateService;
  provider: Awaited<ReturnType<typeof createEvmRpcProvider>>;
  transport: FakeTransport;
}> {
  const networkId = options.networkId ?? 'ethereum';
  const registry = createRegistry(networkId);
  const transport = new FakeTransport(handler);
  return createEvmRpcProvider(registry, { transport }).then((provider) => {
    const accountState = new EvmAccountStateService(registry, provider);
    const assets = new AssetRegistry(createRegistry());
    const service = new ERC20TokenService(
      assets,
      [{ accountState, provider }],
      { now: options.now ?? (() => 1_700_000_000_000) },
    );
    return { registry, assets, service, accountState, provider, transport };
  });
}

async function expectAssetError(
  callback: () => unknown | Promise<unknown>,
  code: AssetError['code'],
): Promise<void> {
  await assert.rejects(async () => callback(), (error: unknown) => {
    return error instanceof AssetError && error.code === code;
  });
}

function standardToken(): ERC20Token {
  const identity = createTokenAssetIdentity('ethereum', CONTRACT);
  return {
    ...identity,
    chainId: 1,
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    metadataStatus: 'complete',
    verificationStatus: 'unknown',
    availabilityStatus: 'available',
  };
}

test('normalizes token identity by network and contract, not symbol or name', () => {
  const ethereum = createTokenAssetIdentity('ethereum', CONTRACT.toLowerCase());
  const base = createTokenAssetIdentity('base', CONTRACT.toLowerCase());
  assert.equal(ethereum.assetType, 'fungible_token');
  assert.equal(ethereum.contractAddress, CHECKSUMMED_CONTRACT);
  assert.notEqual(getAssetIdentityKey(ethereum), getAssetIdentityKey(base));

  const registry = new TokenRegistry(new AssetRegistry(createRegistry()));
  assert.equal(
    registry.resolveIdentity('ethereum', CONTRACT).assetId,
    CHECKSUMMED_CONTRACT,
  );
  assert.throws(
    () => registry.resolveIdentity('ethereum', 'not-an-address'),
    (error: unknown) =>
      error instanceof AssetError && error.code === 'TOKEN_INVALID_ADDRESS',
  );
});

test('rejects unknown, disabled, and placeholder networks before contract reads', async () => {
  const disabledBase = { ...network('base'), enabled: false };
  const registry = new NetworkRegistry([
    network('primewave'),
    network('ethereum'),
    disabledBase,
  ]);
  const assets = new AssetRegistry(registry);
  const tokenRegistry = new TokenRegistry(assets);
  for (const networkId of ['unknown', 'primewave', 'base']) {
    assert.throws(
      () => tokenRegistry.resolveIdentity(networkId, CONTRACT),
      (error: unknown) =>
        error instanceof AssetError &&
        error.code === 'TOKEN_NETWORK_UNAVAILABLE',
    );
  }

  const fixture = await createTokenFixture(async (method, _, id) => {
    assert.notEqual(method, 'eth_getCode');
    assert.notEqual(method, 'eth_call');
    return responseFor(id, '0x1');
  });
  await expectAssetError(
    () =>
      fixture.service.getTokenMetadata({
        networkId: 'primewave',
        contractAddress: CONTRACT,
      }),
    'TOKEN_NETWORK_UNAVAILABLE',
  );
  assert.equal(fixture.transport.requests.length, 1);
});

test('rejects a syntactically valid EOA as a token contract', async () => {
  const fixture = await createTokenFixture((method, _, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x');
    throw new Error('metadata should not be requested');
  });
  await expectAssetError(
    () =>
      fixture.service.getTokenMetadata({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
      }),
    'TOKEN_NOT_A_CONTRACT',
  );
  assert.deepEqual(
    fixture.transport.requests.map((request) => JSON.parse(request.body).method),
    ['eth_chainId', 'eth_chainId', 'eth_getCode'],
  );
});

test('retrieves standard metadata with safe unknown verification status', async () => {
  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data === selectorData('name')) return responseFor(id, encodeString('USD Coin'));
      if (data === selectorData('symbol')) return responseFor(id, encodeString('USDC'));
      if (data === selectorData('decimals')) return responseFor(id, encodeUint(6n));
    }
    throw new Error('unexpected RPC method');
  });

  const token = await fixture.service.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT.toLowerCase(),
  });
  assert.equal(token.contractAddress, CHECKSUMMED_CONTRACT);
  assert.equal(token.name, 'USD Coin');
  assert.equal(token.symbol, 'USDC');
  assert.equal(token.decimals, 6);
  assert.equal(token.metadataStatus, 'complete');
  assert.equal(token.verificationStatus, 'unknown');
  assert.equal(token.availabilityStatus, 'available');
});

test('supports legacy bytes32 text and preserves partial metadata status', async () => {
  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    const data = (params[0] as { data: string }).data;
    if (data === selectorData('name')) return responseFor(id, encodeString('Legacy Token'));
    if (data === selectorData('symbol')) return responseFor(id, encodeBytes32String('LTK'));
    if (data === selectorData('decimals')) return rpcErrorFor(id);
    throw new Error('unexpected RPC method');
  });

  const token = await fixture.service.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
  });
  assert.equal(token.name, 'Legacy Token');
  assert.equal(token.symbol, 'LTK');
  assert.equal(token.decimals, null);
  assert.equal(token.metadataStatus, 'partial');
});

test('marks malformed and out-of-range metadata invalid without fabricating values', async () => {
  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    const data = (params[0] as { data: string }).data;
    if (data === selectorData('name')) return responseFor(id, '0x1234');
    if (data === selectorData('symbol')) return responseFor(id, encodeString('SYM'));
    if (data === selectorData('decimals')) return responseFor(id, encodeUint(37n));
    throw new Error('unexpected RPC method');
  });
  const token = await fixture.service.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
  });
  assert.equal(token.name, null);
  assert.equal(token.symbol, 'SYM');
  assert.equal(token.decimals, null);
  assert.equal(token.metadataStatus, 'invalid');
});

test('returns unavailable metadata for reverted reads and requires decimals for balances', async () => {
  const fixture = await createTokenFixture((method, _, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    if (method === 'eth_call') return rpcErrorFor(id);
    throw new Error('unexpected RPC method');
  });
  const token = await fixture.service.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
  });
  assert.equal(token.metadataStatus, 'unavailable');
  await expectAssetError(
    () =>
      fixture.service.getTokenBalance({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
        accountId: 'account-0',
        accountAddress: ACCOUNT,
        token,
      }),
    'TOKEN_METADATA_UNAVAILABLE',
  );
});

test('retrieves exact token balances using balanceOf and token decimals', async () => {
  const raw = 123456789012345678901234567890n;
  const token = standardToken();
  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data === selectorData('balanceOf')) return responseFor(id, encodeUint(raw));
    }
    throw new Error('unexpected RPC method');
  });
  const balance = await fixture.service.getTokenBalance({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
    accountId: 'account-7',
    accountAddress: ACCOUNT,
    token,
  });
  assert.equal(balance.rawBalance, raw);
  assert.equal(balance.decimals, 6);
  assert.equal(
    balance.displayAmount,
    '123456789012345678901234.56789',
  );
  assert.equal(balance.accountAddress, normalizePublicEvmAddress(ACCOUNT));
  assert.equal(balance.retrievedAtMs, 1_700_000_000_000);
  assert.equal(balance.blockNumber, null);
  assert.deepEqual(
    fixture.transport.requests.map((request) => JSON.parse(request.body).method),
    ['eth_chainId', 'eth_call'],
  );
});

test('formats zero and tiny token balances according to token decimals', async () => {
  const token = { ...standardToken(), decimals: 6 };
  assert.equal(formatAssetAmount(0n, token.decimals), '0');
  assert.equal(formatAssetAmount(1n, token.decimals), '0.000001');
  assert.equal(formatAssetAmount(1_500_000n, token.decimals), '1.5');

  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_call') return responseFor(id, encodeUint(0n));
    throw new Error('unexpected RPC method');
  });
  const balance = await fixture.service.getTokenBalance({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    token,
  });
  assert.equal(balance.displayAmount, '0');
});

test('supports multiple accounts and keeps the same contract separate across networks', async () => {
  const token = standardToken();
  const eth = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    const data = (params[0] as { data: string }).data;
    if (data === selectorData('balanceOf', ACCOUNT)) return responseFor(id, encodeUint(1n));
    return responseFor(id, encodeUint(2n));
  });
  const base = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x2105');
    const data = (params[0] as { data: string }).data;
    if (data === selectorData('balanceOf', ACCOUNT)) return responseFor(id, encodeUint(3n));
    return responseFor(id, encodeUint(4n));
  }, { networkId: 'base' });
  const service = new ERC20TokenService(
    eth.assets,
    [
      { accountState: eth.accountState, provider: eth.provider },
      { accountState: base.accountState, provider: base.provider },
    ],
  );

  const first = await service.getTokenBalance({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    token,
  });
  const second = await service.getTokenBalance({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
    accountId: 'account-1',
    accountAddress: '0x1111111111111111111111111111111111111111',
    token,
  });
  const baseToken = { ...token, ...createTokenAssetIdentity('base', CONTRACT), chainId: 8453 };
  const third = await service.getTokenBalance({
    networkId: 'base',
    contractAddress: CONTRACT,
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    token: baseToken,
  });
  assert.equal(first.rawBalance, 1n);
  assert.equal(second.rawBalance, 2n);
  assert.equal(third.rawBalance, 3n);
  assert.notEqual(getAssetIdentityKey(first.assetIdentity), getAssetIdentityKey(third.assetIdentity));
});

test('normalizes network changes, chain mismatches, RPC failures, and bad balance calls', async () => {
  let registry!: NetworkRegistry;
  const fixture = await createTokenFixture((method, _, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') {
      registry.selectActiveNetwork('base');
      return responseFor(id, '0x6001');
    }
    throw new Error('unexpected RPC method');
  });
  registry = fixture.registry;
  await expectAssetError(
    () =>
      fixture.service.getTokenMetadata({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
      }),
    'TOKEN_NETWORK_CHANGED',
  );

  let mismatchRequests = 0;
  const mismatch = await createTokenFixture((method, _, id) => {
    if (method === 'eth_chainId') {
      mismatchRequests += 1;
      return mismatchRequests === 1
        ? responseFor(id, '0x1')
        : responseFor(id, '0x38');
    }
    throw new Error('unexpected RPC method');
  });
  await expectAssetError(
    () =>
      mismatch.service.getTokenMetadata({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
      }),
    'TOKEN_CHAIN_MISMATCH',
  );

  const failed = await createTokenFixture((method, _, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return rpcErrorFor(id);
    throw new Error('unexpected RPC method');
  });
  await assert.rejects(
    () =>
      failed.service.getTokenMetadata({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AssetError);
      assert.equal(error.code, 'TOKEN_CONTRACT_CALL_FAILED');
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );

  await expectAssetError(
    () =>
      failed.service.getTokenBalance({
        networkId: 'ethereum',
        contractAddress: CONTRACT,
        accountId: 'account-0',
        accountAddress: 'bad',
        token: standardToken(),
      }),
    'TOKEN_INVALID_ADDRESS',
  );
});

test('does not call forbidden token methods, allowance, signing, broadcasting, or persistence', async () => {
  const token = standardToken();
  const fixture = await createTokenFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_call') return responseFor(id, encodeUint(1n));
    if (method === 'eth_sendRawTransaction') {
      throw new Error('broadcast forbidden');
    }
    throw new Error(`forbidden RPC method: ${method}`);
  });
  const balance = await fixture.service.getTokenBalance({
    networkId: 'ethereum',
    contractAddress: CONTRACT,
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    token,
  });
  const methods = fixture.transport.requests.map((request) =>
    JSON.parse(request.body).method,
  );
  assert.equal(balance.rawBalance, 1n);
  assert.deepEqual(methods, ['eth_chainId', 'eth_call']);
  assert.equal(methods.includes('eth_sendRawTransaction'), false);
  assert.equal(Object.keys(balance).includes('privateKey'), false);
  assert.equal(Object.keys(balance).includes('mnemonic'), false);
  assert.equal(Object.keys(balance).includes('vault'), false);
});