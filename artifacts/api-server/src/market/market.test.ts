import assert from "node:assert/strict";
import test from "node:test";
import { MarketProviderError } from "./errors";
import { StaticProviderAssetMappingRegistry } from "./mapping";
import { DeterministicMockPriceProvider } from "./provider";
import { MarketPriceService } from "./service";
import type {
  MarketAssetIdentity,
  MarketPriceConfig,
  PriceProvider,
  ProviderAssetRequest,
} from "./types";

const ETH_TOKEN = "0x1111111111111111111111111111111111111111";
const BNB_TOKEN = "0x1111111111111111111111111111111111111111";
const config: MarketPriceConfig = {
  enabled: true,
  maxAssets: 4,
  maxBatchSize: 2,
  freshnessMaxAgeMs: 60_000,
  maxTimestampFutureSkewMs: 5_000,
  maxDecimalPlaces: 18,
  supportedQuoteCurrencies: ["USD"],
};

function asset(kind: "native" | "erc20", networkId: string): MarketAssetIdentity {
  return kind === "native"
    ? { kind, networkId, assetId: "native" }
    : {
        kind,
        networkId,
        contractAddress: networkId === "ethereum" ? ETH_TOKEN : BNB_TOKEN,
      };
}

function mappings(
  providerId: string,
  entries: readonly { asset: MarketAssetIdentity; providerAssetId: string }[],
) {
  return new StaticProviderAssetMappingRegistry(
    entries.map((entry) => ({ ...entry, providerId })),
  );
}

function service(
  provider: PriceProvider,
  mapping: StaticProviderAssetMappingRegistry,
  now = Date.parse("2026-09-22T00:00:00.000Z"),
) {
  return new MarketPriceService(
    config,
    provider,
    mapping,
    undefined,
    () => now,
  );
}

