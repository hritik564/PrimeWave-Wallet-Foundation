import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  analyticsErrorsTable,
  analyticsEventsTable,
  analyticsPerformanceTable,
} from "@workspace/db/schema";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { InMemoryAnalyticsRepository } from "./analytics/repository";
import { DeterministicMockAnalyticsProvider } from "./analytics/provider";
import { AnalyticsService } from "./analytics/service";
import {
  normalizeAnalyticsEvent,
  type AnalyticsEventInput,
} from "./analytics/validation";
import type { AnalyticsProvider } from "./analytics/types";

const anonymousId = "installation_1234567890123456789012";

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "5000",
    ...overrides,
  });
}

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

function eventInput(
  overrides: Partial<AnalyticsEventInput> = {},
): AnalyticsEventInput {
  return {
    eventId: "event-1234567890",
    eventName: "app_opened",
    eventVersion: 1,
    anonymousId,
    identityScope: "installation",
    timestamp: "2026-09-22T00:00:00.000Z",
    appVersion: "1.0.0",
    platform: "ios",
    environment: "testnet",
    properties: {},
    ...overrides,
  } as AnalyticsEventInput;
}

test("analytics API accepts only allowlisted events and returns minimal responses", async () => {
  const repository = new InMemoryAnalyticsRepository();
  const provider = new DeterministicMockAnalyticsProvider();
  const config = testConfig();
  await withServer(
    createApp(config, undefined, undefined, repository, provider),
    async (baseUrl) => {
      const accepted = await fetch(`${baseUrl}/api/v1/analytics/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventInput()),
      });
      assert.equal(accepted.status, 202);
      const responseBody = (await accepted.json()) as { data: Record<string, unknown> };
      assert.deepEqual(responseBody, { data: { accepted: true } });
      assert.equal(provider.events.length, 1);
      assert.equal(provider.events[0]?.anonymousId, anonymousId);

      const unknownEvent = await fetch(`${baseUrl}/api/v1/analytics/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventInput({ eventName: "wallet_opened" } as never)),
      });
      assert.equal(unknownEvent.status, 400);

      const prohibitedProperty = await fetch(`${baseUrl}/api/v1/analytics/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          eventInput({
            eventName: "screen_viewed",
            properties: { walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          } as never),
        ),
      });
      assert.equal(prohibitedProperty.status, 400);
      assert.equal(repository.events.size, 1);
    },
  );
});

test("analytics rejects oversized payloads and oversized batches", async () => {
  const repository = new InMemoryAnalyticsRepository();
  const config = testConfig({
    ANALYTICS_MAX_EVENT_PAYLOAD_BYTES: "128",
    ANALYTICS_MAX_BATCH_EVENTS: "1",
  });
  await withServer(
    createApp(
      config,
      undefined,
      undefined,
      repository,
      new DeterministicMockAnalyticsProvider(),
    ),
    async (baseUrl) => {
      const oversized = await fetch(`${baseUrl}/api/v1/analytics/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventInput()),
      });
      assert.equal(oversized.status, 413);

      const batch = await fetch(`${baseUrl}/api/v1/analytics/events/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [eventInput(), eventInput({ eventId: "event-2234567890" })] }),
      });
      assert.equal(batch.status, 400);
    },
  );
});

test("analytics ingestion is rate limited", async () => {
  const config = testConfig({
    RATE_LIMIT_MAX_REQUESTS: "1",
    RATE_LIMIT_WINDOW_MS: "60000",
  });
  await withServer(
    createApp(
      config,
      undefined,
      undefined,
      new InMemoryAnalyticsRepository(),
      new DeterministicMockAnalyticsProvider(),
    ),
    async (baseUrl) => {
      const request = () =>
        fetch(`${baseUrl}/api/v1/analytics/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(eventInput()),
        });
      assert.equal((await request()).status, 202);
      assert.equal((await request()).status, 429);
    },
  );
});

test("analytics admission bounds identities, events, global intake, and expiry", async () => {
  let now = new Date("2026-09-22T00:00:00.000Z");
  const config = testConfig({
    ANALYTICS_ABUSE_WINDOW_MS: "1000",
    ANALYTICS_MAX_ANONYMOUS_IDENTITIES: "2",
    ANALYTICS_MAX_EVENTS_PER_IDENTITY: "2",
    ANALYTICS_MAX_TOTAL_EVENTS: "3",
  });
  const service = new AnalyticsService(
    config.analytics,
    new InMemoryAnalyticsRepository(),
    new DeterministicMockAnalyticsProvider(),
    () => now,
  );
  const ingest = (eventId: string, identity: string) =>
    service.ingestEvent(
      eventInput({ eventId, anonymousId: identity } as never),
    );
  const identityB = `installation_${"b".repeat(22)}`;
  const identityC = `installation_${"c".repeat(22)}`;

  assert.equal((await ingest("event-identity-a-1", anonymousId)).accepted, true);
  assert.equal((await ingest("event-identity-a-2", anonymousId)).accepted, true);
  await assert.rejects(
    () => ingest("event-identity-a-3", anonymousId),
    /temporarily rate limited/i,
  );
  assert.equal(
    service.admissionIdentityCount,
    1,
  );
  assert.equal(
    (await ingest("event-identity-b-1", identityB))
      .accepted,
    true,
  );
  await assert.rejects(
    () => ingest("event-identity-c-1", identityC),
    /capacity|temporarily rate limited/i,
  );

  now = new Date(now.getTime() + 1_001);
  assert.equal(
    (await ingest("event-identity-c-2", identityC))
      .accepted,
    true,
  );
  assert.equal(service.admissionIdentityCount, 1);
});

