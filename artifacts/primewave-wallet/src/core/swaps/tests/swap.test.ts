import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTokenAssetIdentity,
  defaultNetworkRegistry,
  supportedNetworks,
  type AssetIdentity,
} from '@/src/core/assets';
import { NetworkRegistry } from '@/src/core/networks';
import {
  MAX_SWAP_SLIPPAGE_BPS,
  SwapError,
  SwapQuoteService,
  validateSwapQuoteRequest,
  validateSwapQuoteResponse,
  type SwapQuote,
  type SwapQuoteProvider,
  type SwapQuoteRequest,
} from '../index';

const BASE_TIME = 2_000_000_000_000;
const sender = '0x1111111111111111111111111111111111111111';
const router = '0x2222222222222222222222222222222222222222';
const token = createTokenAssetIdentity(
  'ethereum',
  '0x3333333333333333333333333333333333333333',
);
const native: AssetIdentity = {
  assetType: 'native',
  networkId: 'ethereum',
  assetId: 'native',
};

function request(
  overrides: Partial<SwapQuoteRequest> = {},
): SwapQuoteRequest {
  return {
    accountId: 'account-1',
    senderAddress: sender,
    networkId: 'ethereum',
    chainId: 1n,
    sellAsset: native,
    buyAsset: token,
    sellAmount: 1_000_000_000_000_000_000n,
    slippageBps: 50,
    ...overrides,
  };
}

function quote(overrides: Partial<SwapQuote> = {}): SwapQuote {
  return {
    quoteId: 'quote-1',
    providerId: 'test-provider',
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
    sellAsset: native,
    buyAsset: token,
    sellAmount: 1_000_000_000_000_000_000n,
    expectedBuyAmount: 2_000_000_000n,
    minimumBuyAmount: 1_990_000_000n,
    slippageBps: 50,
    route: {
      hops: [
        {
          inputAsset: native,
          outputAsset: token,
          poolOrVenue: 'test-pool',
          protocol: 'test-protocol',
        },
      ],
    },
    priceImpact: {
      state: 'unavailable',
      reason: 'not-provided',
    },
    gasEstimate: 180_000n,
    gasFee: {
      amount: 4_000_000_000_000_000n,
      asset: native,
    },
    protocolFee: null,
    providerFee: null,
    estimatedExecutionTime: 30,
    quotedAt: BASE_TIME,
    expiresAt: BASE_TIME + 30_000,
    transactionRequest: {
      from: sender,
      to: router,
      value: 1_000_000_000_000_000_000n,
      data: '0x1234',
      gasLimit: 220_000n,
    },
    ...overrides,
  };
}

function provider(
  response: unknown = quote(),
): SwapQuoteProvider {
  return {
    metadata: {
      providerId: 'test-provider',
      displayName: 'Test-only provider',
      supportedNetworks: ['ethereum'],
      supportedCapabilities: [
        'exact-input',
        'multi-hop-route',
        'transaction-request',
      ],
    },
    getQuote: async () => response,
  };
}

function assertSwapCode(
  callback: () => unknown,
  code: ConstructorParameters<typeof SwapError>[0],
): void {
  assert.throws(callback, (error: unknown) => {
    return error instanceof SwapError && error.code === code;
  });
}

test('validates native to ERC-20 requests with exact bigint amounts', () => {
  const validated = validateSwapQuoteRequest(
    request({
      sellAmount: (1n << 256n) - 1n,
      slippageBps: MAX_SWAP_SLIPPAGE_BPS,
    }),
    defaultNetworkRegistry,
  );
  assert.equal(validated.sellAmount, (1n << 256n) - 1n);
  assert.equal(validated.slippageBps, 5000);
  assert.equal(validated.senderAddress, sender);
  assert.equal(validated.buyAsset.assetId, token.assetId);
});