test("native and ERC-20 identities remain network-aware and symbol-independent", async () => {
  const provider = new DeterministicMockPriceProvider(
    new Map([
      ["eth", { providerAssetId: "eth", price: "2000.25", observedAt: null }],
      ["bnb-token", {
        providerAssetId: "bnb-token",
        price: "1.5",
        observedAt: "2026-09-21T23:59:30.000Z",
      }],
    ]),
  );
  const mapping = mappings("deterministic-mock", [
    { asset: asset("native", "ethereum"), providerAssetId: "eth" },
    { asset: asset("erc20", "bnb-smart-chain"), providerAssetId: "bnb-token" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: [
      "native:ethereum",
      `erc20:bnb-smart-chain:0x${BNB_TOKEN.slice(2).toUpperCase()}`,
    ],
    quoteCurrency: "USD",
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.asset.networkId, "ethereum");
  assert.equal(result.items[0]?.freshness, "unknown");
  assert.equal(result.items[1]?.asset.networkId, "bnb-smart-chain");
  assert.equal(result.items[1]?.availability, "available");
  assert.equal(result.items[1]?.freshness, "fresh");
  assert.notEqual(
    JSON.stringify(result.items[0]),
    JSON.stringify(result.items[1]),
  );
});

test("duplicate identities are returned once and quote currencies are explicit", async () => {
  const provider = new DeterministicMockPriceProvider(
    new Map([
      ["eth", { providerAssetId: "eth", price: "2000", observedAt: null }],
    ]),
  );
  const mapping = mappings("deterministic-mock", [
    { asset: asset("native", "ethereum"), providerAssetId: "eth" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: ["native:ethereum", "native:ethereum"],
    quoteCurrency: "usd",
  });

  assert.equal(result.requested, 2);
  assert.equal(result.count, 1);
  assert.equal(result.quoteCurrency, "USD");
  await assert.rejects(
    () =>
      service(provider, mapping).getPrices({
        assetDescriptors: ["native:ethereum"],
        quoteCurrency: "EUR",
      }),
    /not supported/,
  );
});

test("fresh, stale, and timestamp-unknown prices are classified deterministically", async () => {
  const provider = new DeterministicMockPriceProvider(
    new Map([
      [
        "fresh",
        { providerAssetId: "fresh", price: "1.00", observedAt: "2026-09-21T23:59:30.000Z" },
      ],
      [
        "stale",
        { providerAssetId: "stale", price: "2.00", observedAt: "2026-09-21T23:00:00.000Z" },
      ],
      ["unknown", { providerAssetId: "unknown", price: "3.00", observedAt: null }],
    ]),
  );
  const mapping = mappings("deterministic-mock", [
    { asset: asset("native", "ethereum"), providerAssetId: "fresh" },
    { asset: asset("native", "bnb-smart-chain"), providerAssetId: "stale" },
    { asset: asset("native", "polygon"), providerAssetId: "unknown" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: [
      "native:ethereum",
      "native:bnb-smart-chain",
      "native:polygon",
    ],
    quoteCurrency: "USD",
  });

  assert.deepEqual(
    result.items.map((item) => item.freshness),
    ["fresh", "stale", "unknown"],
  );
});

test("negative, malformed, NaN, and Infinity prices are never accepted", async () => {
  const provider = new DeterministicMockPriceProvider(
    new Map([
      ["negative", { providerAssetId: "negative", price: "-1", observedAt: null }],
      ["nan", { providerAssetId: "nan", price: "NaN", observedAt: null }],
      ["infinity", { providerAssetId: "infinity", price: "Infinity", observedAt: null }],
      ["decimal", { providerAssetId: "decimal", price: "1.1234567890123456789", observedAt: null }],
    ]),
  );
  const mapping = mappings("deterministic-mock", [
    { asset: asset("native", "ethereum"), providerAssetId: "negative" },
    { asset: asset("native", "bnb-smart-chain"), providerAssetId: "nan" },
    { asset: asset("native", "polygon"), providerAssetId: "infinity" },
    { asset: asset("native", "arbitrum"), providerAssetId: "decimal" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: [
      "native:ethereum",
      "native:bnb-smart-chain",
      "native:polygon",
      "native:arbitrum",
    ],
    quoteCurrency: "USD",
  });

  assert.ok(result.items.every((item) => item.availability === "invalid"));
  assert.ok(result.items.every((item) => item.price === null));
});

test("invalid timestamps and missing observations remain explicit", async () => {
  const provider = new DeterministicMockPriceProvider(
    new Map([
      [
        "future",
        { providerAssetId: "future", price: "1", observedAt: "2030-01-01T00:00:00.000Z" },
      ],
    ]),
  );
  const mapping = mappings("deterministic-mock", [
    { asset: asset("native", "ethereum"), providerAssetId: "future" },
    { asset: asset("native", "bnb-smart-chain"), providerAssetId: "missing" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: ["native:ethereum", "native:bnb-smart-chain"],
    quoteCurrency: "USD",
  });

  assert.equal(result.items[0]?.availability, "invalid");
  assert.equal(result.items[0]?.reason, "invalid_timestamp");
  assert.equal(result.items[1]?.availability, "unavailable");
  assert.equal(result.items[1]?.price, null);
  assert.equal(result.items[1]?.reason, "price_unavailable");
});

test("provider timeout and rate-limit failures become safe unavailable states", async () => {
  for (const [providerError, reason] of [
    [new MarketProviderError("TIMEOUT", "private timeout"), "provider_timeout"],
    [new MarketProviderError("RATE_LIMIT", "private rate limit"), "provider_rate_limit"],
  ] as const) {
    const provider: PriceProvider = {
      providerId: "test-provider",
      supportedQuoteCurrencies: ["USD"],
      maxBatchSize: 2,
      async fetchPrices() {
        throw providerError;
      },
    };
    const mapping = mappings("test-provider", [
      { asset: asset("native", "ethereum"), providerAssetId: "eth" },
    ]);
    const result = await service(provider, mapping).getPrices({
      assetDescriptors: ["native:ethereum"],
      quoteCurrency: "USD",
    });
    assert.equal(result.items[0]?.availability, "unavailable");
    assert.equal(result.items[0]?.reason, reason);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("malformed provider responses become invalid without leaking provider fields", async () => {
  const provider: PriceProvider = {
    providerId: "test-provider",
    supportedQuoteCurrencies: ["USD"],
    maxBatchSize: 2,
    async fetchPrices() {
      return [{ providerAssetId: "unknown", price: "1", apiKey: "secret-value" }];
    },
  };
  const mapping = mappings("test-provider", [
    { asset: asset("native", "ethereum"), providerAssetId: "eth" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: ["native:ethereum"],
    quoteCurrency: "USD",
  });

  assert.equal(result.items[0]?.availability, "invalid");
  assert.equal(result.items[0]?.reason, "malformed_provider_response");
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
  assert.equal(JSON.stringify(result).includes("apiKey"), false);
});

test("oversized provider response arrays are rejected before response iteration", async () => {
  const provider: PriceProvider = {
    providerId: "test-provider",
    supportedQuoteCurrencies: ["USD"],
    maxBatchSize: 2,
    async fetchPrices() {
      return [
        { providerAssetId: "eth", price: "1", observedAt: null },
        { providerAssetId: "bnb", price: "2", observedAt: null },
        { providerAssetId: "extra", price: "3", observedAt: null },
      ];
    },
  };
  const mapping = mappings("test-provider", [
    { asset: asset("native", "ethereum"), providerAssetId: "eth" },
    { asset: asset("native", "bnb-smart-chain"), providerAssetId: "bnb" },
  ]);
  const result = await service(provider, mapping).getPrices({
    assetDescriptors: ["native:ethereum", "native:bnb-smart-chain"],
    quoteCurrency: "USD",
  });
  assert.ok(result.items.every((item) => item.reason === "malformed_provider_response"));
});

test("unavailable mappings do not become zero and the unconfigured provider is honest", async () => {
  const provider: PriceProvider = {
    providerId: "test-provider",
    supportedQuoteCurrencies: ["USD"],
    maxBatchSize: 2,
    async fetchPrices() {
      return [];
    },
  };
  const result = await new MarketPriceService(
    config,
    provider,
    new StaticProviderAssetMappingRegistry([]),
  ).getPrices({
    assetDescriptors: ["native:ethereum"],
    quoteCurrency: "USD",
  });
  assert.equal(result.items[0]?.availability, "unavailable");
  assert.equal(result.items[0]?.price, null);
  assert.equal(result.items[0]?.reason, "mapping_unavailable");

  const unconfiguredResult = await new MarketPriceService(config).getPrices({
    assetDescriptors: ["native:ethereum"],
    quoteCurrency: "USD",
  });
  assert.equal(unconfiguredResult.items[0]?.price, null);
  assert.equal(unconfiguredResult.items[0]?.reason, "provider_unconfigured");
});

test("asset limits and provider batch limits are enforced", async () => {
  let calls = 0;
  const seenBatchSizes: number[] = [];
  const provider: PriceProvider = {
    providerId: "test-provider",
    supportedQuoteCurrencies: ["USD"],
    maxBatchSize: 2,
    async fetchPrices(input) {
      calls += 1;
      seenBatchSizes.push(input.assets.length);
      return [];
    },
  };
  const entries = [
    asset("native", "ethereum"),
    asset("native", "bnb-smart-chain"),
    asset("native", "polygon"),
    asset("native", "arbitrum"),
  ];
  const mapping = mappings(
    "test-provider",
    entries.map((entry, index) => ({
      asset: entry,
      providerAssetId: `asset-${index}`,
    })),
  );
  await service(provider, mapping).getPrices({
    assetDescriptors: entries.map((entry) =>
      entry.kind === "native" ? `native:${entry.networkId}` : "",
    ),
    quoteCurrency: "USD",
  });
  assert.equal(calls, 2);
  assert.deepEqual(seenBatchSizes, [2, 2]);
  await assert.rejects(
    () =>
      service(provider, mapping).getPrices({
        assetDescriptors: [...entries, asset("native", "base")].map(
          (entry) => `native:${entry.networkId}`,
        ),
        quoteCurrency: "USD",
      }),
    /exceeds the limit/,
  );
});

test("disabled market data returns unavailable values without calling a provider", async () => {
  let called = false;
  const provider: PriceProvider = {
    providerId: "test-provider",
    supportedQuoteCurrencies: ["USD"],
    maxBatchSize: 2,
    async fetchPrices() {
      called = true;
      return [];
    },
  };
  const result = await new MarketPriceService(
    { ...config, enabled: false },
    provider,
    new StaticProviderAssetMappingRegistry([]),
  ).getPrices({
    assetDescriptors: ["native:ethereum"],
    quoteCurrency: "USD",
  });
  assert.equal(called, false);
  assert.equal(result.items[0]?.reason, "market_disabled");
  assert.equal(result.items[0]?.availability, "unavailable");
});