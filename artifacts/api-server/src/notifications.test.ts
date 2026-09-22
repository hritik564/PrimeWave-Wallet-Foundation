import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  notificationDeliveriesTable,
  notificationDevicesTable,
  notificationEventsTable,
  notificationPreferencesTable,
} from "@workspace/db/schema";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { sanitizeForLog } from "./lib/logger";
import {
  InMemoryNotificationRepository,
} from "./notifications/repository";
import { NotificationProviderError } from "./notifications/errors";
import { NotificationService } from "./notifications/service";
import { DeterministicMockNotificationProvider } from "./notifications/provider";

const ACCOUNT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const scope = {
  networkId: "ethereum-sepolia",
  chainId: 11155111,
  accountAddress: ACCOUNT_A,
};

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

async function register(
  baseUrl: string,
  accountAddress = ACCOUNT_A,
  deviceIdentifier = "installation-a",
) {
  return fetch(`${baseUrl}/api/v1/notifications/devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      networkId: scope.networkId,
      chainId: scope.chainId,
      accountAddress,
      deviceIdentifier,
      platform: "ios",
      pushToken: "sensitive-token-value",
      appVersion: "1.0.0",
      environment: "testnet",
    }),
  });
}

function eventInput(
  overrides: Partial<{
    notificationEventId: string;
    eventType:
      | "transaction_confirmed"
      | "transaction_reverted"
      | "incoming_transaction"
      | "swap_completed"
      | "security_event";
    transactionHash: string | null;
    logIndex: number | null;
  }> = {},
) {
  return {
    ...scope,
    notificationEventId: overrides.notificationEventId ?? "event-1",
    eventType: overrides.eventType ?? "transaction_confirmed",
    transactionHash:
      overrides.transactionHash ??
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    logIndex: overrides.logIndex,
    eventTimestamp: "2026-09-22T00:00:00.000Z",
    source: "synthetic-test",
  } as const;
}

test("device API stores registrations without returning push tokens and isolates scopes", async () => {
  const repository = new InMemoryNotificationRepository();
  await withServer(createApp(testConfig(), undefined, repository), async (baseUrl) => {
    const registration = await register(baseUrl);
    assert.equal(registration.status, 201);
    const body = (await registration.json()) as { data: Record<string, unknown> };
    assert.equal(body.data.accountAddress, ACCOUNT_A);
    assert.equal("pushToken" in body.data, false);
    assert.equal("deviceIdentifier" in body.data, false);
    assert.equal(JSON.stringify(body).includes("sensitive-token-value"), false);

    const otherAccount = await fetch(
      `${baseUrl}/api/v1/notifications/preferences?networkId=${scope.networkId}&chainId=${scope.chainId}&accountAddress=${ACCOUNT_B}`,
    );
    assert.equal(otherAccount.status, 200);
    const otherPrefs = (await otherAccount.json()) as { data: { accountAddress: string } };
    assert.equal(otherPrefs.data.accountAddress, ACCOUNT_B);
    assert.equal(
      (await repository.listDevices({ ...scope, accountAddress: ACCOUNT_B })).length,
      0,
    );
  });
});

test("preferences default to disabled and update only the requested account scope", async () => {
  const repository = new InMemoryNotificationRepository();
  await withServer(createApp(testConfig(), undefined, repository), async (baseUrl) => {
    const query = `networkId=${scope.networkId}&chainId=${scope.chainId}&accountAddress=${ACCOUNT_A}`;
    const defaults = await fetch(`${baseUrl}/api/v1/notifications/preferences?${query}`);
    const defaultBody = (await defaults.json()) as { data: Record<string, unknown> };
    assert.deepEqual(
      { ...defaultBody.data, updatedAt: undefined },
      {
        ...scope,
        transactionConfirmations: false,
        incomingTransactions: false,
        transactionFailures: false,
        swaps: false,
        securityEvents: false,
        updatedAt: undefined,
      },
    );

    const updated = await fetch(`${baseUrl}/api/v1/notifications/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...scope,
        transactionConfirmations: true,
        incomingTransactions: false,
        transactionFailures: true,
        swaps: false,
        securityEvents: false,
      }),
    });
    assert.equal(updated.status, 200);
    const updatedBody = (await updated.json()) as {
      data: { transactionConfirmations: boolean; transactionFailures: boolean };
    };
    assert.equal(updatedBody.data.transactionConfirmations, true);
    assert.equal(updatedBody.data.transactionFailures, true);
    assert.equal(
      (await repository.getPreferences({ ...scope, accountAddress: ACCOUNT_B }))
        .transactionConfirmations,
      false,
    );
  });
});

test("notification event identities deduplicate transactions and distinguish ERC-20 log indexes", async () => {
  const repository = new InMemoryNotificationRepository();
  const config = testConfig();
  const service = new NotificationService(config.notifications, repository);
  await service.registerDevice({
    ...scope,
    deviceIdentifier: "installation-a",
    platform: "ios",
    pushToken: "token",
    appVersion: "1",
    environment: "testnet",
  });
  await service.updatePreferences(scope, {
    transactionConfirmations: true,
    incomingTransactions: true,
    transactionFailures: false,
    swaps: false,
    securityEvents: false,
  });

  const first = await service.createEvent(eventInput({ notificationEventId: "event-a" }));
  const duplicate = await service.createEvent(
    eventInput({ notificationEventId: "event-b" }),
  );
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.notificationEventId, "event-a");

  const transferOne = await service.createEvent(
    eventInput({
      notificationEventId: "transfer-1",
      eventType: "incoming_transaction",
      logIndex: 1,
    }),
  );
  const transferTwo = await service.createEvent(
    eventInput({
      notificationEventId: "transfer-2",
      eventType: "incoming_transaction",
      logIndex: 2,
    }),
  );
  assert.equal(transferOne.duplicate, false);
  assert.equal(transferTwo.duplicate, false);
});

