import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAssetIdentity,
  createTokenAssetIdentity,
} from '@/src/core/assets';
import { defaultNetworkRegistry } from '@/src/core/networks';
import {
  createZeroExSwapQuoteProvider,
  DEFAULT_ZEROEX_TIMEOUT_MS,
  mapZeroExQuote,
  SwapError,
  SwapQuoteService,
  ZEROEX_API_BASE_URL,
  ZEROEX_NATIVE_TOKEN,
  ZEROEX_NETWORK_CHAIN_IDS,
  ZEROEX_SUPPORTED_NETWORKS,
  ZeroExHttpClient,
  type SwapQuoteRequest,
  type ZeroExHttpResponse,
  type ZeroExHttpTransport,
} from '../index';

const NOW = 2_000_000_000_000;
const sender = '0x1111111111111111111111111111111111111111';
const router = '0x2222222222222222222222222222222222222222';
const allowanceTarget = '0x4444444444444444444444444444444444444444';
const buyToken = createTokenAssetIdentity(
  'ethereum',
  '0x3333333333333333333333333333333333333333',
);
const native = createAssetIdentity('native', 'ethereum', 'native');

const request: SwapQuoteRequest = {
  accountId: 'account-1',
  senderAddress: sender,
  networkId: 'ethereum',
  chainId: 1n,
  sellAsset: native,
  buyAsset: buyToken,
  sellAmount: 1_000_000_000_000_000_000n,
  slippageBps: 50,
};

function response(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    zid: '0xquote-1',
    buyToken: buyToken.assetId,
    sellToken: ZEROEX_NATIVE_TOKEN,
    buyAmount: '1990000000000000000000',
    minBuyAmount: '1980050000000000000000',
    sellAmount: request.sellAmount.toString(),
    liquidityAvailable: true,
    fees: {
      gasFee: {
        amount: '5000000000000000',
        token: ZEROEX_NATIVE_TOKEN,
        type: 'volume',
      },
      zeroExFee: {
        amount: '1000',
        token: buyToken.assetId,
        type: 'volume',
      },
      integratorFee: null,
    },
    issues: {
      allowance: null,
      balance: null,
      simulationIncomplete: false,
      invalidSourcesPassed: [],
    },
    route: {
      fills: [
        {
          from: ZEROEX_NATIVE_TOKEN,
          to: buyToken.assetId,
          source: 'TestSource',
          proportionBps: '10000',
        },
      ],
    },
    totalNetworkFee: '5000000000000000',
    transaction: {
      to: router,
      data: '0x1234',
      value: request.sellAmount.toString(),
      gas: '220000',
      gasPrice: '1000000000',
    },
    ...overrides,
  };
}

function httpResponse(
  status: number,
  body: unknown,
  jsonError = false,
): ZeroExHttpResponse {
  return {
    status,
    json: async () => {
      if (jsonError) throw new Error('malformed body');
      return body;
    },
  };
}

function transportFor(
  responseValue: ZeroExHttpResponse,
  onRequest?: (url: string, headers: Readonly<Record<string, string>>) => void,
): ZeroExHttpTransport {
  return async (url, init) => {
    onRequest?.(url, init.headers);
    return responseValue;
  };
}

async function assertAsyncCode(
  operation: Promise<unknown>,
  code: ConstructorParameters<typeof SwapError>[0],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return error instanceof SwapError && error.code === code;
  });
}

function assertSyncCode(
  operation: () => unknown,
  code: ConstructorParameters<typeof SwapError>[0],
): void {
  assert.throws(operation, (error: unknown) => {
    return error instanceof SwapError && error.code === code;
  });
}

test('exposes only 0x-supported configured network mappings', () => {
  assert.deepEqual(ZEROEX_NETWORK_CHAIN_IDS, {
    ethereum: 1,
    'bnb-smart-chain': 56,
    polygon: 137,
    arbitrum: 42161,
    base: 8453,
    optimism: 10,
  });
  assert.deepEqual(ZEROEX_SUPPORTED_NETWORKS.includes('primewave'), false);
});

test('requires an API key without storing it in wallet infrastructure', () => {
  assertSyncCode(
    () => new ZeroExHttpClient({ apiKey: '' }),
    'SWAP_PROVIDER_CONFIGURATION',
  );
  assertSyncCode(
    () => createZeroExSwapQuoteProvider({ apiKey: '' }),
    'SWAP_PROVIDER_CONFIGURATION',
  );
});

