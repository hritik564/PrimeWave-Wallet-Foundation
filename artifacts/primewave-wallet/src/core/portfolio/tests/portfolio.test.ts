import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetError,
  AssetRegistry,
  ERC20_READ_ABI,
  ERC20TokenService,
  InMemoryTokenPreferenceRepository,
  TokenDiscoveryService,
  NativeAssetBalanceService,
  type NetworkBoundTokenReadService,
  type TokenPreferenceRepository,
} from '@/src/core/assets';
import {
  PortfolioAggregationService,
  PortfolioError,
  createAssetIcon,
  type PortfolioNetworkReadService,
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
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
} from 'viem';
import {
  NetworkRegistry,
  supportedNetworks,
} from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

const ACCOUNT_A = '0x52908400098527886e0f7030069857d2e4169ee7';
const ACCOUNT_B = '0x1111111111111111111111111111111111111111';
const CONTRACT_A = '0x2222222222222222222222222222222222222222';
const CONTRACT_B = '0x3333333333333333333333333333333333333333';

function responseFor(id: number | string, result: unknown): RpcTransportResponse {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function errorFor(id: number | string): RpcTransportResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code: 3, message: 'private provider details must not leak' },
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
    const result = await this.handler(body.method, body.params, body.id);
    if (result instanceof Error) throw result;
    return result;
  }
}

function network(id: string): EvmNetwork {
  return supportedNetworks.find((candidate) => candidate.id === id) as EvmNetwork;
}

function createRegistry(networkId: string): NetworkRegistry {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(networkId);
  return registry;
}

function selector(
  functionName: 'name' | 'symbol' | 'decimals' | 'balanceOf',
): string {
  return encodeFunctionData({
    abi: ERC20_READ_ABI,
    functionName,
    args:
      functionName === 'balanceOf'
        ? [ACCOUNT_A as Address]
        : undefined,
  });
}

function stringResult(value: string): `0x${string}` {
  return encodeAbiParameters([{ type: 'string' }], [value]);
}

function uintResult(value: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

function createHandler(options: {
  readonly chainId: string;
  readonly nativeBalance?: bigint;
  readonly tokenBalances?: Record<string, bigint>;
  readonly missingDecimals?: boolean;
  readonly onNativeBalance?: () => void;
}): Handler {
  return (method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, options.chainId);
    if (method === 'eth_getBalance') {
      options.onNativeBalance?.();
      return responseFor(id, `0x${(options.nativeBalance ?? 0n).toString(16)}`);
    }
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data === selector('name')) return responseFor(id, stringResult('Token'));
      if (data === selector('symbol')) return responseFor(id, stringResult('TKN'));
      if (data === selector('decimals')) {
        return options.missingDecimals
          ? errorFor(id)
          : responseFor(id, uintResult(18n));
      }
      if (data.startsWith(selector('balanceOf').slice(0, 10))) {
        const to = (params[0] as { to: string }).to.toLowerCase();
        return responseFor(
          id,
          uintResult(options.tokenBalances?.[to] ?? 0n),
        );
      }
    }
    throw new Error(`Unexpected portfolio RPC method: ${method}`);
  };
}

async function createNetworkService(
  networkId: string,
  handler: Handler,
): Promise<{
  readonly registry: NetworkRegistry;
  readonly accountState: EvmAccountStateService;
  readonly provider: Awaited<ReturnType<typeof createEvmRpcProvider>>;
  readonly readService: NetworkBoundTokenReadService;
  readonly transport: FakeTransport;
}> {
  const registry = createRegistry(networkId);
  const transport = new FakeTransport(handler);
  const provider = await createEvmRpcProvider(registry, { transport });
  const accountState = new EvmAccountStateService(registry, provider);
  return {
    registry,
    accountState,
    provider,
    transport,
    readService: { accountState, provider },
  };
}

