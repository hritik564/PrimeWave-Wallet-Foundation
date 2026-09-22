import assert from "node:assert/strict";
import test from "node:test";
import { IndexingError } from "./errors";
import { InMemoryIndexerRepository } from "./repository";
import { IndexerService } from "./service";
import type {
  IndexerConfig,
  IndexerNetworkConfig,
  ReadOnlyRpcClient,
} from "./types";
import { ReadOnlyEvmRpcClient } from "./rpc";

const ZERO_HASH = `0x${"00".repeat(32)}`;
const BLOCK_ONE_HASH = `0x${"11".repeat(32)}`;
const BLOCK_TWO_HASH = `0x${"22".repeat(32)}`;
const BAD_BLOCK_TWO_HASH = `0x${"33".repeat(32)}`;
const TRANSACTION_ONE_HASH = `0x${"aa".repeat(32)}`;
const TRANSACTION_TWO_HASH = `0x${"bb".repeat(32)}`;
const TOKEN_ADDRESS = "0x1234567890123456789012345678901234567890";
const FROM_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TO_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const network: IndexerNetworkConfig = {
  networkId: "ethereum-sepolia",
  chainId: 11155111,
  environment: "testnet",
  enabled: true,
  rpcUrl: "https://rpc.example",
};

const config: IndexerConfig = {
  enabled: true,
  rpcTimeoutMs: 1_000,
  networks: [network],
  bounds: {
    maxBlockRange: 2,
    maxLogRange: 2,
    maxLogsPerRequest: 10,
    maxTransactionsPerBlock: 10,
    maxCalldataBytes: 128,
    maxTopicsPerLog: 4,
    maxErrorLength: 128,
  },
};

function word(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function quantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function block(
  number: bigint,
  hash: string,
  parentHash: string,
  transaction: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    number: quantity(number),
    hash,
    parentHash,
    timestamp: "0x65",
    transactions: transaction ? [transaction] : [],
  };
}

function transaction(
  hash: string,
  blockNumber: bigint,
  blockHash = blockNumber === 1n ? BLOCK_ONE_HASH : BLOCK_TWO_HASH,
): Record<string, unknown> {
  return {
    hash,
    blockHash,
    blockNumber: quantity(blockNumber),
    transactionIndex: "0x0",
    from: FROM_ADDRESS,
    to: TO_ADDRESS,
    value: "0x2",
    gas: "0x5208",
    gasPrice: "0x3b9aca00",
    nonce: "0x1",
    input: "0x",
    type: "0x0",
  };
}

function transferLog(
  blockNumber: bigint,
  blockHash: string,
  transactionHash: string,
): Record<string, unknown> {
  const amount = (2n ** 200n).toString(16).padStart(64, "0");
  return {
    address: TOKEN_ADDRESS,
    blockNumber: quantity(blockNumber),
    blockHash,
    transactionHash,
    transactionIndex: "0x0",
    logIndex: "0x0",
    topics: [TRANSFER_TOPIC, word(FROM_ADDRESS), word(TO_ADDRESS)],
    data: `0x${amount}`,
  };
}

class FixtureRpc implements ReadOnlyRpcClient {
  latest = 2n;
  secondParent = BLOCK_ONE_HASH;
  readonly requests: string[] = [];

  async verifyChainId(): Promise<void> {
    this.requests.push("eth_chainId");
  }

  async getBlockNumber(): Promise<bigint> {
    this.requests.push("eth_blockNumber");
    return this.latest;
  }

  async getBlockByNumber(blockNumber: bigint): Promise<unknown> {
    this.requests.push(`eth_getBlockByNumber:${blockNumber}`);
    if (blockNumber === 0n) {
      return block(0n, ZERO_HASH, ZERO_HASH, null);
    }
    if (blockNumber === 1n) {
      return block(
        1n,
        BLOCK_ONE_HASH,
        ZERO_HASH,
        transaction(TRANSACTION_ONE_HASH, 1n),
      );
    }
    if (blockNumber === 2n) {
      return block(
        2n,
        BAD_BLOCK_TWO_HASH,
        this.secondParent,
        transaction(TRANSACTION_TWO_HASH, 2n, BAD_BLOCK_TWO_HASH),
      );
    }
    throw new Error("fixture block missing");
  }

  async getLogs(fromBlock: bigint, toBlock: bigint): Promise<readonly unknown[]> {
    this.requests.push(`eth_getLogs:${fromBlock}-${toBlock}`);
    return fromBlock === 1n
      ? [transferLog(1n, BLOCK_ONE_HASH, TRANSACTION_ONE_HASH)]
      : [];
  }

