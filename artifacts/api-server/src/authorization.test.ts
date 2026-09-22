import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { SynchronizationService } from "./synchronization/service";
import { createSynchronizationRouter } from "./synchronization/router";
import { errorHandler } from "./lib/errors";
import {
  AuthorizationError,
  type AccountAuthorizationBoundary,
} from "./lib/auth-boundary";
import { createApp } from "./app";
import { loadConfig } from "./config";

const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ACCOUNT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const scope = {
  networkId: "ethereum-sepolia",
  chainId: 11155111,
  accountAddress: ACCOUNT,
};

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "5000",
  });
}

function authorizationFor(
  allowedScope = scope,
): AccountAuthorizationBoundary {
  return {
    authorize: (_request, requestedScope) => {
      if (
        requestedScope.networkId !== allowedScope.networkId ||
        requestedScope.chainId !== allowedScope.chainId ||
        requestedScope.accountAddress !== allowedScope.accountAddress
      ) {
        throw new AuthorizationError(
          "UNAUTHORIZED_SCOPE",
          403,
          "The requested account scope is not authorized.",
        );
      }
      return {
        principal: {
          subject: "test-principal",
          authenticationMethod: "future",
        },
        scope: requestedScope,
      };
    },
  };
}

async function withServer(
  app: express.Express,
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

function protectedScopeQuery(accountAddress = ACCOUNT) {
  return `networkId=${scope.networkId}&chainId=${scope.chainId}&accountAddress=${accountAddress}`;
}

test("all synchronization account routes reject missing authentication on both mounts", async () => {
  const app = createApp(testConfig());
  const routes = [
    {
      method: "GET",
      path: `/synchronization/status?${protectedScopeQuery()}`,
    },
    {
      method: "GET",
      path: `/synchronization/activity?${protectedScopeQuery()}&startBlock=1&endBlock=2`,
    },
    {
      method: "GET",
      path: `/synchronization/reconciliation?${protectedScopeQuery()}&startBlock=1&endBlock=2`,
    },
    {
      method: "POST",
      path: "/synchronization/checkpoint",
      body: {
        ...scope,
        chainId: String(scope.chainId),
        startBlock: "1",
        endBlock: "2",
      },
    },
  ] as const;

  await withServer(app, async (baseUrl) => {
    for (const prefix of ["/api/v1", "/api"]) {
      for (const route of routes) {
        const response = await fetch(`${baseUrl}${prefix}${route.path}`, {
          method: route.method,
          headers: route.method === "POST"
            ? { "content-type": "application/json" }
            : undefined,
          body: route.method === "POST" ? JSON.stringify(route.body) : undefined,
        });
        assert.equal(response.status, 401);
        const body = (await response.json()) as { error: { code: string } };
        assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
      }
    }
  });
});

test("authorized synchronization access uses the authorized normalized scope", async () => {
  let observedScope: unknown;
  const service = {
    async getStatus(requestedScope: typeof scope) {
      observedScope = requestedScope;
      return {
        enabled: true,
        scope: requestedScope,
        configured: true,
        status: "idle",
        lastSynchronizedBlock: null,
        lastSynchronizedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: null,
      };
    },
  } as unknown as SynchronizationService;
  const app = express();
  app.use(
    createSynchronizationRouter(
      testConfig(),
      service,
      authorizationFor(),
    ),
  );
  app.use(errorHandler);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/synchronization/status?${protectedScopeQuery(`0x${ACCOUNT.slice(2).toUpperCase()}`)}`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(observedScope, scope);
  });
});

test("synchronization rejects a different account scope before service access", async () => {
  let called = false;
  const service = {
    async getStatus() {
      called = true;
      throw new Error("service must not be called");
    },
  } as unknown as SynchronizationService;
  const app = express();
  app.use(
    createSynchronizationRouter(
      testConfig(),
      service,
      authorizationFor(),
    ),
  );
  app.use(errorHandler);

  await withServer(app, async (baseUrl) => {
    const scopes = [
      { ...scope, accountAddress: OTHER_ACCOUNT },
      { ...scope, networkId: "ethereum-mainnet" },
      { ...scope, chainId: 1 },
    ];
    for (const requested of scopes) {
      const response = await fetch(
        `${baseUrl}/synchronization/status?networkId=${requested.networkId}&chainId=${requested.chainId}&accountAddress=${requested.accountAddress}`,
      );
      assert.equal(response.status, 403);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "UNAUTHORIZED_SCOPE");
    }
    assert.equal(called, false);
  });
});