async function createFixture(options: {
  readonly networks?: readonly string[];
  readonly tokenBalances?: Record<string, bigint>;
  readonly nativeBalance?: bigint;
  readonly missingDecimals?: boolean;
  readonly repository?: TokenPreferenceRepository;
  readonly onNativeBalance?: () => void;
} = {}) {
  const networks = options.networks ?? ['ethereum'];
  const services = [];
  for (const networkId of networks) {
    const chainId = `0x${network(networkId).chainId?.toString(16)}`;
    services.push(
      await createNetworkService(
        networkId,
        createHandler({
          chainId,
          nativeBalance: options.nativeBalance,
          tokenBalances: options.tokenBalances,
          missingDecimals: options.missingDecimals,
          onNativeBalance: options.onNativeBalance,
        }),
      ),
    );
  }
  const assets = new AssetRegistry(new NetworkRegistry(supportedNetworks));
  const readServices = services.map(
    (service) => service.readService,
  ) as readonly NetworkBoundTokenReadService[];
  const nativeBalanceService = new NativeAssetBalanceService(
    assets,
    services.map((service) => ({ service: service.accountState })),
    { now: () => 1_700_000_000_000 },
  );
  const tokenService = new ERC20TokenService(assets, readServices, {
    now: () => 1_700_000_000_000,
  });
  const repository =
    options.repository ?? new InMemoryTokenPreferenceRepository();
  const discovery = new TokenDiscoveryService(
    tokenService,
    readServices,
    { now: () => 1_700_000_000_000, repository },
  );
  const portfolio = new PortfolioAggregationService(
    assets,
    nativeBalanceService,
    tokenService,
    readServices as readonly PortfolioNetworkReadService[],
    {
      now: () => 1_700_000_000_000,
      tokenDiscoveryService: discovery,
    },
  );
  return {
    assets,
    services,
    readServices,
    nativeBalanceService,
    tokenService,
    discovery,
    portfolio,
  };
}

async function expectPortfolioError(
  callback: () => unknown | Promise<unknown>,
  code: AssetError['code'],
): Promise<void> {
  await assert.rejects(async () => callback(), (error: unknown) => {
    return error instanceof PortfolioError && error.code === code;
  });
}

test('constructs deterministic icon fallbacks without implying verification', () => {
  const identity = {
    assetType: 'fungible_token' as const,
    networkId: 'ethereum',
    assetId: CONTRACT_A,
  };
  const first = createAssetIcon(identity, 'Token', 'TKN');
  const second = createAssetIcon(identity, 'Changed name', 'OTHER');
  assert.equal(first.source, 'none');
  assert.equal(first.status, 'unavailable');
  assert.equal(first.provenance, 'none');
  assert.equal(first.fallback.initials, 'TK');
  assert.equal(first.fallback.deterministicId, second.fallback.deterministicId);
  assert.equal(first.fallback.deterministicId.startsWith('0x'), true);
});

test('aggregates native and ERC-20 balances with exact bigint amounts', async () => {
  const fixture = await createFixture({
    nativeBalance: 9_000_000_000_000_000_001n,
    tokenBalances: {
      [CONTRACT_A.toLowerCase()]: 123456789012345678901234567890n,
    },
  });
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  const portfolio = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  assert.equal(portfolio.assets.length, 2);
  const native = portfolio.assets.find(
    (asset) => asset.identity.assetType === 'native',
  );
  const token = portfolio.assets.find(
    (asset) => asset.identity.assetType === 'fungible_token',
  );
  assert.equal(native?.balance.rawAmount, 9_000_000_000_000_000_001n);
  assert.equal(token?.balance.rawAmount, 123456789012345678901234567890n);
  assert.equal(token?.balance.decimals, 18);
  assert.equal(portfolio.summary.assetsWithBalances, 2);
  assert.equal(portfolio.summary.nativeAssetCount, 1);
  assert.equal(portfolio.summary.fungibleTokenCount, 1);
  assert.equal(native?.icon.fallback.type, 'native_currency');
});

test('preserves user-added and discovered provenance while deduplicating one token', async () => {
  const fixture = await createFixture();
  await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
    visibility: 'hidden',
  });
  await fixture.discovery.discoverKnownToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A.toLowerCase(),
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    visibility: 'hidden',
  });
  const portfolio = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  const tokenAssets = portfolio.assets.filter(
    (asset) => asset.identity.assetType === 'fungible_token',
  );
  assert.equal(tokenAssets.length, 1);
  assert.deepEqual(tokenAssets[0].sources, ['user_added', 'discovered']);
  assert.deepEqual(tokenAssets[0].provenance, ['user_added', 'discovered']);
  assert.equal(tokenAssets[0].visibility, 'hidden');
  assert.equal(tokenAssets[0].verificationStatus, 'unknown');
  assert.equal(tokenAssets[0].balance.hasBalance, false);
  assert.equal(portfolio.summary.hiddenAssetCount, 1);

  const visibleOnly = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
    includeHidden: false,
  });
  assert.equal(
    visibleOnly.assets.some(
      (asset) => asset.identity.assetType === 'fungible_token',
    ),
    false,
  );
});