test('maps a real-shaped 0x v2 quote through the existing SwapQuoteService', async () => {
  let capturedUrl = '';
  let capturedHeaders: Readonly<Record<string, string>> | undefined;
  const provider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    networkRegistry: defaultNetworkRegistry,
    now: () => NOW,
    transport: transportFor(
      httpResponse(200, response()),
      (url, headers) => {
        capturedUrl = url;
        capturedHeaders = headers;
      },
    ),
  });
  const service = new SwapQuoteService(
    defaultNetworkRegistry,
    provider,
    { now: () => NOW },
  );
  const quote = await service.getQuote(request);
  const url = new URL(capturedUrl);

  assert.equal(quote.providerId, '0x-swap-api-v2');
  assert.equal(quote.expectedBuyAmount, 1_990_000_000_000_000_000_000n);
  assert.equal(quote.minimumBuyAmount, 1_980_050_000_000_000_000_000n);
  assert.equal(quote.transactionRequest.from, sender);
  assert.equal(quote.transactionRequest.to, router);
  assert.equal(quote.transactionRequest.data, '0x1234');
  assert.equal(quote.gasEstimate, 220_000n);
  assert.equal(quote.gasFee?.amount, 5_000_000_000_000_000n);
  assert.equal(quote.providerFee?.amount, 1_000n);
  assert.equal(quote.integratorFee, null);
  assert.equal(quote.allowanceRequirement, null);
  assert.deepEqual(quote.providerIssues, []);
  assert.equal(quote.route.state, 'available');
  assert.equal(quote.route.hops[0].poolOrVenue, 'TestSource');
  assert.equal(quote.route.hops[0].proportionBps, 10_000);
  assert.equal(quote.priceImpact.state, 'unavailable');
  assert.equal(quote.expiresAt, NOW + 30_000);
  assert.equal(url.origin, ZEROEX_API_BASE_URL);
  assert.equal(url.pathname, '/swap/allowance-holder/quote');
  assert.equal(url.searchParams.get('chainId'), '1');
  assert.equal(url.searchParams.get('sellToken'), ZEROEX_NATIVE_TOKEN);
  assert.equal(url.searchParams.get('buyToken'), buyToken.assetId);
  assert.equal(url.searchParams.get('sellAmount'), request.sellAmount.toString());
  assert.equal(url.searchParams.get('taker'), sender);
  assert.equal(url.searchParams.get('slippageBps'), '50');
  assert.equal(capturedHeaders?.['0x-api-key'], 'test-only-api-key');
  assert.equal(capturedHeaders?.['0x-version'], 'v2');
  assert.equal(url.toString().includes('test-only-api-key'), false);
});

test('maps ERC-20 requests without confusing the native sentinel with asset identity', async () => {
  const sellToken = createTokenAssetIdentity(
    'ethereum',
    '0x5555555555555555555555555555555555555555',
  );
  const erc20Request = {
    ...request,
    sellAsset: sellToken,
    buyAsset: native,
    sellAmount: 999_999_999_999_999_999n,
  };
  let capturedUrl = '';
  const provider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    transport: transportFor(httpResponse(200, response({
      sellToken: sellToken.assetId,
      buyToken: ZEROEX_NATIVE_TOKEN,
      sellAmount: erc20Request.sellAmount.toString(),
      transaction: {
        to: router,
        data: '0x1234',
        value: '0',
        gas: '21000',
      },
      issues: {
        allowance: null,
        balance: null,
        simulationIncomplete: false,
        invalidSourcesPassed: [],
      },
      route: { fills: [] },
    })), (url) => {
      capturedUrl = url;
    }),
    now: () => NOW,
  });
  const service = new SwapQuoteService(
    defaultNetworkRegistry,
    provider,
    { now: () => NOW },
  );
  const quote = await service.getQuote(erc20Request);
  assert.equal(quote.sellAsset.assetId, sellToken.assetId);
  assert.equal(quote.buyAsset.assetType, 'native');
  assert.equal(new URL(capturedUrl).searchParams.get('sellToken'), sellToken.assetId);
  assert.equal(new URL(capturedUrl).searchParams.get('buyToken'), ZEROEX_NATIVE_TOKEN);
  assert.equal(quote.allowanceRequirement, null);
});

