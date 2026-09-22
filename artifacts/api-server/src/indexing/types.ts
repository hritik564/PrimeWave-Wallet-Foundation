export type IndexingStatus =
  | "disabled"
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "reorg_detected";

export type IndexingErrorCode =
  | "CONFIGURATION_ERROR"
  | "RPC_FAILURE"
  | "CHAIN_ID_MISMATCH"
  | "MALFORMED_BLOCK"
  | "MALFORMED_LOG"
  | "MALFORMED_TRANSACTION"
  | "RESPONSE_LIMIT"
  | "PERSISTENCE_FAILURE"
  | "REORG_DETECTED"
  | "VALIDATION_FAILURE";

export interface IndexerNetworkConfig {
  readonly networkId: string;
  readonly chainId: number;
  readonly environment: "development" | "testnet" | "mainnet";
  readonly enabled: boolean;
  readonly rpcUrl: string | null;
}

export interface IndexingBounds {
  readonly maxBlockRange: number;
  readonly maxLogRange: number;
  readonly maxLogsPerRequest: number;
  readonly maxTransactionsPerBlock: number;
  readonly maxCalldataBytes: number;
  readonly maxTopicsPerLog: number;
  readonly maxErrorLength: number;
  readonly maxRpcResponseBytes?: number;
}

export interface IndexerConfig {
  readonly enabled: boolean;
  readonly rpcTimeoutMs: number;
  readonly networks: readonly IndexerNetworkConfig[];
  readonly bounds: IndexingBounds;
}

export interface IndexingStateRecord {
  readonly networkId: string;
  readonly chainId: number;
  readonly lastSuccessfulBlock: bigint | null;
  readonly latestObservedBlock: bigint | null;
  readonly status: IndexingStatus;
  readonly lastSuccessfulRun: Date | string | null;
  readonly lastErrorCode: IndexingErrorCode | null;
  readonly lastErrorMessage: string | null;
  readonly updatedAt: Date | string;
}

export interface IndexedBlock {
  readonly networkId: string;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly parentHash: string;
  readonly timestamp: bigint;
  readonly observedAt: Date;
}

export interface IndexedTransaction {
  readonly networkId: string;
  readonly chainId: number;
  readonly transactionHash: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionIndex: number;
  readonly from: string;
  readonly to: string | null;
  readonly value: string;
  readonly gas: string;
  readonly gasPrice: string | null;
  readonly maxFeePerGas: string | null;
  readonly maxPriorityFeePerGas: string | null;
  readonly nonce: string;
  readonly input: string;
  readonly transactionType: string | null;
  readonly timestamp: bigint;
  readonly status: "success" | "reverted" | "unknown";
  readonly observedAt: Date;
}

export interface IndexedLog {
  readonly networkId: string;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly contractAddress: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly timestamp: bigint;
  readonly observedAt: Date;
}

export interface IndexedTokenTransfer {
  readonly networkId: string;
  readonly chainId: number;
  readonly tokenContractAddress: string;
  readonly from: string;
  readonly to: string;
  readonly amountRaw: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly timestamp: bigint;
  readonly observedAt: Date;
}

export interface IndexedRange {
  readonly networkId: string;
  readonly chainId: number;
  readonly startBlock: bigint;
  readonly endBlock: bigint;
  readonly blocks: readonly IndexedBlock[];
  readonly transactions: readonly IndexedTransaction[];
  readonly logs: readonly IndexedLog[];
  readonly transfers: readonly IndexedTokenTransfer[];
}

export interface IndexingRunResult {
  readonly networkId: string;
  readonly chainId: number;
  readonly latestObservedBlock: bigint;
  readonly range: IndexedRange | null;
}

export interface IndexingStatusSnapshot {
  readonly enabled: boolean;
  readonly networks: readonly {
    readonly networkId: string;
    readonly chainId: number;
    readonly environment: "development" | "testnet" | "mainnet";
    readonly configured: boolean;
    readonly status: IndexingStatus;
    readonly lastSuccessfulBlock: string | null;
    readonly latestObservedBlock: string | null;
    readonly lastSuccessfulRun: string | null;
    readonly lastErrorCode: IndexingErrorCode | null;
    readonly lastErrorMessage: string | null;
    readonly updatedAt: string | null;
  }[];
}

export interface IndexingRepository {
  getState(networkId: string): Promise<IndexingStateRecord | null>;
  listStates(): Promise<readonly IndexingStateRecord[]>;
  getBlock(
    networkId: string,
    blockNumber: bigint,
  ): Promise<IndexedBlock | null>;
  persistRange(
    range: IndexedRange,
    latestObservedBlock: bigint,
  ): Promise<void>;
  markStatus(
    networkId: string,
    update: {
      readonly chainId: number;
      readonly status: IndexingStatus;
      readonly latestObservedBlock?: bigint | null;
      readonly lastSuccessfulBlock?: bigint | null;
      readonly lastSuccessfulRun?: Date | null;
      readonly lastErrorCode?: IndexingErrorCode | null;
      readonly lastErrorMessage?: string | null;
    },
  ): Promise<void>;
}

export interface ReadOnlyRpcClient {
  verifyChainId(): Promise<void>;
  getBlockNumber(): Promise<bigint>;
  getBlockByNumber(blockNumber: bigint): Promise<unknown>;
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<readonly unknown[]>;
  getTransactionReceipt(transactionHash: string): Promise<unknown>;
}