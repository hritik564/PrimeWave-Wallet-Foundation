import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";
import { ConfigurationError, loadConfig } from "./config";
import { HttpError } from "./lib/errors";
import { sanitizeForLog } from "./lib/logger";
import { MemoryRateLimiter } from "./lib/rate-limit";
import { assertNoSecretMaterial, secretMaterialGuard } from "./lib/security";

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