test('keeps account views isolated and preserves account-specific live balances', async () => {
  const fixture = await createFixture({
    nativeBalance: 7n,
    tokenBalances: {
      [CONTRACT_A.toLowerCase()]: 11n,
    },
  });
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  const first = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  const second = await fixture.portfolio.getPortfolio({
    accountId: 'account-b',
    accountAddress: ACCOUNT_B,
    networkIds: ['ethereum'],
  });
  assert.equal(first.account.accountId, 'account-a');
  assert.equal(second.account.accountId, 'account-b');
  assert.notEqual(first.account.address, second.account.address);
  assert.equal(first.assets.every((asset) => asset.accountId === 'account-a'), true);
  assert.equal(second.assets.every((asset) => asset.accountId === 'account-b'), true);
});

test('keeps equal addresses and equal symbols separate across networks', async () => {
  const fixture = await createFixture({
    networks: ['ethereum', 'base'],
    tokenBalances: { [CONTRACT_A.toLowerCase()]: 1n },
  });
  await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  await fixture.discovery.addUserToken({
    networkId: 'base',
    contractAddress: CONTRACT_A,
  });
  const portfolio = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum', 'base'],
  });
  const tokens = portfolio.assets.filter(
    (asset) => asset.identity.assetType === 'fungible_token',
  );
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0].identity.networkId, tokens[1].identity.networkId);
  assert.notEqual(
    JSON.stringify(tokens[0].identity),
    JSON.stringify(tokens[1].identity),
  );
  assert.equal(portfolio.summary.networksRepresented, 2);
});

test('represents missing metadata without inventing decimals or balance values', async () => {
  const fixture = await createFixture({ missingDecimals: true });
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  const portfolio = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  const token = portfolio.assets.find(
    (asset) => asset.identity.assetType === 'fungible_token',
  );
  assert.equal(token?.status, 'metadata_unavailable');
  assert.equal(token?.decimals, null);
  assert.equal(token?.balance.rawAmount, null);
  assert.equal(token?.balance.formattedAmount, null);
});

test('supports explicit token selection and rejects unconfigured or invalid requests', async () => {
  const fixture = await createFixture();
  await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  const identity = fixture.discovery.getCandidates()[0].assetIdentity;
  const selected = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
    tokenIdentities: [identity, identity],
  });
  assert.equal(
    selected.assets.filter(
      (asset) => asset.identity.assetType === 'fungible_token',
    ).length,
    1,
  );
  await expectPortfolioError(
    () =>
      fixture.portfolio.getPortfolio({
        accountId: 'account-a',
        accountAddress: ACCOUNT_A,
        networkIds: ['primewave'],
      }),
    'PORTFOLIO_NETWORK_NOT_CONFIGURED',
  );
  await expectPortfolioError(
    () =>
      fixture.portfolio.getPortfolio({
        accountId: 'account-a',
        accountAddress: ACCOUNT_A,
        networkIds: ['ethereum'],
        tokenIdentities: [
          {
            assetType: 'native',
            networkId: 'ethereum',
            assetId: 'native',
          },
        ],
      }),
    'PORTFOLIO_INVALID_REQUEST',
  );
});

