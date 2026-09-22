import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  publicTokenMetadataTable,
} from "@workspace/db/schema";
import { createApp } from "./app";
import { ConfigurationError, loadConfig } from "./config";
import { HttpError } from "./lib/errors";
import { sanitizeForLog } from "./lib/logger";
import { MemoryRateLimiter } from "./lib/rate-limit";
import { assertNoSecretMaterial, secretMaterialGuard } from "./lib/security";
import {
  InMemoryMetadataRepository,
} from "./metadata/repository";
import type { StoredTokenMetadata } from "./metadata/types";
import { normalizeEvmAddress } from "./metadata/validation";

async function withServer(
  app: ReturnType<typeof createApp>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function testConfig(
  overrides: NodeJS.ProcessEnv = {},
): ReturnType<typeof loadConfig> {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "5000",
    ...overrides,
  });
}

const sampleToken: StoredTokenMetadata = {
  networkId: "ethereum",
  contractAddress: "0x1111111111111111111111111111111111111111",
  name: "Example Token",
  symbol: "EXT",
  decimals: 18,
  description: "Metadata fixture only.",
  logoReference: "https://assets.example/logo.png",
  logoProvenance: "registry",
  metadataStatus: "partial",
  provenance: "registry",
  provenanceReference: "registry-entry-1",
  verificationStatus: "unverified",
  discoveryStatus: "not_discovered",
  visibility: "public",
  trustStatus: "unassessed",
  freshnessStatus: "cached",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("configuration separates environments and requires production database configuration", () => {
  assert.equal(testConfig().environment, "test");
  assert.equal(testConfig().databaseUrl, null);
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "8080",
        CORS_ALLOWED_ORIGINS: "https://wallet.example",
      }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.message.includes("DATABASE_URL"),
  );
  assert.equal(testConfig({ REQUEST_BODY_LIMIT: "512kb" }).requestBodyLimit, "512kb");
  assert.throws(
    () => testConfig({ REQUEST_BODY_LIMIT: "2mb" }),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.message.includes("cannot exceed"),
  );
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "8080",
        DATABASE_URL: "https://not-postgres.example",
      }),
    ConfigurationError,
  );
});

test("health, readiness, and version endpoints use the versioned API namespace", async () => {
  await withServer(createApp(testConfig()), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/v1/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const readiness = await fetch(`${baseUrl}/api/v1/readyz`);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), {
      status: "ready",
      checks: { database: "not_configured" },
    });

    const version = await fetch(`${baseUrl}/api/v1/version`);
    assert.equal(version.status, 200);
    assert.deepEqual(await version.json(), {
      apiVersion: "v1",
      service: "wavex-api",
    });

    const legacyHealth = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(legacyHealth.status, 200);
  });
});

test("malformed JSON and oversized requests are rejected with sanitized errors", async () => {
  const config = testConfig({ REQUEST_BODY_LIMIT: "64b" });
  await withServer(createApp(config), async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/v1/version`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "test-request" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: {
        code: "INVALID_JSON",
        message: "The request body is not valid JSON.",
        requestId: "test-request",
      },
    });

    const oversized = await fetch(`${baseUrl}/api/v1/version`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) }),
    });
    assert.equal(oversized.status, 413);
    const oversizedBody = (await oversized.json()) as {
      error: { code: string };
    };
    assert.equal(oversizedBody.error.code, "REQUEST_TOO_LARGE");
  });
});

test("secret-shaped fields are rejected, including nested fields, without echoing the field", async () => {
  await withServer(createApp(testConfig()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/version`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { nested: { seed_phrase: "synthetic" } } }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      error: { code: string };
    };
    assert.deepEqual(body.error.code, "PROHIBITED_SECRET_MATERIAL");
    assert.equal(JSON.stringify(body).includes("seed_phrase"), false);
    assert.equal(JSON.stringify(body).includes("synthetic"), false);
  });
});