test('preserves an ERC-20 allowance requirement without executing approval', async () => {
  const sellToken = createTokenAssetIdentity(
    'ethereum',
    '0x5555555555555555555555555555555555555555',
  );
  const erc20Request = {
    ...request,
    sellAsset: sellToken,
  };
  const provider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    transport: transportFor(httpResponse(200, response({
      sellToken: sellToken.assetId,
      buyToken: buyToken.assetId,
      issues: {
        allowance: { actual: '0', spender: allowanceTarget },
        balance: null,
        simulationIncomplete: false,
        invalidSourcesPassed: [],
      },
      transaction: {
        to: router,
        data: '0x1234',
        value: erc20Request.sellAmount.toString(),
        gas: '220000',
      },
    }))),
    now: () => NOW,
  });
  const quote = await new SwapQuoteService(
    defaultNetworkRegistry,
    provider,
    { now: () => NOW },
  ).getQuote(erc20Request);
  assert.equal(quote.allowanceRequirement?.spender, allowanceTarget);
  assert.equal(quote.allowanceRequirement?.actualAmount, 0n);
  assert.deepEqual(quote.providerIssues, [{ code: 'allowance-required' }]);
});

test('rejects malformed response context and transaction fields', async () => {
  const cases: Array<[string, Record<string, unknown>, ConstructorParameters<typeof SwapError>[0]]> = [
    ['chain', { chainId: '56' }, 'SWAP_CHAIN_MISMATCH'],
    ['buy token', { buyToken: ZEROEX_NATIVE_TOKEN }, 'SWAP_ASSET_MISMATCH'],
    ['sell amount', { sellAmount: '2' }, 'SWAP_AMOUNT_MISMATCH'],
    [
      'sender',
      {
        transaction: { ...response().transaction as Record<string, unknown>, from: router },
      },
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ],
    [
      'recipient',
      {
        transaction: { ...response().transaction as Record<string, unknown>, to: '0x1234' },
      },
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ],
    [
      'calldata',
      {
        transaction: { ...response().transaction as Record<string, unknown>, data: '0x123' },
      },
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ],
    [
      'value',
      {
        transaction: { ...response().transaction as Record<string, unknown>, value: '-1' },
      },
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ],
    [
      'gas',
      {
        transaction: { ...response().transaction as Record<string, unknown>, gas: '-1' },
      },
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ],
  ];

  for (const [, overrides, code] of cases) {
    const provider = createZeroExSwapQuoteProvider({
      apiKey: 'test-only-api-key',
      transport: transportFor(httpResponse(200, response(overrides))),
      now: () => NOW,
    });
    const service = new SwapQuoteService(
      defaultNetworkRegistry,
      provider,
      { now: () => NOW },
    );
    await assertAsyncCode(service.getQuote(request), code);
  }
});

test('rejects malformed fees and price impact without converting them to zero', async () => {
  const malformedResponses: Array<
    [Record<string, unknown>, ConstructorParameters<typeof SwapError>[0]]
  > = [
    [
      response({
        fees: {
          gasFee: { amount: 'not-an-amount', token: ZEROEX_NATIVE_TOKEN },
        },
      }),
      'SWAP_INVALID_FEE' as const,
    ],
    [response({ priceImpactBps: '0.5' }), 'SWAP_INVALID_PRICE_IMPACT' as const],
  ];
  for (const [body, code] of malformedResponses) {
    const provider = createZeroExSwapQuoteProvider({
      apiKey: 'test-only-api-key',
      transport: transportFor(httpResponse(200, body)),
      now: () => NOW,
    });
    const service = new SwapQuoteService(
      defaultNetworkRegistry,
      provider,
      { now: () => NOW },
    );
    await assertAsyncCode(service.getQuote(request), code);
  }
});

test('rejects unavailable liquidity and preserves provider issue metadata', async () => {
  const unavailableProvider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    transport: transportFor(httpResponse(200, response({ liquidityAvailable: false }))),
    now: () => NOW,
  });
  await assertAsyncCode(
    new SwapQuoteService(
      defaultNetworkRegistry,
      unavailableProvider,
      { now: () => NOW },
    ).getQuote(request),
    'SWAP_QUOTE_UNAVAILABLE',
  );

  const issueProvider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    transport: transportFor(httpResponse(200, response({
      issues: {
        allowance: null,
        balance: { actual: '0', expected: request.sellAmount.toString() },
        simulationIncomplete: true,
        invalidSourcesPassed: ['bad-source'],
      },
    }))),
    now: () => NOW,
  });
  const issueQuote = await new SwapQuoteService(
    defaultNetworkRegistry,
    issueProvider,
    { now: () => NOW },
  ).getQuote(request);
  assert.deepEqual(issueQuote.providerIssues, [
    { code: 'balance-insufficient' },
    { code: 'simulation-incomplete' },
    { code: 'invalid-sources' },
  ]);
});