test("delivery retries are bounded and permanent provider failures do not retry", async () => {
  const repository = new InMemoryNotificationRepository();
  const config = testConfig({
    NOTIFICATIONS_MAX_ATTEMPTS: "2",
    NOTIFICATIONS_MAX_BACKOFF_MS: "1000",
  });
  const service = new NotificationService(config.notifications, repository);
  await service.registerDevice({
    ...scope,
    deviceIdentifier: "installation-a",
    platform: "android",
    pushToken: "token",
    appVersion: "1",
    environment: "testnet",
  });
  await service.updatePreferences(scope, {
    transactionConfirmations: true,
    incomingTransactions: false,
    transactionFailures: false,
    swaps: false,
    securityEvents: false,
  });
  await service.createEvent(eventInput());

  const transientProvider = {
    providerId: "test-transient",
    maxPayloadBytes: 4096,
    async send(): Promise<never> {
      throw new NotificationProviderError("TIMEOUT", "provider detail must not escape");
    },
  };
  const firstNow = new Date();
  const first = await service.processNextDelivery(transientProvider, firstNow);
  assert.equal(first.state, "retrying");
  const second = await service.processNextDelivery(
    transientProvider,
    new Date(firstNow.getTime() + 1000),
  );
  assert.equal(second.state, "failed");
  assert.equal((await repository.countPendingDeliveries()), 0);
  assert.equal(
    (await service.processNextDelivery(
      transientProvider,
      new Date(firstNow.getTime() + 3000),
    )).state,
    "empty",
  );

  const permanentRepository = new InMemoryNotificationRepository();
  const permanentService = new NotificationService(config.notifications, permanentRepository);
  await permanentService.registerDevice({
    ...scope,
    deviceIdentifier: "installation-a",
    platform: "ios",
    pushToken: "token",
    appVersion: "1",
    environment: "testnet",
  });
  await permanentService.updatePreferences(scope, {
    transactionConfirmations: true,
    incomingTransactions: false,
    transactionFailures: false,
    swaps: false,
    securityEvents: false,
  });
  await permanentService.createEvent(eventInput());
  const permanentProvider = {
    providerId: "test-permanent",
    maxPayloadBytes: 4096,
    async send(): Promise<never> {
      throw new NotificationProviderError("INVALID_TOKEN", "token must not escape");
    },
  };
  assert.equal(
    (await permanentService.processNextDelivery(permanentProvider, new Date())).state,
    "failed",
  );
  const permanentDelivery = permanentRepository.getDeliveriesForTests()[0];
  assert.equal(permanentDelivery?.lastErrorMessage, "The registered device token is invalid.");
  assert.equal(permanentDelivery?.lastErrorMessage?.includes("token"), true);
  assert.equal(permanentDelivery?.lastErrorMessage?.includes("sensitive-token-value"), false);
});

test("disabled registrations cannot receive queued notifications and mock delivery is explicit", async () => {
  const repository = new InMemoryNotificationRepository();
  const service = new NotificationService(testConfig().notifications, repository);
  const device = await service.registerDevice({
    ...scope,
    deviceIdentifier: "installation-a",
    platform: "web",
    pushToken: "token",
    appVersion: "1",
    environment: "testnet",
  });
  await service.updatePreferences(scope, {
    transactionConfirmations: true,
    incomingTransactions: false,
    transactionFailures: false,
    swaps: false,
    securityEvents: false,
  });
  await service.unregisterDevice(scope, device.registrationId);
  await service.createEvent(eventInput());
  assert.equal(
    (await service.processNextDelivery(new DeterministicMockNotificationProvider())).state,
    "empty",
  );
});

test("notification schema has scoped uniqueness and no secret-bearing columns", () => {
  for (const table of [
    notificationDevicesTable,
    notificationPreferencesTable,
    notificationEventsTable,
    notificationDeliveriesTable,
  ]) {
    const names = getTableConfig(table).columns.map((column) => column.name);
    assert.equal(
      names.some((name) => /private|seed|mnemonic|pin|vault|secret|credential/i.test(name)),
      false,
    );
  }
  assert.equal(
    getTableConfig(notificationDevicesTable).indexes.some(
      (index) => index.config.name === "notification_devices_scope_identifier_idx",
    ),
    true,
  );
  assert.equal(
    getTableConfig(notificationEventsTable).indexes.some(
      (index) => index.config.name === "notification_events_scope_deduplication_idx",
    ),
    true,
  );
});

test("notification logs and provider failures redact infrastructure identifiers", () => {
  const sanitized = sanitizeForLog({
    pushToken: "sensitive-token-value",
  }) as Record<string, unknown>;
  assert.equal(sanitized.pushToken, "[REDACTED]");
});