test("anonymous identity is random-scoped and never wallet-derived", () => {
  assert.throws(
    () =>
      normalizeAnalyticsEvent(
        eventInput({
          anonymousId: "installation_0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        } as never),
      ),
    /invalid/i,
  );
  assert.throws(
    () =>
      normalizeAnalyticsEvent(
        eventInput({
          identityScope: "session",
        }),
      ),
    /invalid/i,
  );
});

test("secret-shaped analytics fields are rejected before normalization", () => {
  for (const field of [
    "privateKey",
    "mnemonic",
    "seedPhrase",
    "walletPin",
    "SecureStore",
    "SecureVault",
    "signingKey",
    "signature",
    "rawTransaction",
    "calldata",
    "transactionHash",
    "pushToken",
    "apiKey",
    "authorization",
    "cookie",
    "ip",
  ]) {
    assert.throws(
      () =>
        normalizeAnalyticsEvent({
          ...eventInput(),
          properties: { [field]: "redacted" },
        } as never),
      /prohibited|invalid/i,
    );
  }
});

test("provider failures do not break ingestion, error telemetry, or performance telemetry", async () => {
  const repository = new InMemoryAnalyticsRepository();
  const failingProvider: AnalyticsProvider = {
    providerId: "failing-test-provider",
    configured: true,
    async trackEvent(): Promise<never> {
      throw new Error("provider detail must not escape");
    },
    async trackError(): Promise<never> {
      throw new Error("provider detail must not escape");
    },
    async trackPerformance(): Promise<never> {
      throw new Error("provider detail must not escape");
    },
  };
  const service = new AnalyticsService(testConfig().analytics, repository, failingProvider);
  const result = await service.ingestEvent(eventInput());
  assert.equal(result.accepted, true);
  assert.equal(result.delivery, "provider_failed");
  await service.recordError({
    errorCategory: "network",
    errorCode: "RPC_UNAVAILABLE",
    area: "rpc",
    operation: "read_balance",
    platform: "ios",
    appVersion: "1.0.0",
    environment: "testnet",
    durationBucket: "1_5s",
  });
  await service.recordPerformance({
    metricName: "rpc_latency",
    valueBucket: "1_5s",
    area: "rpc",
    operation: "read_balance",
    platform: "ios",
    appVersion: "1.0.0",
    environment: "testnet",
  });
  assert.equal(repository.events.size, 1);
  assert.equal(repository.errors.size, 1);
  assert.equal(repository.performance.size, 1);
});

test("analytics persistence failures are isolated from callers", async () => {
  const failingRepository = {
    configured: true,
    async insertEvent(): Promise<{ inserted: boolean }> {
      throw new Error("database unavailable");
    },
    async insertError(): Promise<{ inserted: boolean }> {
      throw new Error("database unavailable");
    },
    async insertPerformance(): Promise<{ inserted: boolean }> {
      throw new Error("database unavailable");
    },
    async deleteExpired() {
      return { events: 0, errors: 0, performance: 0 };
    },
  };
  const service = new AnalyticsService(
    testConfig().analytics,
    failingRepository,
    new DeterministicMockAnalyticsProvider(),
  );
  const eventResult = await service.ingestEvent(eventInput());
  assert.equal(eventResult.accepted, false);
  await service.recordError({
    errorCategory: "storage",
    errorCode: "UNAVAILABLE",
    area: "analytics",
    operation: "persist_error",
    platform: "web",
    appVersion: "1.0.0",
    environment: "testnet",
  });
  await service.recordPerformance({
    metricName: "backend_request_latency",
    valueBucket: "1_5s",
    area: "analytics",
    operation: "persist_performance",
    platform: "web",
    appVersion: "1.0.0",
    environment: "testnet",
  });
});

test("retention cleanup is bounded and the unconfigured runtime is explicit", async () => {
  const repository = new InMemoryAnalyticsRepository();
  const config = testConfig({ ANALYTICS_EVENT_RETENTION_MS: "1" });
  const service = new AnalyticsService(
    config.analytics,
    repository,
    new DeterministicMockAnalyticsProvider(),
  );
  const result = await service.ingestEvent(eventInput());
  assert.equal(result.accepted, true);
  const cleaned = await service.cleanupExpired(new Date(Date.now() + 2));
  assert.equal(cleaned.events, 1);
  const concurrentCleanup = await Promise.all([
    service.cleanupExpired(new Date(Date.now() + 2)),
    service.cleanupExpired(new Date(Date.now() + 2)),
  ]);
  assert.equal(concurrentCleanup[0]?.events, 0);
  assert.equal(concurrentCleanup[1]?.events, 0);

  const unconfigured = new AnalyticsService(
    config.analytics,
    new (class extends InMemoryAnalyticsRepository {
      override readonly configured = false;
    })(),
  );
  const unconfiguredResult = await unconfigured.ingestEvent(eventInput());
  assert.equal(unconfiguredResult.accepted, false);
  assert.equal(unconfiguredResult.delivery, "unconfigured");
});

test("analytics persistence has no wallet, blockchain, notification, or credential columns", () => {
  for (const table of [
    analyticsEventsTable,
    analyticsErrorsTable,
    analyticsPerformanceTable,
  ]) {
    const names = getTableConfig(table).columns.map((column) => column.name);
    assert.equal(
      names.some((name) =>
        /(wallet|address|transaction|hash|calldata|signature|token|credential|secret|private|mnemonic|seed|pin|vault|authorization|cookie|ip)/i.test(
          name,
        ),
      ),
      false,
    );
  }
});