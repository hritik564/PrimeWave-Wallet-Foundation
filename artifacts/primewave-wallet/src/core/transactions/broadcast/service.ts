import {
  keccak256,
  parseTransaction,
  type Hex,
} from 'viem';
import { secureLogger } from '@/src/core/security/logging';
import {
  EvmRpcProvider,
  RpcProviderError,
} from '@/src/core/blockchain/rpc';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import type { SignedTransaction } from '../signing';
import {
  TransactionBroadcastError,
  type TransactionBroadcastErrorCode,
} from './errors';
import type {
  BroadcastLifecycleState,
  BroadcastResult,
  ConfirmationPollingOptions,
  ConfirmationResult,
  PublicTransactionReceipt,
  TransactionBroadcastEngineOptions,
  TransactionLookupResult,
} from './models';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

type ParsedSignedTransaction = {
  readonly chainId: bigint;
  readonly type: 'legacy' | 'eip1559';
};

type OperationContext = {
  readonly transactionHash: `0x${string}`;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly transactionType: SignedTransaction['transactionType'];
  readonly from: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
}

function isRawTransaction(value: unknown): value is `0x${string}` {
  return (
    typeof value === 'string' &&
    /^0x[0-9a-f]+$/i.test(value) &&
    (value.length - 2) % 2 === 0
  );
}

function parseQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new TransactionBroadcastError('BROADCAST_MALFORMED_RESPONSE');
  }
  try {
    return BigInt(value);
  } catch {
    throw new TransactionBroadcastError('BROADCAST_MALFORMED_RESPONSE');
  }
}

function normalizeHash(value: unknown): `0x${string}` {
  if (!isHash(value)) {
    throw new TransactionBroadcastError('BROADCAST_MALFORMED_RESPONSE');
  }
  return value.toLowerCase() as `0x${string}`;
}

function normalizeRpcError(error: unknown): TransactionBroadcastError {
  if (error instanceof TransactionBroadcastError) {
    return error;
  }

  if (error instanceof RpcProviderError) {
    const details = {
      method: error.details?.method,
      rpcCode: error.details?.rpcCode,
    };
    switch (error.code) {
      case 'TIMEOUT':
        return new TransactionBroadcastError('BROADCAST_TIMEOUT', details);
      case 'NETWORK_UNAVAILABLE':
        return new TransactionBroadcastError(
          'BROADCAST_NETWORK_UNAVAILABLE',
          details,
        );
      case 'JSON_RPC_ERROR':
        return new TransactionBroadcastError('BROADCAST_REJECTED', details);
      case 'CHAIN_ID_MISMATCH':
        return new TransactionBroadcastError(
          'BROADCAST_CHAIN_MISMATCH',
          details,
        );
      case 'MALFORMED_RESPONSE':
      case 'INVALID_RESPONSE':
        return new TransactionBroadcastError(
          'BROADCAST_MALFORMED_RESPONSE',
          details,
        );
      case 'PROVIDER_NOT_INITIALIZED':
        return new TransactionBroadcastError(
          'BROADCAST_NOT_INITIALIZED',
          details,
        );
      default:
        return new TransactionBroadcastError('BROADCAST_RPC_ERROR', details);
    }
  }

  return new TransactionBroadcastError('BROADCAST_RPC_ERROR');
}

function validateSignedTransaction(
  transaction: SignedTransaction,
): ParsedSignedTransaction {
  if (
    typeof transaction !== 'object' ||
    transaction === null ||
    transaction.kind !== 'signed-transaction' ||
    !isRawTransaction(transaction.rawTransaction) ||
    !isHash(transaction.transactionHash) ||
    typeof transaction.networkId !== 'string' ||
    transaction.networkId.length === 0 ||
    (transaction.transactionType !== 'native-transfer' &&
      transaction.transactionType !== 'contract-call') ||
    typeof transaction.chainId !== 'bigint' ||
    transaction.chainId <= 0n
  ) {
    throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
  }

  try {
    normalizePublicEvmAddress(transaction.from);
  } catch {
    throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
  }

  const locallyComputedHash = keccak256(transaction.rawTransaction as Hex);
  if (
    locallyComputedHash.toLowerCase() !== transaction.transactionHash.toLowerCase()
  ) {
    throw new TransactionBroadcastError('BROADCAST_HASH_MISMATCH');
  }

  try {
    const parsed = parseTransaction(transaction.rawTransaction as Hex);
    if (parsed.chainId === undefined) {
      throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
    }
    if (parsed.type !== 'legacy' && parsed.type !== 'eip1559') {
      throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
    }
    return {
      chainId: parsed.chainId,
      type: parsed.type,
    };
  } catch (error) {
    if (error instanceof TransactionBroadcastError) {
      throw error;
    }
    throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
  }
}

function assertPositiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
  }
  return resolved;
}

function parseReceipt(
  value: Record<string, unknown>,
  expectedHash: `0x${string}`,
): PublicTransactionReceipt {
  const transactionHash = normalizeHash(value.transactionHash);
  if (transactionHash !== expectedHash) {
    throw new TransactionBroadcastError('BROADCAST_HASH_MISMATCH');
  }

  const blockHash = normalizeHash(value.blockHash);
  const blockNumber = parseQuantity(value.blockNumber);
  const gasUsed = parseQuantity(value.gasUsed);
  const statusQuantity = parseQuantity(value.status);
  if (statusQuantity !== 0n && statusQuantity !== 1n) {
    throw new TransactionBroadcastError('BROADCAST_MALFORMED_RESPONSE');
  }

  let effectiveGasPrice: bigint | null = null;
  if (value.effectiveGasPrice !== undefined && value.effectiveGasPrice !== null) {
    effectiveGasPrice = parseQuantity(value.effectiveGasPrice);
  }

  return {
    transactionHash,
    blockHash,
    blockNumber,
    status: statusQuantity === 1n ? 'success' : 'reverted',
    gasUsed,
    effectiveGasPrice,
  };
}

function parseLookup(
  value: Record<string, unknown>,
  expectedHash: `0x${string}`,
): { state: 'pending' | 'mined'; blockHash: `0x${string}` | null; blockNumber: bigint | null } {
  if (value.hash !== undefined && normalizeHash(value.hash) !== expectedHash) {
    throw new TransactionBroadcastError('BROADCAST_HASH_MISMATCH');
  }

  const rawBlockNumber = value.blockNumber;
  const rawBlockHash = value.blockHash;
  if (rawBlockNumber === null || rawBlockNumber === undefined) {
    return { state: 'pending', blockHash: null, blockNumber: null };
  }
  const blockNumber = parseQuantity(rawBlockNumber);
  const blockHash = normalizeHash(rawBlockHash);
  return { state: 'mined', blockHash, blockNumber };
}

