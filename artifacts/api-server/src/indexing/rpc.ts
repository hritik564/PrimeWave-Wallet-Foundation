import { IndexingError } from "./errors";
import type { IndexerNetworkConfig, ReadOnlyRpcClient } from "./types";
import { parseHexBigInt } from "./validation";

type FetchLike = (
  input: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

const READ_ONLY_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getCode",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blockTag(blockNumber: bigint): string {
  return `0x${blockNumber.toString(16)}`;
}

export class ReadOnlyEvmRpcClient implements ReadOnlyRpcClient {
  private requestId = 0;

  constructor(
    private readonly network: IndexerNetworkConfig,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: FetchLike = globalThis.fetch as FetchLike,
  ) {}

  async verifyChainId(): Promise<void> {
    const result = await this.request("eth_chainId", []);
    const remoteChainId = parseHexBigInt(result, "RPC chain ID");
    if (remoteChainId !== BigInt(this.network.chainId)) {
      throw new IndexingError(
        "CHAIN_ID_MISMATCH",
        "The configured RPC chain ID does not match the network.",
      );
    }
  }

  async getBlockNumber(): Promise<bigint> {
    return parseHexBigInt(
      await this.request("eth_blockNumber", []),
      "RPC block number",
    );
  }

  async getBlockByNumber(blockNumber: bigint): Promise<unknown> {
    return this.request("eth_getBlockByNumber", [blockTag(blockNumber), true]);
  }

  async getLogs(fromBlock: bigint, toBlock: bigint): Promise<readonly unknown[]> {
    const result = await this.request("eth_getLogs", [
      {
        fromBlock: blockTag(fromBlock),
        toBlock: blockTag(toBlock),
      },
    ]);
    if (!Array.isArray(result)) {
      throw new IndexingError("RPC_FAILURE", "The RPC log response is malformed.");
    }
    return result;
  }

  async getTransactionReceipt(transactionHash: string): Promise<unknown> {
    return this.request("eth_getTransactionReceipt", [transactionHash]);
  }

  private async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) {
      throw new IndexingError("CONFIGURATION_ERROR", "The RPC method is not read-only.");
    }
    if (!this.network.rpcUrl) {
      throw new IndexingError("CONFIGURATION_ERROR", "The network has no RPC endpoint.");
    }

    const id = ++this.requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.network.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (response.status < 200 || response.status >= 300) {
        throw new IndexingError("RPC_FAILURE", "The RPC endpoint rejected the request.");
      }
      let body: unknown;
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        throw new IndexingError("RPC_FAILURE", "The RPC response was not valid JSON.");
      }
      if (!isRecord(body) || body.jsonrpc !== "2.0" || body.id !== id) {
        throw new IndexingError("RPC_FAILURE", "The RPC response envelope is invalid.");
      }
      if (isRecord(body.error)) {
        throw new IndexingError("RPC_FAILURE", "The RPC method returned an error.");
      }
      if (!Object.prototype.hasOwnProperty.call(body, "result")) {
        throw new IndexingError("RPC_FAILURE", "The RPC response has no result.");
      }
      return body.result;
    } catch (error) {
      if (error instanceof IndexingError) throw error;
      throw new IndexingError(
        "RPC_FAILURE",
        error instanceof Error && error.name === "AbortError"
          ? "The RPC request timed out."
          : "The RPC endpoint was unavailable.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}