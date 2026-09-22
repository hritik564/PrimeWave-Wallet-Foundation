import { IndexingError, normalizeIndexingError } from "./errors";
import { ReadOnlyEvmRpcClient } from "./rpc";
import {
  decodeErc20Transfer,
  normalizeBlock,
  normalizeLog,
  normalizeTransaction,
} from "./normalization";
import { assertBoundedRange } from "./validation";
import type {
  IndexedBlock,
  IndexedTransaction,
  IndexerConfig,
  IndexerNetworkConfig,
  IndexingRepository,
  IndexingRunResult,
  IndexingStatus,
  IndexingStatusSnapshot,
  ReadOnlyRpcClient,
} from "./types";

type RpcFactory = (
  network: IndexerNetworkConfig,
  timeoutMs: number,
  maxResponseBytes: number,
) => ReadOnlyRpcClient;

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class IndexerService {
  constructor(
    private readonly config: IndexerConfig,
    private readonly repository: IndexingRepository,
    private readonly createRpc: RpcFactory = (network, timeoutMs, maxResponseBytes) =>
      new ReadOnlyEvmRpcClient(network, timeoutMs, undefined, maxResponseBytes),
  ) {}

  async getStatus(): Promise<IndexingStatusSnapshot> {
    let states = new Map<
      string,
      Awaited<ReturnType<IndexingRepository["getState"]>> extends infer T
        ? Exclude<T, null>
        : never
    >();
    let repositoryError: IndexingError | null = null;
    try {
      states = new Map(
        (await this.repository.listStates()).map((state) => [
          state.networkId,
          state,
        ]),
      );
    } catch (error) {
      repositoryError = normalizeIndexingError(
        error,
        this.config.bounds.maxErrorLength,
      );
    }
    return {
      enabled: this.config.enabled,
      networks: this.config.networks.map((network) => {
        const state = states.get(network.networkId);
        return {
          networkId: network.networkId,
          chainId: network.chainId,
          environment: network.environment,
          configured: network.enabled && network.rpcUrl !== null,
          status: network.enabled
            ? state?.status ?? (repositoryError ? "failed" : "idle")
            : ("disabled" as IndexingStatus),
          lastSuccessfulBlock:
            state?.lastSuccessfulBlock?.toString(10) ?? null,
          latestObservedBlock: state?.latestObservedBlock?.toString(10) ?? null,
          lastSuccessfulRun: isoDate(state?.lastSuccessfulRun ?? null),
          lastErrorCode: network.enabled
            ? state?.lastErrorCode ?? repositoryError?.code ?? null
            : null,
          lastErrorMessage:
            network.enabled
              ? state?.lastErrorMessage ??
                (repositoryError
                  ? "Indexer persistence is unavailable."
                  : null)
              : null,
          updatedAt: isoDate(state?.updatedAt ?? null),
        };
      }),
    };
  }

  async indexNextRange(networkId: string): Promise<IndexingRunResult> {
    const network = this.requireNetwork(networkId);
    const rpc = this.createRpc(
      network,
      this.config.rpcTimeoutMs,
      this.config.bounds.maxRpcResponseBytes ?? 2_097_152,
    );
    await rpc.verifyChainId();
    const latestObservedBlock = await rpc.getBlockNumber();
    const state = await this.repository.getState(networkId);
    const startBlock = state?.lastSuccessfulBlock === null ||
      state?.lastSuccessfulBlock === undefined
      ? latestObservedBlock
      : state.lastSuccessfulBlock + 1n;
    if (startBlock > latestObservedBlock) {
      await this.repository.markStatus(networkId, {
        chainId: network.chainId,
        status: "completed",
        latestObservedBlock,
      });
      return {
        networkId,
        chainId: network.chainId,
        latestObservedBlock,
        range: null,
      };
    }
    const maxRange = Math.min(
      this.config.bounds.maxBlockRange,
      this.config.bounds.maxLogRange,
    );
    const endBlock =
      startBlock + BigInt(maxRange) - 1n <
      latestObservedBlock
        ? startBlock + BigInt(maxRange) - 1n
        : latestObservedBlock;
    return this.indexRangeWithRpc(
      network,
      rpc,
      startBlock,
      endBlock,
      latestObservedBlock,
    );
  }

  async indexRange(
    networkId: string,
    startBlock: bigint,
    endBlock: bigint,
  ): Promise<IndexingRunResult> {
    const network = this.requireNetwork(networkId);
    assertBoundedRange(
      startBlock,
      endBlock,
      Math.min(this.config.bounds.maxBlockRange, this.config.bounds.maxLogRange),
    );
    const rpc = this.createRpc(
      network,
      this.config.rpcTimeoutMs,
      this.config.bounds.maxRpcResponseBytes ?? 2_097_152,
    );
    await rpc.verifyChainId();
    const latestObservedBlock = await rpc.getBlockNumber();
    if (endBlock > latestObservedBlock) {
      throw new IndexingError(
        "VALIDATION_FAILURE",
        "The requested range is newer than the observed chain head.",
      );
    }
    return this.indexRangeWithRpc(
      network,
      rpc,
      startBlock,
      endBlock,
      latestObservedBlock,
    );
  }

  private async indexRangeWithRpc(
    network: IndexerNetworkConfig,
    rpc: ReadOnlyRpcClient,
    startBlock: bigint,
    endBlock: bigint,
    latestObservedBlock: bigint,
  ): Promise<IndexingRunResult> {
    await this.repository.markStatus(network.networkId, {
      chainId: network.chainId,
      status: "running",
      latestObservedBlock,
    });
    try {
      const observedAt = new Date();
      const blocks: IndexedBlock[] = [];
        const transactions: IndexedTransaction[] = [];
      for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber += 1n) {
        const normalized = normalizeBlock(
          await rpc.getBlockByNumber(blockNumber),
          network,
          this.config.bounds,
          observedAt,
        );
        if (normalized.block.blockNumber !== blockNumber) {
          throw new IndexingError(
            "MALFORMED_BLOCK",
            "The provider returned a block with the wrong number.",
          );
        }
        const previous = blocks[blocks.length - 1];
        if (previous && normalized.block.parentHash !== previous.blockHash) {
          throw new IndexingError(
            "REORG_DETECTED",
            "The observed block parent does not match the previous block.",
          );
        }
        blocks.push(normalized.block);
        for (let index = 0; index < normalized.transactions.length; index += 1) {
          const transaction = normalized.transactions[index];
          const receipt = await rpc.getTransactionReceipt(
            typeof transaction.hash === "string" ? transaction.hash : "",
          );
          transactions.push(
            normalizeTransaction(
              transaction,
              normalized.block,
              index,
              receipt,
              this.config.bounds,
              observedAt,
            ),
          );
        }
      }

      if (startBlock > 0n) {
        const storedPrevious = await this.repository.getBlock(
          network.networkId,
          startBlock - 1n,
        );
        if (
          storedPrevious &&
          blocks[0] &&
          blocks[0].parentHash !== storedPrevious.blockHash
        ) {
          throw new IndexingError(
            "REORG_DETECTED",
            "The observed range does not match the stored parent block.",
          );
        }
        const previousBlock = await rpc.getBlockByNumber(startBlock - 1n);
        const normalizedPrevious = normalizeBlock(
          previousBlock,
          network,
          this.config.bounds,
          observedAt,
        ).block;
        if (
          blocks[0] &&
          blocks[0].parentHash !== normalizedPrevious.blockHash
        ) {
          throw new IndexingError(
            "REORG_DETECTED",
            "The observed range does not connect to its parent block.",
          );
        }
      }

      const rawLogs = await rpc.getLogs(startBlock, endBlock);
      if (rawLogs.length > this.config.bounds.maxLogsPerRequest) {
        throw new IndexingError(
          "RESPONSE_LIMIT",
          "The provider returned too many logs.",
        );
      }
      const blockByNumber = new Map(
        blocks.map((block) => [block.blockNumber, block]),
      );
      const logs = rawLogs.map((rawLog) =>
        normalizeLog(
          rawLog,
          network,
          this.config.bounds,
          blockByNumber,
          observedAt,
        ),
      );
      const transfers = logs
        .map(decodeErc20Transfer)
        .filter(
          (transfer): transfer is NonNullable<typeof transfer> =>
            transfer !== null,
        );
      const range = {
        networkId: network.networkId,
        chainId: network.chainId,
        startBlock,
        endBlock,
        blocks,
        transactions,
        logs,
        transfers,
      };
      await this.repository.persistRange(range, latestObservedBlock);
      return {
        networkId: network.networkId,
        chainId: network.chainId,
        latestObservedBlock,
        range,
      };
    } catch (error) {
      const normalized = normalizeIndexingError(
        error,
        this.config.bounds.maxErrorLength,
      );
      try {
        await this.repository.markStatus(network.networkId, {
          chainId: network.chainId,
          status:
            normalized.code === "REORG_DETECTED"
              ? "reorg_detected"
              : "failed",
          latestObservedBlock,
          lastErrorCode: normalized.code,
          lastErrorMessage: normalized.message,
        });
      } catch {
        // Preserve the original bounded indexing error.
      }
      throw normalized;
    }
  }

  private requireNetwork(networkId: string): IndexerNetworkConfig {
    const network = this.config.networks.find(
      (candidate) => candidate.networkId === networkId,
    );
    if (!network) {
      throw new IndexingError(
        "CONFIGURATION_ERROR",
        "The indexing network is not supported.",
      );
    }
    if (!this.config.enabled || !network.enabled || !network.rpcUrl) {
      throw new IndexingError(
        "CONFIGURATION_ERROR",
        "The indexing network is not configured.",
      );
    }
    return network;
  }
}