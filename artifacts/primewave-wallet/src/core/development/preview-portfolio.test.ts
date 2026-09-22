import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvmRpcProvider,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import {
  NetworkRegistry,
  supportedNetworks,
} from '@/src/core/networks';
import type { EvmNetwork } from '@/src/core/networks';
import { PortfolioError } from '@/src/core/portfolio';
import {
  createPreviewPortfolioReadModelService,
} from './preview-portfolio';
import { PREVIEW_TEST_ADDRESS } from './preview-test-mode';

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
      readonly id: number | string;
      readonly method: string;
      readonly params: unknown[];
    };
    const result = await this.handler(body.method, body.params, body.id);
    if (result instanceof Error) throw result;
    return result;
  }
}

function responseFor(
  id: number | string,
  result: unknown,
): RpcTransportResponse {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function installPreviewEnvironment(dev: boolean): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previousDev = globals.__DEV__;
  const previousDocument = globals.document;
  Object.defineProperty(globals, '__DEV__', {
    configurable: true,
    value: dev,
  });
  Object.defineProperty(globals, 'document', {
    configurable: true,
    value: {},
  });
  return () => {
    if (previousDev === undefined) delete globals.__DEV__;
    else Object.defineProperty(globals, '__DEV__', { configurable: true, value: previousDev });
    if (previousDocument === undefined) delete globals.document;
    else Object.defineProperty(globals, 'document', { configurable: true, value: previousDocument });
  };
}

function createRegistry(networkId = 'ethereum'): NetworkRegistry {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(networkId);
  return registry;
}

function network(networkId: string): EvmNetwork {
  return supportedNetworks.find((candidate) => candidate.id === networkId) as EvmNetwork;
}

function previewQuery(networkId = 'ethereum') {
  return {
    accountId: 'development-preview-account-0',
    accountAddress: PREVIEW_TEST_ADDRESS,
    networkId,
  };
}

function createFixture(options: {
  readonly nativeBalance?: bigint;
  readonly failBalance?: boolean;
  readonly onBalance?: (registry: NetworkRegistry) => void;
}) {
  const registry = createRegistry();
  const transport = new FakeTransport((method, _params, id) => {
    if (method === 'eth_chainId') {
      return responseFor(id, `0x${network('ethereum').chainId?.toString(16)}`);
    }
    if (method === 'eth_getBalance') {
      options.onBalance?.(registry);
      if (options.failBalance) return new Error('private RPC failure');
      return responseFor(
        id,
        `0x${(options.nativeBalance ?? 0n).toString(16)}`,
      );
    }
    return new Error(`unexpected method: ${method}`);
  });
  const service = createPreviewPortfolioReadModelService(registry, {
    createProvider: (providerRegistry) =>
      createEvmRpcProvider(providerRegistry, { transport }),
  });
  return { registry, service, transport };
}

test('reads the preview address from the selected network with exact bigint balance', async () => {
  const restore = installPreviewEnvironment(true);
  try {
    const rawBalance = 123456789012345678901234567890n;
    const fixture = createFixture({ nativeBalance: rawBalance });
    const model = await fixture.service.getPortfolio(previewQuery());
    const asset = model.assets[0];

    assert.equal(asset?.rawBalance, rawBalance);
    assert.equal(asset?.formattedBalance, '123456789012.34567890123456789');
    const balanceRequest = fixture.transport.requests
      .map((request) => JSON.parse(request.body) as { method: string; params: unknown[] })
      .find((request) => request.method === 'eth_getBalance');
    assert.deepEqual(balanceRequest?.params, [PREVIEW_TEST_ADDRESS, 'latest']);
    assert.equal(
      fixture.transport.requests.some((request) =>
        request.body.includes('eth_sendRawTransaction'),
      ),
      false,
    );
  } finally {
    restore();
  }
});

test('keeps zero as a real available balance instead of treating it as unavailable', async () => {
  const restore = installPreviewEnvironment(true);
  try {
    const fixture = createFixture({ nativeBalance: 0n });
    const model = await fixture.service.getPortfolio(previewQuery());
    const asset = model.assets[0];

    assert.equal(asset?.rawBalance, 0n);
    assert.equal(asset?.formattedBalance, '0');
    assert.equal(asset?.balanceState, 'zero');
    assert.equal(asset?.availabilityState, 'available');
    assert.equal(model.state, 'ready');
  } finally {
    restore();
  }
});

test('maps an RPC failure to the existing unavailable state without inventing zero', async () => {
  const restore = installPreviewEnvironment(true);
  try {
    const fixture = createFixture({ failBalance: true });
    const model = await fixture.service.getPortfolio(previewQuery());
    const asset = model.assets[0];

    assert.equal(asset?.rawBalance, null);
    assert.equal(asset?.formattedBalance, null);
    assert.equal(asset?.balanceState, 'unavailable');
    assert.equal(asset?.availabilityState, 'unavailable');
    assert.equal(model.state, 'unavailable');
  } finally {
    restore();
  }
});

test('rejects a stale result when the selected network changes during the read', async () => {
  const restore = installPreviewEnvironment(true);
  try {
    const fixture = createFixture({
      nativeBalance: 1n,
      onBalance: (registry) => registry.selectActiveNetwork('base'),
    });

    await assert.rejects(
      fixture.service.getPortfolio(previewQuery()),
      (error: unknown) =>
        error instanceof PortfolioError &&
        error.code === 'PORTFOLIO_NETWORK_CHANGED',
    );
  } finally {
    restore();
  }
});

test('is isolated from non-preview addresses and production builds', async () => {
  const productionRestore = installPreviewEnvironment(false);
  try {
    let providerCreated = false;
    const registry = createRegistry();
    const service = createPreviewPortfolioReadModelService(registry, {
      createProvider: async () => {
        providerCreated = true;
        throw new Error('provider must not be created');
      },
    });

    await assert.rejects(
      service.getPortfolio(previewQuery()),
      /could not be generated/,
    );
    assert.equal(providerCreated, false);
  } finally {
    productionRestore();
  }

  const previewRestore = installPreviewEnvironment(true);
  try {
    const fixture = createFixture({ nativeBalance: 1n });
    await assert.rejects(
      fixture.service.getPortfolio({
        ...previewQuery(),
        accountAddress: '0x1111111111111111111111111111111111111111',
      }),
      /request is invalid/,
    );
    assert.equal(fixture.transport.requests.length, 0);
  } finally {
    previewRestore();
  }
});