test('supports ERC-20 to native and ERC-20 to ERC-20 requests', () => {
  const otherToken = createTokenAssetIdentity(
    'ethereum',
    '0x4444444444444444444444444444444444444444',
  );
  assert.equal(
    validateSwapQuoteRequest(
      request({
        sellAsset: token,
        buyAsset: native,
        sellAmount: 12_345n,
      }),
      defaultNetworkRegistry,
    ).sellAsset.assetType,
    'fungible_token',
  );
  assert.equal(
    validateSwapQuoteRequest(
      request({
        sellAsset: token,
        buyAsset: otherToken,
        sellAmount: 999n,
      }),
      defaultNetworkRegistry,
    ).buyAsset.assetId,
    otherToken.assetId,
  );
});

test('rejects invalid request context and unsupported asset pairs', () => {
  assertSwapCode(
    () => validateSwapQuoteRequest(request({ accountId: '  ' }), defaultNetworkRegistry),
    'SWAP_ACCOUNT_INVALID',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ senderAddress: '0x1234' }),
        defaultNetworkRegistry,
      ),
    'SWAP_SENDER_INVALID',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ networkId: 'unknown-network' }),
        defaultNetworkRegistry,
      ),
    'SWAP_NETWORK_UNSUPPORTED',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ chainId: 137n }),
        defaultNetworkRegistry,
      ),
    'SWAP_CHAIN_MISMATCH',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ sellAsset: token, buyAsset: token }),
        defaultNetworkRegistry,
      ),
    'SWAP_SAME_ASSET',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({
          buyAsset: {
            assetType: 'nft',
            networkId: 'ethereum',
            assetId: 'collection-1',
          },
        }),
        defaultNetworkRegistry,
      ),
    'SWAP_ASSET_UNSUPPORTED',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({
          buyAsset: {
            assetType: 'fungible_token',
            networkId: 'ethereum',
            assetId: 'not-an-address',
          },
        }),
        defaultNetworkRegistry,
      ),
    'SWAP_ASSET_INVALID',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({
          buyAsset: createTokenAssetIdentity(
            'polygon',
            '0x4444444444444444444444444444444444444444',
          ),
        }),
        defaultNetworkRegistry,
      ),
    'SWAP_CROSS_CHAIN_UNSUPPORTED',
  );
});

test('rejects disabled, unconfigured, zero, malformed, and excessive values', () => {
  const ethereum = supportedNetworks.find((network) => network.id === 'ethereum');
  assert.ok(ethereum);
  const registry = new NetworkRegistry([
    ...supportedNetworks,
    {
      ...ethereum,
      id: 'disabled-network',
      displayName: 'Disabled Network',
      chainId: 999,
      enabled: false,
    },
  ]);
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ networkId: 'disabled-network', chainId: 999n }),
        registry,
      ),
    'SWAP_NETWORK_DISABLED',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ networkId: 'primewave', chainId: 1n }),
        registry,
      ),
    'SWAP_NETWORK_NOT_CONFIGURED',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ sellAmount: 0n }),
        defaultNetworkRegistry,
      ),
    'SWAP_INVALID_AMOUNT',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ sellAmount: -1n }),
        defaultNetworkRegistry,
      ),
    'SWAP_INVALID_AMOUNT',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ sellAmount: 1 as unknown as bigint }),
        defaultNetworkRegistry,
      ),
    'SWAP_INVALID_AMOUNT',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ slippageBps: -1 }),
        defaultNetworkRegistry,
      ),
    'SWAP_INVALID_SLIPPAGE',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteRequest(
        request({ slippageBps: 5001 }),
        defaultNetworkRegistry,
      ),
    'SWAP_EXCESSIVE_SLIPPAGE',
  );
});

