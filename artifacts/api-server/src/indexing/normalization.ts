import { IndexingError } from "./errors";
import type {
  IndexedBlock,
  IndexedLog,
  IndexedTokenTransfer,
  IndexedTransaction,
  IndexerNetworkConfig,
  IndexingBounds,
} from "./types";
import {
  normalizeAddress,
  normalizeData,
  normalizeHash,
  normalizeTopics,
  parseHexBigInt,
  parseSafeHexNumber,
  toBoundedDecimal,
} from "./validation";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOPIC_WORD = /^0x[0-9a-f]{64}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IndexingError("VALIDATION_FAILURE", `${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function remap(error: unknown, code: IndexingError["code"]): never {
  if (error instanceof IndexingError && error.code === "RESPONSE_LIMIT") {
    throw error;
  }
  throw new IndexingError(
    code,
    error instanceof Error ? error.message : "The provider response is malformed.",
  );
}

function optionalQuantity(
  value: unknown,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  return toBoundedDecimal(parseHexBigInt(value, label), label);
}

function transactionStatus(receipt: unknown): IndexedTransaction["status"] {
  if (receipt === null) return "unknown";
  const row = record(receipt, "Transaction receipt");
  if (row.status === undefined || row.status === null) return "unknown";
  const status = parseHexBigInt(row.status, "Transaction receipt status");
  if (status === 1n) return "success";
  if (status === 0n) return "reverted";
  throw new IndexingError("MALFORMED_TRANSACTION", "Transaction receipt status is invalid.");
}

export function normalizeBlock(
  raw: unknown,
  network: IndexerNetworkConfig,
  bounds: IndexingBounds,
  observedAt: Date,
): {
  readonly block: IndexedBlock;
  readonly transactions: readonly Record<string, unknown>[];
} {
  try {
    const row = record(raw, "Block");
    const transactions = row.transactions;
    if (!Array.isArray(transactions)) {
      throw new IndexingError("MALFORMED_BLOCK", "Block transactions are malformed.");
    }
    if (transactions.length > bounds.maxTransactionsPerBlock) {
      throw new IndexingError(
        "RESPONSE_LIMIT",
        "The block transaction count exceeds the limit.",
      );
    }
    return {
      block: {
        networkId: network.networkId,
        chainId: network.chainId,
        blockNumber: parseHexBigInt(row.number, "Block number"),
        blockHash: normalizeHash(row.hash, "Block hash"),
        parentHash: normalizeHash(row.parentHash, "Block parent hash"),
        timestamp: parseHexBigInt(row.timestamp, "Block timestamp"),
        observedAt,
      },
      transactions: transactions.map((transaction, index) => {
        const value = record(transaction, `Block transaction ${index}`);
        if (typeof value.hash !== "string") {
          throw new IndexingError("MALFORMED_BLOCK", "Block transaction hash is missing.");
        }
        return value;
      }),
    };
  } catch (error) {
    remap(error, "MALFORMED_BLOCK");
  }
}

export function normalizeTransaction(
  raw: Record<string, unknown>,
  block: IndexedBlock,
  transactionPosition: number,
  receipt: unknown,
  bounds: IndexingBounds,
  observedAt: Date,
): IndexedTransaction {
  try {
    const blockNumber =
      raw.blockNumber === undefined
        ? block.blockNumber
        : parseHexBigInt(raw.blockNumber, "Transaction block number");
    if (blockNumber !== block.blockNumber) {
      throw new IndexingError("MALFORMED_TRANSACTION", "Transaction block binding is invalid.");
    }
    const blockHash =
      raw.blockHash === undefined
        ? block.blockHash
        : normalizeHash(raw.blockHash, "Transaction block hash");
    if (blockHash !== block.blockHash) {
      throw new IndexingError("MALFORMED_TRANSACTION", "Transaction block hash binding is invalid.");
    }
    const input = normalizeData(
      raw.input ?? raw.data ?? "0x",
      "Transaction calldata",
      bounds.maxCalldataBytes,
    );
    const transactionType =
      raw.type === undefined || raw.type === null
        ? null
        : typeof raw.type === "string" && raw.type.length <= 32
          ? raw.type
          : (() => {
              throw new IndexingError(
                "MALFORMED_TRANSACTION",
                "Transaction type is malformed.",
              );
            })();
    return {
      networkId: block.networkId,
      chainId: block.chainId,
      transactionHash: normalizeHash(raw.hash, "Transaction hash"),
      blockNumber,
      blockHash,
      transactionIndex:
        raw.transactionIndex === undefined
          ? transactionPosition
          : parseSafeHexNumber(raw.transactionIndex, "Transaction index"),
      from: normalizeAddress(raw.from, "Transaction sender"),
      to: raw.to === null || raw.to === undefined
        ? null
        : normalizeAddress(raw.to, "Transaction recipient"),
      value: toBoundedDecimal(parseHexBigInt(raw.value, "Transaction value"), "Transaction value"),
      gas: toBoundedDecimal(parseHexBigInt(raw.gas, "Transaction gas"), "Transaction gas"),
      gasPrice: optionalQuantity(raw.gasPrice, "Transaction gas price"),
      maxFeePerGas: optionalQuantity(raw.maxFeePerGas, "Transaction max fee"),
      maxPriorityFeePerGas: optionalQuantity(
        raw.maxPriorityFeePerGas,
        "Transaction max priority fee",
      ),
      nonce: toBoundedDecimal(parseHexBigInt(raw.nonce, "Transaction nonce"), "Transaction nonce"),
      input,
      transactionType,
      timestamp: block.timestamp,
      status: transactionStatus(receipt),
      observedAt,
    };
  } catch (error) {
    remap(error, "MALFORMED_TRANSACTION");
  }
}

export function normalizeLog(
  raw: unknown,
  network: IndexerNetworkConfig,
  bounds: IndexingBounds,
  blockByNumber: ReadonlyMap<bigint, IndexedBlock>,
  observedAt: Date,
): IndexedLog {
  try {
    const row = record(raw, "Log");
    const blockNumber = parseHexBigInt(row.blockNumber, "Log block number");
    const block = blockByNumber.get(blockNumber);
    if (!block) {
      throw new IndexingError("MALFORMED_LOG", "Log block is outside the indexed range.");
    }
    const blockHash = normalizeHash(row.blockHash, "Log block hash");
    if (blockHash !== block.blockHash) {
      throw new IndexingError("MALFORMED_LOG", "Log block hash binding is invalid.");
    }
    const transactionIndex = parseSafeHexNumber(
      row.transactionIndex,
      "Log transaction index",
    );
    const logIndex = parseSafeHexNumber(row.logIndex, "Log index");
    return {
      networkId: network.networkId,
      chainId: network.chainId,
      blockNumber,
      blockHash,
      transactionHash: normalizeHash(row.transactionHash, "Log transaction hash"),
      transactionIndex,
      logIndex,
      contractAddress: normalizeAddress(row.address, "Log contract address"),
      topics: normalizeTopics(
        row.topics,
        bounds.maxTopicsPerLog,
        bounds.maxCalldataBytes,
      ),
      data: normalizeData(row.data, "Log data", bounds.maxCalldataBytes),
      timestamp: block.timestamp,
      observedAt,
    };
  } catch (error) {
    remap(error, "MALFORMED_LOG");
  }
}

export function decodeErc20Transfer(
  log: IndexedLog,
): IndexedTokenTransfer | null {
  if (log.topics[0] !== TRANSFER_TOPIC) return null;
  if (
    log.topics.length < 3 ||
    !TOPIC_WORD.test(log.topics[1] ?? "") ||
    !TOPIC_WORD.test(log.topics[2] ?? "") ||
    !/^0x[0-9a-f]{64}$/i.test(log.data)
  ) {
    throw new IndexingError("MALFORMED_LOG", "ERC-20 Transfer log fields are malformed.");
  }
  return {
    networkId: log.networkId,
    chainId: log.chainId,
    tokenContractAddress: log.contractAddress,
    from: normalizeAddress(`0x${log.topics[1].slice(-40)}`, "Transfer sender"),
    to: normalizeAddress(`0x${log.topics[2].slice(-40)}`, "Transfer recipient"),
    amountRaw: toBoundedDecimal(
      BigInt(log.data),
      "ERC-20 transfer amount",
    ),
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    timestamp: log.timestamp,
    observedAt: log.observedAt,
  };
}