test('rejects remote chain mismatch and active-network changes instead of returning stale data', async () => {
  const mismatch = await createFixture();
  const originalChainId = mismatch.services[0].registry.getById('ethereum')
    ?.chainId;
  assert.equal(originalChainId, 1);
  let mismatchCalls = 0;
  const invalid = await createNetworkService('ethereum', (method, params, id) => {
    if (method === 'eth_chainId') {
      mismatchCalls += 1;
      return responseFor(id, mismatchCalls === 1 ? '0x1' : '0x2');
    }
    return createHandler({ chainId: '0x1' })(method, params, id);
  });
  const invalidAssets = new AssetRegistry(new NetworkRegistry(supportedNetworks));
  const invalidNative = new NativeAssetBalanceService(
    invalidAssets,
    [{ service: invalid.accountState }],
  );
  const invalidTokens = new ERC20TokenService(
    invalidAssets,
    [invalid.readService],
  );
  const invalidPortfolio = new PortfolioAggregationService(
    invalidAssets,
    invalidNative,
    invalidTokens,
    [invalid.readService],
  );
  await expectPortfolioError(
    () =>
      invalidPortfolio.getPortfolio({
        accountId: 'account-a',
        accountAddress: ACCOUNT_A,
        networkIds: ['ethereum'],
      }),
    'PORTFOLIO_CHAIN_MISMATCH',
  );

  let changedRegistry!: NetworkRegistry;
  const changed = await createNetworkService(
    'ethereum',
    createHandler({
      chainId: '0x1',
      onNativeBalance: () => changedRegistry.selectActiveNetwork('base'),
    }),
  );
  changedRegistry = changed.registry;
  const changedAssets = new AssetRegistry(new NetworkRegistry(supportedNetworks));
  const changedNative = new NativeAssetBalanceService(
    changedAssets,
    [{ service: changed.accountState }],
  );
  const changedTokens = new ERC20TokenService(
    changedAssets,
    [changed.readService],
  );
  const changedPortfolio = new PortfolioAggregationService(
    changedAssets,
    changedNative,
    changedTokens,
    [changed.readService],
  );
  await expectPortfolioError(
    () =>
      changedPortfolio.getPortfolio({
        accountId: 'account-a',
        accountAddress: ACCOUNT_A,
        networkIds: ['ethereum'],
      }),
    'PORTFOLIO_NETWORK_CHANGED',
  );
});

test('keeps portfolio aggregation read-only and bounded', async () => {
  const fixture = await createFixture();
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  const methods = fixture.services.flatMap((service) =>
    service.transport.requests.map(
      (request) => JSON.parse(request.body).method as string,
    ),
  );
  assert.equal(methods.includes('eth_getLogs'), false);
  assert.equal(methods.includes('eth_sendRawTransaction'), false);
  assert.equal(
    methods.every((method) =>
      [
        'eth_chainId',
        'eth_getBalance',
        'eth_getCode',
        'eth_call',
      ].includes(method),
    ),
    true,
  );
});

test('normalizes per-asset RPC failures without exposing provider details', async () => {
  const fixture = await createFixture();
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  const service = fixture.services[0];
  service.transport.requests.length = 0;
  const originalRequest = service.transport.request.bind(service.transport);
  service.transport.request = async (request) => {
    const body = JSON.parse(request.body) as { method: string; id: number };
    if (body.method === 'eth_call') return errorFor(body.id);
    return originalRequest(request);
  };
  const portfolio = await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  const token = portfolio.assets.find(
    (asset) => asset.identity.assetType === 'fungible_token',
  );
  assert.equal(token?.status, 'balance_unavailable');
  assert.equal(token?.errorCode, 'TOKEN_BALANCE_UNAVAILABLE');
  assert.equal(
    JSON.stringify(portfolio, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ).includes('private provider'),
    false,
  );
});

test('does not persist portfolio balances or access secure wallet state', async () => {
  const repository = new InMemoryTokenPreferenceRepository();
  const fixture = await createFixture({ repository });
  const metadata = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_B,
  });
  fixture.tokenService.getTokenRegistry().register(metadata);
  await fixture.portfolio.getPortfolio({
    accountId: 'account-a',
    accountAddress: ACCOUNT_A,
    networkIds: ['ethereum'],
  });
  assert.equal((await repository.list()).length, 0);
  assert.equal(
    fixture.services.some((service) =>
      service.transport.requests.some((request) =>
        JSON.stringify(request.body).match(/SecureStore|mnemonic|privateKey|seed/i),
      ),
    ),
    false,
  );
});

test('enforces explicit portfolio and asset result bounds', async () => {
  const fixture = await createFixture();
  const first = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  const second = await fixture.tokenService.getTokenMetadata({
    networkId: 'ethereum',
    contractAddress: CONTRACT_B,
  });
  fixture.tokenService.getTokenRegistry().register(first);
  fixture.tokenService.getTokenRegistry().register(second);
  const limited = new PortfolioAggregationService(
    fixture.assets,
    fixture.nativeBalanceService,
    fixture.tokenService,
    fixture.readServices,
    { maxAssets: 2 },
  );
  await expectPortfolioError(
    () =>
      limited.getPortfolio({
        accountId: 'account-a',
        accountAddress: ACCOUNT_A,
        networkIds: ['ethereum'],
      }),
    'PORTFOLIO_RESULT_LIMIT',
  );
});
