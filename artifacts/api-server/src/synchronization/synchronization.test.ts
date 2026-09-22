import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySynchronizationRepository } from "./repository";
import { SynchronizationError } from "./errors";
import { SynchronizationService } from "./service";
import type {
  IndexedTokenTransfer,
  IndexedTransaction,
} from "../indexing/types";

const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const THIRD = "0xcccccccccccccccccccccccccccccccccccccc";
const HASH_ONE = `0x${"1".repeat(64)}`;
const HASH_TWO = `0x${"2".repeat(64)}`;

function transaction(
  hash: string,
  blockNumber: bigint,
  from: string,
  to: string | null,
  status: IndexedTransaction["status"],
): IndexedTransaction {
  return {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    transactionHash: hash,
    blockNumber,
    blockHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
    from,
    to,
    value: "100",
    gas: "21000",
    gasPrice: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    nonce: blockNumber.toString(),
    input: "0x",
    transactionType: "0x0",
    timestamp: blockNumber,
    status,
    observedAt: new Date(0),
  };
}

function transfer(hash: string, blockNumber: bigint): IndexedTokenTransfer {
  return {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    tokenContractAddress: THIRD,
    from: ACCOUNT,
    to: OTHER,
    amountRaw: "123456789",
    blockNumber,
    blockHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    transactionHash: hash,
    logIndex: 0,
    timestamp: blockNumber,
    observedAt: new Date(0),
  };
}

function createService(
  repository = new InMemorySynchronizationRepository(),
  maxBlockRange = 10,
) {
  return {
    repository,
    service: new SynchronizationService(
      {
        enabled: true,
        networks: [
          {
            networkId: "ethereum-sepolia",
            chainId: 11155111,
            environment: "testnet",
            enabled: true,
            rpcUrl: "https://rpc.example",
          },
        ],
        bounds: {
          maxBlockRange,
          maxPageSize: 100,
          maxOffset: 1_000,
          maxErrorLength: 512,
        },
      },
      repository,
    ),
  };
}

async function seed() {
  const setup = createService();
  for (const block of [1n, 2n, 3n]) {
    setup.repository.addBlock("ethereum-sepolia", 11155111, block);
  }
  setup.repository.addTransaction(
    transaction(HASH_ONE, 1n, ACCOUNT, OTHER, "success"),
  );
  setup.repository.addTransaction(
    transaction(HASH_TWO, 2n, OTHER, ACCOUNT, "unknown"),
  );
  setup.repository.addTransaction(
    transaction(`0x${"3".repeat(64)}`, 1n, THIRD, OTHER, "success"),
  );
  setup.repository.addTransfer(transfer(HASH_ONE, 1n));
  return setup;
}

test("synchronization uses scoped deterministic identities and advances a bounded cursor", async () => {
  const { service, repository } = await seed();
  const scope = {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    accountAddress: ACCOUNT,
  };

  const first = await service.synchronizeRange(scope, 1n, 2n);
  const second = await service.synchronizeRange(scope, 1n, 2n);
  assert.equal(first.observations, 3);
  assert.equal(second.reconciliationRecords, 3);

  const page = await service.getActivity(scope, 1n, 2n, 10, 0);
  assert.deepEqual(
    page.items.map((item) => item.identity),
    [
      `ethereum-sepolia:${HASH_TWO}`,
      `ethereum-sepolia:${HASH_ONE}`,
      `ethereum-sepolia:${HASH_ONE}:0`,
    ],
  );
  assert.equal(page.items[0]?.reconciliationState, "unknown");
  assert.equal(page.items[1]?.reconciliationState, "confirmed");
  assert.equal(page.items[2]?.kind, "erc20_transfer");

  const status = await service.getStatus(scope);
  assert.equal(status.status, "completed");
  assert.equal(status.lastSynchronizedBlock, "2");
  assert.equal((await repository.listReconciliation(scope, 1n, 2n)).length, 3);
});

test("local-only, hash match, unresolved, and conflicting local context stay explicit", async () => {
  const { service } = await seed();
  const scope = {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    accountAddress: ACCOUNT,
  };

  const localOnly = await service.reconcileLocalActivity({
    scope,
    localActivityId: "local-1",
    localStatus: "broadcasted",
  });
  assert.equal(localOnly.state, "local_only");
  const localOnlyMatched = await service.reconcileLocalActivity({
    scope,
    localActivityId: "local-1",
    transactionHash: HASH_ONE,
    localStatus: "confirmed",
  });
  assert.equal(localOnlyMatched.state, "confirmed");
  assert.equal(localOnlyMatched.identity, `ethereum-sepolia:${HASH_ONE}`);

  const matched = await service.reconcileLocalActivity({
    scope,
    localActivityId: "local-2",
    transactionHash: HASH_ONE,
    localStatus: "confirming",
  });
  assert.equal(matched.state, "confirmed");
  assert.equal(matched.matchEvidence, "hash");

  const unresolved = await service.reconcileLocalActivity({
    scope,
    localActivityId: "local-3",
    transactionHash: `0x${"4".repeat(64)}`,
    localStatus: "unknown",
  });
  assert.equal(unresolved.state, "unresolved");

  const conflict = await service.reconcileLocalActivity({
    scope,
    localActivityId: "local-2",
    transactionHash: HASH_TWO,
    localStatus: "unknown",
  });
  assert.equal(conflict.state, "conflict");
  assert.equal(conflict.matchEvidence, "conflict");
});

test("account isolation, network isolation, and range limits fail closed", async () => {
  const { service } = await seed();
  const otherScope = {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    accountAddress: OTHER,
  };
  const otherActivity = await service.getActivity(otherScope, 1n, 2n, 10, 0);
  assert.ok(
    otherActivity.items.every((item) =>
      item.kind === "transaction"
        ? item.from === OTHER || item.to === OTHER
        : item.from === OTHER || item.to === OTHER,
    ),
  );
  await assert.rejects(
    () =>
      service.getStatus({
        networkId: "ethereum-mainnet",
        chainId: 1,
        accountAddress: ACCOUNT,
      }),
    (error: unknown) =>
      error instanceof SynchronizationError &&
      error.code === "CONFIGURATION_ERROR",
  );

  const { service: boundedService } = createService(undefined, 2);
  await assert.rejects(
    () =>
      boundedService.synchronizeRange(
        {
          networkId: "ethereum-sepolia",
          chainId: 11155111,
          accountAddress: ACCOUNT,
        },
        1n,
        3n,
      ),
    (error: unknown) =>
      error instanceof SynchronizationError && error.code === "RESPONSE_LIMIT",
  );
});

test("pagination remains bounded and does not merge records by amount or recipient", async () => {
  const { service } = await seed();
  const scope = {
    networkId: "ethereum-sepolia",
    chainId: 11155111,
    accountAddress: ACCOUNT,
  };
  await service.synchronizeRange(scope, 1n, 2n);
  const page = await service.getActivity(scope, 1n, 2n, 1, 0);
  assert.equal(page.items.length, 1);
  assert.equal(page.nextOffset, 1);
  assert.equal(page.items[0]?.reconciliationState, "unknown");
});