test('accepts a valid provider quote and preserves structured fees and unknown impact', () => {
  const validated = validateSwapQuoteRequest(request(), defaultNetworkRegistry);
  const normalized = validateSwapQuoteResponse(
    quote(),
    validated,
    provider().metadata,
    BASE_TIME + 1_000,
  );
  assert.equal(normalized.expectedBuyAmount, 2_000_000_000n);
  assert.equal(normalized.minimumBuyAmount, 1_990_000_000n);
  assert.equal(normalized.gasFee?.amount, 4_000_000_000_000_000n);
  assert.equal(normalized.protocolFee, null);
  assert.equal(normalized.priceImpact.state, 'unavailable');
  assert.equal(normalized.transactionRequest.data, '0x1234');
});

test('rejects malformed or untrusted provider quote fields', () => {
  const validated = validateSwapQuoteRequest(request(), defaultNetworkRegistry);
  const metadata = provider().metadata;
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({ providerId: 'another-provider' }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_PROVIDER_ID_MISMATCH',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({ sellAmount: 2n }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_AMOUNT_MISMATCH',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({
          transactionRequest: {
            ...quote().transactionRequest,
            from: router,
          },
        }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_INVALID_TRANSACTION_REQUEST',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({
          transactionRequest: {
            ...quote().transactionRequest,
            data: '0x123',
          },
        }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_INVALID_TRANSACTION_REQUEST',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({
          route: {
            hops: [
              {
                ...quote().route.hops[0],
                inputAsset: token,
              },
            ],
          },
        }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_INVALID_ROUTE',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote({ expiresAt: BASE_TIME }),
        validated,
        metadata,
        BASE_TIME,
      ),
    'SWAP_INVALID_QUOTE',
  );
  assertSwapCode(
    () =>
      validateSwapQuoteResponse(
        quote(),
        validated,
        metadata,
        BASE_TIME + 30_000,
      ),
    'SWAP_QUOTE_EXPIRED',
  );
});

test('quote service exposes idle, requesting, quoted, expired, and failed lifecycle states', async () => {
  let now = BASE_TIME;
  const service = new SwapQuoteService(
    defaultNetworkRegistry,
    provider(),
    { now: () => now },
  );
  assert.equal(service.getLifecycle().state, 'idle');
  const result = await service.getQuote(request());
  assert.equal(result.quoteId, 'quote-1');
  assert.equal(service.getLifecycle().state, 'quoted');
  assert.equal(service.isQuoteActive(result), true);
  now = result.expiresAt;
  assert.equal(service.getLifecycle().state, 'expired');
  assert.equal(service.isQuoteActive(result), false);
  service.clear();
  assert.equal(service.getLifecycle().state, 'idle');
});

test('normalizes provider failures without exposing provider error details', async () => {
  const failingProvider: SwapQuoteProvider = {
    ...provider(),
    getQuote: async () => {
      throw new Error('authorization header secret');
    },
  };
  const service = new SwapQuoteService(
    defaultNetworkRegistry,
    failingProvider,
    { now: () => BASE_TIME },
  );
  await assert.rejects(service.getQuote(request()), (error: unknown) => {
    return (
      error instanceof SwapError &&
      error.code === 'SWAP_PROVIDER_ERROR' &&
      !error.message.includes('authorization')
    );
  });
  assert.equal(service.getLifecycle().state, 'failed');
  assert.equal(service.getLifecycle().errorCode, 'SWAP_PROVIDER_ERROR');
});

test('provider receives only the public validated request and no execution capability', async () => {
  let received: SwapQuoteRequest | null = null;
  const observingProvider: SwapQuoteProvider = {
    ...provider(),
    getQuote: async (value) => {
      received = value;
      return quote();
    },
  };
  const service = new SwapQuoteService(
    defaultNetworkRegistry,
    observingProvider,
    { now: () => BASE_TIME },
  );
  await service.getQuote(request());
  assert.deepEqual(received, request());
  assert.equal('privateKey' in (received as object), false);
  assert.equal('mnemonic' in (received as object), false);
  assert.equal('sign' in (received as object), false);
  assert.equal('broadcast' in (received as object), false);
});