test("content type, CORS, security headers, and request IDs are bounded", async () => {
  const config = testConfig({
    CORS_ALLOWED_ORIGINS: "https://wallet.example",
  });
  await withServer(createApp(config), async (baseUrl) => {
    const unsupported = await fetch(`${baseUrl}/api/v1/version`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-request-id": "req-123" },
      body: "data",
    });
    assert.equal(unsupported.status, 415);
    const unsupportedBody = (await unsupported.json()) as {
      error: { requestId: string };
    };
    assert.equal(unsupportedBody.error.requestId, "req-123");
    assert.equal(unsupported.headers.get("x-content-type-options"), "nosniff");

    const cors = await fetch(`${baseUrl}/api/v1/healthz`, {
      headers: { origin: "https://wallet.example" },
    });
    assert.equal(cors.headers.get("access-control-allow-origin"), "https://wallet.example");

    const deniedCors = await fetch(`${baseUrl}/api/v1/healthz`, {
      headers: { origin: "https://untrusted.example" },
    });
    assert.equal(deniedCors.headers.get("access-control-allow-origin"), null);
  });
});

test("rate limiter uses a server-observed connection key and returns bounded retry information", () => {
  let now = 1000;
  const limiter = new MemoryRateLimiter(1000, 2, () => now);
  assert.deepEqual(limiter.check("server-address"), {
    allowed: true,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(limiter.check("server-address"), {
    allowed: true,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(limiter.check("server-address"), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  now = 2001;
  assert.equal(limiter.check("server-address").allowed, true);
});

test("rate limiter removes expired buckets and fails closed at bounded capacity", async () => {
  let now = 1_000;
  const limiter = new MemoryRateLimiter(1_000, 100, () => now, 3);
  for (const key of ["one", "two", "three"]) {
    assert.equal(limiter.check(key).allowed, true);
  }
  assert.equal(limiter.keyCount, 3);
  assert.equal(limiter.check("attacker-unique-key").allowed, false);
  assert.equal(limiter.keyCount, 3);
  assert.equal(limiter.check("one").allowed, true);

  now = 2_001;
  assert.equal(limiter.keyCount, 3);
  assert.equal(limiter.check("fresh-key").allowed, true);
  assert.equal(limiter.keyCount, 1);

  const results = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      Promise.resolve(limiter.check(`flood-${index}`)),
    ),
  );
  assert.equal(results.filter((result) => result.allowed).length, 2);
  assert.equal(limiter.keyCount, 3);
});

test("logger redaction bounds nested diagnostics and never includes sensitive values", () => {
  const sanitized = sanitizeForLog({
    authorization: "Bearer synthetic-token",
    databaseUrl: "postgresql://user:password@db.example/wavex",
    nested: { pin: "123456", description: "x".repeat(600) },
  }) as Record<string, unknown>;
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.databaseUrl, "[REDACTED]");
  assert.deepEqual(sanitized.nested, {
    pin: "[REDACTED]",
    description: `${"x".repeat(512)}…`,
  });
});

test("secret guard runs before a persistence callback can receive request data", () => {
  const request = {
    body: { account: { vaultKey: "synthetic" } },
    query: {},
    params: {},
  } as never;
  let persistenceCalled = false;
  assert.throws(
    () =>
      secretMaterialGuard(request, {} as never, () => {
        persistenceCalled = true;
      }),
    (error: unknown) =>
      error instanceof HttpError && error.code === "PROHIBITED_SECRET_MATERIAL",
  );
  assert.equal(persistenceCalled, false);
  assert.throws(
    () => assertNoSecretMaterial({ ordinary: { private_key: "synthetic" } }),
    HttpError,
  );
});

test("public network metadata preserves the PrimeWave placeholder and omits RPC URLs", async () => {
  await withServer(createApp(testConfig()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/metadata/networks`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Array<{
        networkId: string;
        chainId: number | null;
        nativeCurrency: { symbol: string };
        configurationStatus: string;
      }>;
    };
    const primeWave = body.data.find((network) => network.networkId === "primewave");
    assert.equal(primeWave?.networkId, "primewave");
    assert.equal(primeWave?.chainId, null);
    assert.equal(primeWave?.nativeCurrency.symbol, "TBD");
    assert.equal(primeWave?.configurationStatus, "placeholder");
    assert.equal(JSON.stringify(body).includes("publicnode"), false);
  });
});

test("token identity normalization is deterministic and duplicate identities are rejected", () => {
  const address = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
  const normalized = normalizeEvmAddress(address);
  assert.equal(normalized, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  const repository = new InMemoryMetadataRepository();
  repository.addToken({ ...sampleToken, contractAddress: normalized });
  assert.throws(
    () =>
      repository.addToken({
        ...sampleToken,
        contractAddress: address,
      }),
    /DUPLICATE_METADATA_IDENTITY/,
  );
});

test("public token schema keeps identity unique and contains no secret-bearing columns", () => {
  const table = getTableConfig(publicTokenMetadataTable);
  const columnNames = table.columns.map((column) => column.name);
  assert.equal(
    columnNames.some((name) => /seed|mnemonic|private|pin|secret|vault|key/i.test(name)),
    false,
  );
  assert.equal(
    table.indexes.some(
      (index) => index.config.name === "public_token_metadata_identity_idx",
    ),
    true,
  );
  assert.equal(table.checks.length, 2);
});

test("metadata endpoints distinguish partial, unavailable, provenance, and verification", async () => {
  const repository = new InMemoryMetadataRepository();
  repository.addToken(sampleToken);
  await withServer(createApp(testConfig(), repository), async (baseUrl) => {
    const single = await fetch(
      `${baseUrl}/api/v1/metadata/tokens/ethereum/0x${sampleToken.contractAddress.slice(2).toUpperCase()}`,
    );
    assert.equal(single.status, 200);
    const singleBody = (await single.json()) as {
      data: {
        metadataStatus: string;
        verificationStatus: string;
        provenance: { source: string };
        logo: { provenance: string } | null;
      };
    };
    assert.equal(singleBody.data.metadataStatus, "partial");
    assert.equal(singleBody.data.verificationStatus, "unverified");
    assert.equal(singleBody.data.provenance.source, "registry");
    assert.equal(singleBody.data.logo?.provenance, "registry");

    const batch = await fetch(
      `${baseUrl}/api/v1/metadata/tokens?networkId=ethereum&addresses=${sampleToken.contractAddress},0x2222222222222222222222222222222222222222`,
    );
    assert.equal(batch.status, 200);
    const batchBody = (await batch.json()) as {
      data: Array<{ metadataStatus: string; contractAddress: string }>;
      count: number;
      requested: number;
    };
    assert.equal(batchBody.count, 2);
    assert.equal(batchBody.requested, 2);
    assert.deepEqual(
      batchBody.data.map((token) => token.metadataStatus),
      ["partial", "unavailable"],
    );
    assert.equal(
      batchBody.data[1]?.contractAddress,
      "0x2222222222222222222222222222222222222222",
    );
  });
});

test("logo references are bounded and never become a server-side fetch target", async () => {
  const repository = new InMemoryMetadataRepository();
  repository.addToken({
    ...sampleToken,
    contractAddress: "0x3333333333333333333333333333333333333333",
    logoReference: "javascript:alert(1)",
    logoProvenance: "user_provided",
    provenanceReference: "https://provider.example/metadata?secret=not-a-fetch-target",
  });
  await withServer(createApp(testConfig(), repository), async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/metadata/tokens/ethereum/0x3333333333333333333333333333333333333333`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: {
        logo: unknown;
        provenance: { reference: string | null };
      };
    };
    assert.equal(body.data.logo, null);
    assert.equal(body.data.provenance.reference, null);
  });
});

test("metadata reads reject invalid networks, invalid addresses, and oversized batches", async () => {
  await withServer(createApp(testConfig()), async (baseUrl) => {
    const invalidNetwork = await fetch(
      `${baseUrl}/api/v1/metadata/tokens/not-supported/0x1111111111111111111111111111111111111111`,
    );
    assert.equal(invalidNetwork.status, 400);
    const invalidNetworkBody = (await invalidNetwork.json()) as {
      error: { code: string };
    };
    assert.equal(invalidNetworkBody.error.code, "INVALID_NETWORK");

    const invalidAddress = await fetch(
      `${baseUrl}/api/v1/metadata/tokens/ethereum/not-an-address`,
    );
    assert.equal(invalidAddress.status, 400);
    const invalidAddressBody = (await invalidAddress.json()) as {
      error: { code: string };
    };
    assert.equal(invalidAddressBody.error.code, "INVALID_PATH");

    const tooMany = Array.from(
      { length: 51 },
      (_, index) =>
        `0x${(index + 1).toString(16).padStart(40, "0")}`,
    ).join(",");
    const oversizedBatch = await fetch(
      `${baseUrl}/api/v1/metadata/tokens?networkId=ethereum&addresses=${tooMany}`,
    );
    assert.equal(oversizedBatch.status, 400);
    const oversizedBatchBody = (await oversizedBatch.json()) as {
      error: { code: string };
    };
    assert.equal(oversizedBatchBody.error.code, "INVALID_QUERY");
  });
});