  async getTransactionReceipt(transactionHash: string): Promise<unknown> {
    this.requests.push(`eth_getTransactionReceipt:${transactionHash}`);
    return { status: "0x1" };
  }
}

function createService(
  repository: InMemoryIndexerRepository,
  rpc: FixtureRpc,
): IndexerService {
  return new IndexerService(config, repository, () => rpc);
}

test("bounded indexing normalizes blocks, transactions, logs, and exact ERC-20 amounts", async () => {
  const repository = new InMemoryIndexerRepository();
  const rpc = new FixtureRpc();
  const result = await createService(repository, rpc).indexRange(
    network.networkId,
    1n,
    1n,
  );

  assert.equal(result.range?.blocks.length, 1);
  assert.equal(result.range?.transactions.length, 1);
  assert.equal(result.range?.logs.length, 1);
  assert.equal(result.range?.transfers.length, 1);
  assert.equal(
    result.range?.transfers[0]?.amountRaw,
    (2n ** 200n).toString(10),
  );
  assert.deepEqual(await repository.getState(network.networkId), {
    networkId: network.networkId,
    chainId: network.chainId,
    lastSuccessfulBlock: 1n,
    latestObservedBlock: 2n,
    status: "completed",
    lastSuccessfulRun: (await repository.getState(network.networkId))?.lastSuccessfulRun,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: (await repository.getState(network.networkId))?.updatedAt,
  });
  assert.equal(rpc.requests.includes("eth_sendRawTransaction"), false);
});

test("parent discontinuity enters reorg state and does not advance the cursor", async () => {
  const repository = new InMemoryIndexerRepository();
  const rpc = new FixtureRpc();
  const service = createService(repository, rpc);
  await service.indexRange(network.networkId, 1n, 1n);
  rpc.secondParent = BAD_BLOCK_TWO_HASH;

  await assert.rejects(
    () => service.indexRange(network.networkId, 2n, 2n),
    (error: unknown) =>
      error instanceof IndexingError && error.code === "REORG_DETECTED",
  );
  const state = await repository.getState(network.networkId);
  assert.equal(state?.status, "reorg_detected");
  assert.equal(state?.lastSuccessfulBlock, 1n);
});

test("indexing rejects oversized ranges before making RPC calls", async () => {
  const repository = new InMemoryIndexerRepository();
  const rpc = new FixtureRpc();
  await assert.rejects(
    () => createService(repository, rpc).indexRange(network.networkId, 1n, 3n),
    (error: unknown) =>
      error instanceof IndexingError && error.code === "RESPONSE_LIMIT",
  );
  assert.deepEqual(rpc.requests, []);
});

test("RPC client rejects chain mismatch and exposes only read-only methods", async () => {
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const client = new ReadOnlyEvmRpcClient(
    { ...network, chainId: 1 },
    1_000,
    async (_url, init) => {
      const body = JSON.parse(init.body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      requests.push({ method: body.method, params: body.params });
      return {
        status: 200,
        body: {
          getReader() {
            let read = false;
            return {
              async read() {
                if (read) return { done: true as const };
                read = true;
                return {
                  done: false as const,
                  value: new TextEncoder().encode(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: body.id,
                      result: "0xaa36a7",
                    }),
                  ),
                };
              },
              async cancel() {},
            };
          },
        },
      };
    },
  );
  await assert.rejects(
    () => client.verifyChainId(),
    (error: unknown) =>
      error instanceof IndexingError && error.code === "CHAIN_ID_MISMATCH",
  );
  assert.deepEqual(requests, [{ method: "eth_chainId", params: [] }]);
  assert.equal(requests.some(({ method }) => method === "eth_sendRawTransaction"), false);
});

test("RPC client enforces the response byte limit while streaming", async () => {
  let reads = 0;
  const client = new ReadOnlyEvmRpcClient(
    network,
    1_000,
    async () => ({
      status: 200,
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              return reads === 1
                ? { done: false, value: new TextEncoder().encode("x".repeat(20)) }
                : { done: true };
            },
            async cancel() {},
          };
        },
      },
      async text() {
        throw new Error("text() must not be used for streamed responses");
      },
    }),
    10,
  );
  await assert.rejects(
    () => client.getBlockNumber(),
    (error: unknown) =>
      error instanceof IndexingError && error.code === "RESPONSE_LIMIT",
  );
  assert.equal(reads, 1);
});