export class TransactionBroadcastEngine {
  private readonly network: ReturnType<EvmRpcProvider['getNetwork']>;
  private readonly now: () => number;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly defaultPolling: Required<ConfirmationPollingOptions>;
  private readonly broadcastOperations = new Map<
    string,
    Promise<BroadcastResult>
  >();
  private readonly confirmationOperations = new Map<
    string,
    Promise<ConfirmationResult>
  >();
  private readonly confirmationResults = new Map<string, ConfirmationResult>();
  private readonly lifecycle = new Map<string, BroadcastLifecycleState>();

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly provider: EvmRpcProvider,
    options: TransactionBroadcastEngineOptions = {},
  ) {
    this.network = provider.getNetwork();
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((durationMs) =>
        new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
    this.defaultPolling = {
      intervalMs: assertPositiveInteger(
        options.defaultPolling?.intervalMs,
        DEFAULT_POLL_INTERVAL_MS,
      ),
      timeoutMs: assertPositiveInteger(
        options.defaultPolling?.timeoutMs,
        DEFAULT_POLL_TIMEOUT_MS,
      ),
    };
  }

  getState(transactionHash: string): BroadcastLifecycleState | undefined {
    return this.lifecycle.get(transactionHash.toLowerCase());
  }

  async broadcast(signed: SignedTransaction): Promise<BroadcastResult> {
    let parsed: ParsedSignedTransaction;
    let context: OperationContext;
    try {
      parsed = validateSignedTransaction(signed);
      context = {
        transactionHash: signed.transactionHash.toLowerCase() as `0x${string}`,
        networkId: signed.networkId,
        chainId: signed.chainId,
        transactionType: signed.transactionType,
        from: normalizePublicEvmAddress(signed.from),
      };
    } catch (error) {
      const normalized = normalizeRpcError(error);
      this.logFailure(normalized, undefined);
      throw normalized;
    }

    const existing = this.broadcastOperations.get(context.transactionHash);
    if (existing) {
      return existing;
    }

    this.lifecycle.set(context.transactionHash, 'broadcasting');
    const operation = this.executeBroadcast(signed, parsed, context);
    this.broadcastOperations.set(context.transactionHash, operation);
    return operation;
  }

  async confirm(
    broadcast: BroadcastResult,
    options: ConfirmationPollingOptions = {},
  ): Promise<ConfirmationResult> {
    const context = this.validateBroadcastResult(broadcast);
    const existing = this.confirmationOperations.get(context.transactionHash);
    if (existing) {
      return existing;
    }
    const cached = this.confirmationResults.get(context.transactionHash);
    if (cached) {
      return cached;
    }

    this.lifecycle.set(context.transactionHash, 'confirming');
    const operation = this.executeConfirmation(context, {
      intervalMs: assertPositiveInteger(
        options.intervalMs,
        this.defaultPolling.intervalMs,
      ),
      timeoutMs: assertPositiveInteger(
        options.timeoutMs,
        this.defaultPolling.timeoutMs,
      ),
    });
    this.confirmationOperations.set(context.transactionHash, operation);
    return operation;
  }

  async lookupTransaction(
    broadcast: BroadcastResult,
  ): Promise<TransactionLookupResult> {
    const context = this.validateBroadcastResult(broadcast);
    try {
      await this.ensureProviderInitialized();
      const value = await this.provider.request('eth_getTransactionByHash', [
        context.transactionHash,
      ]);
      if (value === null) {
        return {
          kind: 'transaction-lookup',
          state: 'not-found',
          transactionHash: context.transactionHash,
          networkId: context.networkId,
          chainId: context.chainId,
          blockHash: null,
          blockNumber: null,
        };
      }
      const parsed = parseLookup(value, context.transactionHash);
      return {
        kind: 'transaction-lookup',
        ...parsed,
        transactionHash: context.transactionHash,
        networkId: context.networkId,
        chainId: context.chainId,
      };
    } catch (error) {
      const normalized = normalizeRpcError(error);
      this.logFailure(normalized, context.transactionHash);
      throw normalized;
    }
  }

  private async executeBroadcast(
    signed: SignedTransaction,
    parsed: ParsedSignedTransaction,
    context: OperationContext,
  ): Promise<BroadcastResult> {
    try {
      this.assertBroadcastContext(signed, parsed);
      await this.ensureProviderInitialized();
      this.assertBroadcastContext(signed, parsed);

      const rpcHash = await this.provider.request('eth_sendRawTransaction', [
        signed.rawTransaction,
      ]);
      const normalizedRpcHash = normalizeHash(rpcHash);
      if (normalizedRpcHash !== context.transactionHash) {
        throw new TransactionBroadcastError('BROADCAST_HASH_MISMATCH');
      }

      this.lifecycle.set(context.transactionHash, 'broadcasted');
      const result: BroadcastResult = Object.freeze({
        kind: 'broadcast-result',
        state: 'broadcasted',
        transactionHash: context.transactionHash,
        networkId: context.networkId,
        chainId: context.chainId,
        transactionType: context.transactionType,
        from: context.from,
        submittedAtMs: this.now(),
      });
      secureLogger.info('Transaction broadcast accepted', {
        networkId: context.networkId,
        chainId: Number(context.chainId),
        transactionHash: context.transactionHash,
      });
      return result;
    } catch (error) {
      const normalized = normalizeRpcError(error);
      if (
        normalized.code === 'BROADCAST_TIMEOUT' ||
        normalized.code === 'BROADCAST_NETWORK_UNAVAILABLE'
      ) {
        this.lifecycle.set(context.transactionHash, 'unknown');
        const result: BroadcastResult = Object.freeze({
          kind: 'broadcast-result',
          state: 'unknown',
          transactionHash: context.transactionHash,
          networkId: context.networkId,
          chainId: context.chainId,
          transactionType: context.transactionType,
          from: context.from,
          submittedAtMs: null,
          errorCode: normalized.code,
        });
        secureLogger.warning('Transaction broadcast result is unknown', {
          networkId: context.networkId,
          chainId: Number(context.chainId),
          transactionHash: context.transactionHash,
          errorCode: normalized.code,
        });
        return result;
      }
      this.lifecycle.set(context.transactionHash, 'failed');
      this.logFailure(normalized, context.transactionHash);
      throw normalized;
    }
  }

  private async executeConfirmation(
    context: OperationContext,
    polling: Required<ConfirmationPollingOptions>,
  ): Promise<ConfirmationResult> {
    const startedAt = this.now();
    const maximumPolls = Math.max(
      1,
      Math.ceil(polling.timeoutMs / polling.intervalMs) + 1,
    );
    let polls = 0;

    try {
      await this.ensureProviderInitialized();
      while (polls < maximumPolls) {
        polls += 1;
        let rawReceipt: Record<string, unknown> | null;
        try {
          rawReceipt = await this.provider.request('eth_getTransactionReceipt', [
            context.transactionHash,
          ]);
        } catch (error) {
          const normalized = normalizeRpcError(error);
          if (normalized.code === 'BROADCAST_TIMEOUT') {
            return this.finishUnknownConfirmation(context, polls, normalized.code);
          }
          throw normalized;
        }

        if (rawReceipt !== null) {
          const receipt = parseReceipt(rawReceipt, context.transactionHash);
          const state = receipt.status === 'success' ? 'confirmed' : 'reverted';
          this.lifecycle.set(context.transactionHash, state);
          const result: ConfirmationResult = Object.freeze({
            kind: 'confirmation-result',
            state,
            transactionHash: context.transactionHash,
            networkId: context.networkId,
            chainId: context.chainId,
            receipt,
            polls,
            checkedAtMs: this.now(),
          });
          this.confirmationResults.set(context.transactionHash, result);
          secureLogger.info('Transaction confirmation observed', {
            networkId: context.networkId,
            chainId: Number(context.chainId),
            transactionHash: context.transactionHash,
            state,
            polls,
          });
          return result;
        }

        if (
          this.now() - startedAt >= polling.timeoutMs ||
          polls >= maximumPolls
        ) {
          return this.finishUnknownConfirmation(
            context,
            polls,
            'BROADCAST_TIMEOUT',
          );
        }
        await this.sleep(polling.intervalMs);
      }

      return this.finishUnknownConfirmation(
        context,
        polls,
        'BROADCAST_TIMEOUT',
      );
    } catch (error) {
      const normalized = normalizeRpcError(error);
      this.lifecycle.set(context.transactionHash, 'failed');
      this.logFailure(normalized, context.transactionHash);
      throw normalized;
    }
  }

  private finishUnknownConfirmation(
    context: OperationContext,
    polls: number,
    errorCode: 'BROADCAST_TIMEOUT' | 'BROADCAST_UNKNOWN_RESULT',
  ): ConfirmationResult {
    this.lifecycle.set(context.transactionHash, 'unknown');
    const result: ConfirmationResult = Object.freeze({
      kind: 'confirmation-result',
      state: 'unknown',
      transactionHash: context.transactionHash,
      networkId: context.networkId,
      chainId: context.chainId,
      receipt: null,
      polls,
      checkedAtMs: this.now(),
      errorCode,
    });
    this.confirmationResults.set(context.transactionHash, result);
    secureLogger.warning('Transaction confirmation remains unknown', {
      networkId: context.networkId,
      chainId: Number(context.chainId),
      transactionHash: context.transactionHash,
      errorCode,
      polls,
    });
    return result;
  }

  private validateBroadcastResult(
    broadcast: BroadcastResult,
  ): OperationContext {
    if (
      typeof broadcast !== 'object' ||
      broadcast === null ||
      broadcast.kind !== 'broadcast-result' ||
      !isHash(broadcast.transactionHash) ||
      typeof broadcast.networkId !== 'string' ||
      typeof broadcast.chainId !== 'bigint' ||
      broadcast.chainId <= 0n
    ) {
      throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
    }

    const providerNetwork = this.provider.getNetwork();
    if (
      broadcast.networkId !== providerNetwork.id ||
      broadcast.chainId !== BigInt(providerNetwork.chainId ?? -1)
    ) {
      throw new TransactionBroadcastError('BROADCAST_CHAIN_MISMATCH');
    }

    return {
      transactionHash: broadcast.transactionHash.toLowerCase() as `0x${string}`,
      networkId: broadcast.networkId,
      chainId: broadcast.chainId,
      transactionType: broadcast.transactionType,
      from: broadcast.from,
    };
  }

  private assertBroadcastContext(
    signed: SignedTransaction,
    parsed: ParsedSignedTransaction,
  ): void {
    const active = this.registry.getActiveNetwork();
    if (
      !active ||
      active.id !== this.network.id ||
      active.chainId !== this.network.chainId
    ) {
      throw new TransactionBroadcastError('BROADCAST_NETWORK_CHANGED');
    }
    if (
      !active.enabled ||
      active.configurationStatus !== 'configured' ||
      active.chainId === null
    ) {
      throw new TransactionBroadcastError('BROADCAST_CHAIN_MISMATCH');
    }
    if (
      signed.networkId !== this.network.id ||
      signed.chainId !== BigInt(this.network.chainId) ||
      parsed.chainId !== BigInt(this.network.chainId)
    ) {
      throw new TransactionBroadcastError('BROADCAST_CHAIN_MISMATCH');
    }
    if (
      (parsed.type === 'legacy' && signed.transactionType === undefined) ||
      (parsed.type === 'eip1559' && signed.transactionType === undefined)
    ) {
      throw new TransactionBroadcastError('BROADCAST_INVALID_TRANSACTION');
    }
  }

  private async ensureProviderInitialized(): Promise<void> {
    if (!this.provider.isInitialized()) {
      await this.provider.initialize();
    }
  }

  private logFailure(
    error: TransactionBroadcastError,
    transactionHash: string | undefined,
  ): void {
    secureLogger.warning('Transaction execution failed', {
      networkId: this.network.id,
      chainId: this.network.chainId,
      transactionHash: transactionHash ?? null,
      errorCode: error.code,
    });
  }
}