test('normalizes HTTP, timeout, and malformed JSON responses without leaking credentials', async () => {
  const statuses: Array<[number, ConstructorParameters<typeof SwapError>[0]]> = [
    [400, 'SWAP_PROVIDER_ERROR'],
    [401, 'SWAP_PROVIDER_ERROR'],
    [403, 'SWAP_PROVIDER_ERROR'],
    [404, 'SWAP_PROVIDER_ERROR'],
    [408, 'SWAP_QUOTE_UNAVAILABLE'],
    [429, 'SWAP_PROVIDER_RATE_LIMITED'],
    [500, 'SWAP_QUOTE_UNAVAILABLE'],
    [502, 'SWAP_QUOTE_UNAVAILABLE'],
    [503, 'SWAP_QUOTE_UNAVAILABLE'],
    [504, 'SWAP_QUOTE_UNAVAILABLE'],
  ];
  for (const [status, code] of statuses) {
    const provider = createZeroExSwapQuoteProvider({
      apiKey: 'hidden-test-key',
      transport: transportFor(httpResponse(status, {})),
      now: () => NOW,
    });
    await assertAsyncCode(
      new SwapQuoteService(
        defaultNetworkRegistry,
        provider,
        { now: () => NOW },
      ).getQuote(request),
      code,
    );
  }

  const malformedProvider = createZeroExSwapQuoteProvider({
    apiKey: 'hidden-test-key',
    transport: transportFor(httpResponse(200, null, true)),
    now: () => NOW,
  });
  await assertAsyncCode(
    new SwapQuoteService(
      defaultNetworkRegistry,
      malformedProvider,
      { now: () => NOW },
    ).getQuote(request),
    'SWAP_INVALID_QUOTE',
  );

  const failingProvider = createZeroExSwapQuoteProvider({
    apiKey: 'hidden-test-key',
    transport: async () => {
      throw new Error('hidden-test-key authorization header');
    },
    now: () => NOW,
  });
  await assert.rejects(
    new SwapQuoteService(
      defaultNetworkRegistry,
      failingProvider,
      { now: () => NOW },
    ).getQuote(request),
    (error: unknown) => {
      return (
        error instanceof SwapError &&
        error.code === 'SWAP_QUOTE_UNAVAILABLE' &&
        !error.message.includes('hidden-test-key')
      );
    },
  );
});

test('does not make automatic retries and keeps route unavailable when fills are not continuous', () => {
  const mapped = mapZeroExQuote(
    response({
      route: {
        fills: [
          {
            from: ZEROEX_NATIVE_TOKEN,
            to: buyToken.assetId,
            source: 'SourceA',
          },
          {
            from: ZEROEX_NATIVE_TOKEN,
            to: buyToken.assetId,
            source: 'SourceB',
          },
        ],
      },
    }),
    request,
    { now: NOW, quoteValidityMs: 30_000 },
  );
  assert.equal((mapped.route as { state: string }).state, 'unavailable');
  let calls = 0;
  const provider = createZeroExSwapQuoteProvider({
    apiKey: 'test-only-api-key',
    transport: async () => {
      calls += 1;
      return httpResponse(500, {});
    },
    now: () => NOW,
  });
  return assertAsyncCode(
    new SwapQuoteService(
      defaultNetworkRegistry,
      provider,
      { now: () => NOW },
    ).getQuote(request).finally(() => {
      assert.equal(calls, 1);
    }),
    'SWAP_QUOTE_UNAVAILABLE',
  );
});

test('uses the bounded default timeout and maps aborted transport to unavailable', async () => {
  assert.equal(DEFAULT_ZEROEX_TIMEOUT_MS, 10_000);
  const client = new ZeroExHttpClient({
    apiKey: 'test-only-api-key',
    timeoutMs: 1_000,
    transport: async (_url, init) =>
      new Promise<ZeroExHttpResponse>((_, reject) => {
        init.signal.addEventListener('abort', () => reject({ name: 'AbortError' }));
      }),
  });
  await assertAsyncCode(
    client.getQuote({
      chainId: '1',
      buyToken: buyToken.assetId,
      sellToken: ZEROEX_NATIVE_TOKEN,
      sellAmount: request.sellAmount.toString(),
      taker: sender,
      slippageBps: '50',
    }),
    'SWAP_QUOTE_UNAVAILABLE',
  );
});