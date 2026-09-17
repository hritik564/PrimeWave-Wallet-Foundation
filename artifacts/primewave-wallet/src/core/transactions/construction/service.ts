import { secureLogger } from '@/src/core/security/logging';
import {
  EvmAccountStateService,
  AccountStateError,
} from '@/src/core/blockchain/account-state';
import {
  EvmRpcProvider,
  RpcProviderError,
} from '@/src/core/blockchain/rpc';
import {
  GasFeeEngine,
  GasFeeError,
  formatNativeUnits,
} from '@/src/core/blockchain/gas-fee';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import { TransactionConstructionError } from './errors';
import type {
  AccountStateDependency,
  Eip1559TransactionPreview,
  GasFeeEngineDependency,
  LegacyTransactionPreview,
  NormalizedTransactionIntent,
  PublicWalletAccount,
  TransactionConstructionEngineOptions,
  TransactionFeePreference,
  TransactionIntent,
  TransactionPreview,
  TransactionType,
  UnsignedTransaction,
} from './models';

function normalizeQuantity(
  value: unknown,
  errorCode: 'INVALID_VALUE' | 'INVALID_NONCE' | 'INVALID_GAS_LIMIT',
): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new TransactionConstructionError(errorCode);
    }
    return value;
  }
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new TransactionConstructionError(errorCode);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new TransactionConstructionError(errorCode);
    }
    return parsed;
  } catch (error) {
    if (error instanceof TransactionConstructionError) {
      throw error;
    }
    throw new TransactionConstructionError(errorCode);
  }
}

function normalizeAddress(
  value: unknown,
  errorCode: 'INVALID_FROM_ADDRESS' | 'INVALID_RECIPIENT',
): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    throw new TransactionConstructionError(errorCode);
  }
}

function normalizeData(value: unknown): `0x${string}` {
  if (
    value !== undefined &&
    (typeof value !== 'string' ||
      !/^0x[0-9a-f]*$/i.test(value) ||
      (value.length - 2) % 2 !== 0)
  ) {
    throw new TransactionConstructionError('INVALID_CALLDATA');
  }
  return (value === undefined ? '0x' : value.toLowerCase()) as `0x${string}`;
}

function normalizePreference(value: unknown): TransactionFeePreference {
  if (value === undefined) {
    return 'auto';
  }
  if (value === 'auto' || value === 'legacy' || value === 'eip1559') {
    return value;
  }
  throw new TransactionConstructionError('INVALID_TRANSACTION');
}

function determineTransactionType(
  requested: unknown,
  data: `0x${string}`,
): TransactionType {
  if (requested !== undefined && requested !== 'native-transfer' && requested !== 'contract-call') {
    throw new TransactionConstructionError('INVALID_TRANSACTION');
  }
  const type =
    requested ??
    (data === '0x' ? 'native-transfer' : 'contract-call');
  if (type === 'native-transfer' && data !== '0x') {
    throw new TransactionConstructionError('INVALID_TRANSACTION');
  }
  return type;
}

function normalizeIntent(intent: TransactionIntent): NormalizedTransactionIntent {
  if (
    typeof intent !== 'object' ||
    intent === null ||
    Array.isArray(intent) ||
    typeof intent.networkId !== 'string' ||
    intent.networkId.length === 0
  ) {
    throw new TransactionConstructionError('INVALID_TRANSACTION');
  }

  const from = normalizeAddress(intent.from, 'INVALID_FROM_ADDRESS');
  const to = normalizeAddress(intent.to, 'INVALID_RECIPIENT');
  const value = normalizeQuantity(intent.value, 'INVALID_VALUE');
  const data = normalizeData(intent.data);
  const nonce =
    intent.nonce === undefined
      ? undefined
      : normalizeQuantity(intent.nonce, 'INVALID_NONCE');
  const gasLimit =
    intent.gasLimit === undefined
      ? undefined
      : normalizeQuantity(intent.gasLimit, 'INVALID_GAS_LIMIT');
  if (gasLimit === 0n) {
    throw new TransactionConstructionError('INVALID_GAS_LIMIT');
  }

  return {
    networkId: intent.networkId,
    from,
    to,
    value,
    data,
    nonce,
    gasLimit,
    transactionType: determineTransactionType(intent.transactionType, data),
    feePreference: normalizePreference(intent.fee?.preference),
  };
}

function dependencyError(error: unknown): TransactionConstructionError {
  if (error instanceof TransactionConstructionError) {
    return error;
  }
  if (error instanceof GasFeeError) {
    switch (error.code) {
      case 'NETWORK_CHANGED':
        return new TransactionConstructionError('NETWORK_CHANGED');
      case 'CHAIN_ID_MISMATCH':
        return new TransactionConstructionError('CHAIN_ID_MISMATCH');
      case 'CONFIGURATION_ERROR':
        return new TransactionConstructionError('CONFIGURATION_ERROR');
      case 'ESTIMATION_FAILED':
      case 'ZERO_GAS_LIMIT':
        return new TransactionConstructionError('GAS_ESTIMATION_FAILED');
      case 'MISSING_FEE_DATA':
        return new TransactionConstructionError('FEE_UNAVAILABLE');
      case 'UNSUPPORTED_FEE_MODEL':
        return new TransactionConstructionError('UNSUPPORTED_FEE_MODEL');
      case 'RPC_TIMEOUT':
        return new TransactionConstructionError('RPC_TIMEOUT');
      case 'RPC_UNAVAILABLE':
        return new TransactionConstructionError('RPC_UNAVAILABLE');
      case 'RPC_MALFORMED_RESPONSE':
      case 'INVALID_QUANTITY':
        return new TransactionConstructionError('RPC_MALFORMED_RESPONSE');
      default:
        return new TransactionConstructionError('CONSTRUCTION_FAILED');
    }
  }
  if (error instanceof AccountStateError) {
    switch (error.code) {
      case 'NETWORK_CHANGED':
        return new TransactionConstructionError('NETWORK_CHANGED');
      case 'CONFIGURATION_ERROR':
        return new TransactionConstructionError('CONFIGURATION_ERROR');
      default:
        return new TransactionConstructionError('CONSTRUCTION_FAILED');
    }
  }
  if (error instanceof RpcProviderError) {
    switch (error.code) {
      case 'TIMEOUT':
        return new TransactionConstructionError('RPC_TIMEOUT');
      case 'NETWORK_UNAVAILABLE':
      case 'ENDPOINT_UNAVAILABLE':
      case 'HTTP_FAILURE':
        return new TransactionConstructionError('RPC_UNAVAILABLE');
      case 'MALFORMED_RESPONSE':
      case 'INVALID_RESPONSE':
        return new TransactionConstructionError('RPC_MALFORMED_RESPONSE');
      case 'CHAIN_ID_MISMATCH':
        return new TransactionConstructionError('CHAIN_ID_MISMATCH');
      case 'CONFIGURATION_ERROR':
      case 'PROVIDER_NOT_INITIALIZED':
        return new TransactionConstructionError('CONFIGURATION_ERROR');
      default:
        return new TransactionConstructionError('CONSTRUCTION_FAILED');
    }
  }
  return new TransactionConstructionError('CONSTRUCTION_FAILED');
}

function errorCategory(error: unknown): string {
  if (error instanceof TransactionConstructionError) {
    return error.code;
  }
  if (error instanceof GasFeeError) {
    return error.code;
  }
  if (error instanceof AccountStateError) {
    return error.code;
  }
  if (error instanceof RpcProviderError) {
    return error.code;
  }
  return 'UNEXPECTED_ERROR';
}

function canonicalUnsignedTransaction(
  transaction: Omit<UnsignedTransaction, 'canonicalRepresentation'>,
): string {
  const common = {
    chainId: transaction.chainId.toString(),
    data: transaction.data,
    from: transaction.from,
    gasLimit: transaction.gasLimit.toString(),
    networkId: transaction.networkId,
    nonce: transaction.nonce.toString(),
    to: transaction.to,
    transactionType: transaction.transactionType,
    value: transaction.value.toString(),
  };
  return transaction.feeModel === 'legacy'
    ? JSON.stringify({
        ...common,
        feeModel: transaction.feeModel,
        gasPrice: transaction.gasPrice.toString(),
      })
    : JSON.stringify({
        ...common,
        feeModel: transaction.feeModel,
        maxFeePerGas: transaction.maxFeePerGas.toString(),
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
      });
}

export function serializeUnsignedTransaction(
  transaction: UnsignedTransaction,
): string {
  return canonicalUnsignedTransaction(transaction);
}

function makeUnsignedTransaction(
  normalized: NormalizedTransactionIntent,
  network: EvmNetwork,
  chainId: bigint,
  nonce: bigint,
  gasLimit: bigint,
  feeData:
    | {
        readonly model: 'legacy';
        readonly gasPrice: bigint;
      }
    | {
        readonly model: 'eip1559';
        readonly maxFeePerGas: bigint;
        readonly maxPriorityFeePerGas: bigint;
      },
): UnsignedTransaction {
  const base = {
    networkId: network.id,
    chainId,
    transactionType: normalized.transactionType,
    from: normalized.from,
    to: normalized.to,
    value: normalized.value,
    data: normalized.data,
    nonce,
    gasLimit,
  };
  if (feeData.model === 'legacy') {
    const withoutCanonical = { ...base, feeModel: 'legacy' as const, gasPrice: feeData.gasPrice };
    return {
      ...withoutCanonical,
      canonicalRepresentation: canonicalUnsignedTransaction(withoutCanonical),
    };
  }
  const withoutCanonical = {
    ...base,
    feeModel: 'eip1559' as const,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  };
  return {
    ...withoutCanonical,
    canonicalRepresentation: canonicalUnsignedTransaction(withoutCanonical),
  };
}

function assertMatchingContext(
  registry: NetworkRegistry,
  provider: EvmRpcProvider,
  network: EvmNetwork,
  requestedNetworkId?: string,
): void {
  const activeNetwork = registry.getActiveNetwork();
  if (!activeNetwork) {
    throw new TransactionConstructionError('NETWORK_NOT_SELECTED');
  }
  if (
    activeNetwork.id !== network.id ||
    activeNetwork.chainId !== network.chainId
  ) {
    throw new TransactionConstructionError('NETWORK_CHANGED');
  }
  if (requestedNetworkId !== undefined && requestedNetworkId !== network.id) {
    throw new TransactionConstructionError('NETWORK_MISMATCH');
  }
  if (!activeNetwork.enabled) {
    throw new TransactionConstructionError('NETWORK_DISABLED');
  }
  if (
    activeNetwork.configurationStatus !== 'configured' ||
    activeNetwork.chainId === null
  ) {
    throw new TransactionConstructionError('NETWORK_NOT_CONFIGURED');
  }
  if (!provider.isInitialized()) {
    throw new TransactionConstructionError('CONFIGURATION_ERROR');
  }
}

export class TransactionConstructionEngine {
  private readonly network: EvmNetwork;
  private readonly gasFeeEngine: GasFeeEngineDependency;
  private readonly accountStateService: AccountStateDependency;
  private readonly accounts: ReadonlyMap<string, PublicWalletAccount>;
  private readonly now: () => number;

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly provider: EvmRpcProvider,
    accounts: readonly PublicWalletAccount[],
    options: TransactionConstructionEngineOptions = {},
  ) {
    this.network = provider.getNetwork();
    this.gasFeeEngine =
      options.gasFeeEngine ?? new GasFeeEngine(registry, provider);
    this.accountStateService =
      options.accountStateService ?? new EvmAccountStateService(registry, provider);
    this.accounts = new Map(
      accounts.map((account) => {
        const address = normalizeAddress(account.address, 'INVALID_FROM_ADDRESS');
        return [address.toLowerCase(), { ...account, address }] as const;
      }),
    );
    this.now = options.now ?? (() => Date.now());
    assertMatchingContext(registry, provider, this.network);
  }

  getNetwork(): EvmNetwork {
    return this.network;
  }

  async construct(intent: TransactionIntent): Promise<TransactionPreview> {
    let normalized: NormalizedTransactionIntent | undefined;
    try {
      normalized = normalizeIntent(intent);
      return await this.runLogged(async () => {
        assertMatchingContext(
          this.registry,
          this.provider,
          this.network,
          normalized?.networkId,
        );
        if (!this.accounts.has(normalized?.from.toLowerCase() ?? '')) {
          throw new TransactionConstructionError('UNKNOWN_ACCOUNT');
        }

        const nonce =
          normalized.nonce ??
          (await this.accountStateService.getNonce(normalized.from)).value;
        assertMatchingContext(this.registry, this.provider, this.network);

        let gasLimit = normalized.gasLimit;
        if (gasLimit === undefined) {
          const estimate = await this.gasFeeEngine.estimateGas({
            from: normalized.from,
            to: normalized.to,
            value: normalized.value,
            data: normalized.data,
          });
          if (estimate.gasLimit === 0n) {
            throw new TransactionConstructionError('GAS_ESTIMATION_FAILED');
          }
          if (estimate.chainId !== BigInt(this.network.chainId as number)) {
            throw new TransactionConstructionError('CHAIN_ID_MISMATCH');
          }
          gasLimit = estimate.gasLimit;
        }
        assertMatchingContext(this.registry, this.provider, this.network);

        const feeData = await this.readFeeData(normalized.feePreference);
        if (feeData.model === 'unavailable') {
          throw new TransactionConstructionError('FEE_UNAVAILABLE');
        }
        if (feeData.chainId !== BigInt(this.network.chainId as number)) {
          throw new TransactionConstructionError('CHAIN_ID_MISMATCH');
        }
        assertMatchingContext(this.registry, this.provider, this.network);

        const feePerGas =
          feeData.model === 'legacy'
            ? feeData.gasPrice
            : feeData.maxFeePerGas;
        const estimatedNetworkFee = gasLimit * feePerGas;
        const totalMaximumNativeAmount = normalized.value + estimatedNetworkFee;
        const unsignedTransaction = makeUnsignedTransaction(
          normalized,
          this.network,
          BigInt(this.network.chainId as number),
          nonce,
          gasLimit,
          feeData,
        );
        const warnings =
          normalized.data === '0x'
            ? []
            : ['Contract interaction: review the transaction details carefully.'];
        const common = {
          networkName: this.network.displayName,
          networkId: this.network.id,
          chainId: BigInt(this.network.chainId as number),
          transactionType: normalized.transactionType,
          from: normalized.from,
          to: normalized.to,
          value: normalized.value,
          valueDisplay: formatNativeUnits(
            normalized.value,
            this.network.nativeCurrency.decimals,
          ),
          data: normalized.data,
          hasCalldata: normalized.data !== '0x',
          nonce,
          gasLimit,
          symbol: this.network.nativeCurrency.symbol,
          decimals: this.network.nativeCurrency.decimals,
          estimatedNetworkFee,
          estimatedNetworkFeeDisplay: formatNativeUnits(
            estimatedNetworkFee,
            this.network.nativeCurrency.decimals,
          ),
          totalMaximumNativeAmount,
          totalMaximumNativeAmountDisplay: formatNativeUnits(
            totalMaximumNativeAmount,
            this.network.nativeCurrency.decimals,
          ),
          warnings,
          unsignedTransaction,
        };
        if (feeData.model === 'legacy') {
          const preview: LegacyTransactionPreview = {
            ...common,
            feeModel: 'legacy',
            gasPrice: feeData.gasPrice,
          };
          return preview;
        }
        const preview: Eip1559TransactionPreview = {
          ...common,
          feeModel: 'eip1559',
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        };
        return preview;
      });
    } catch (error) {
      throw dependencyError(error);
    }
  }

  private async readFeeData(
    preference: TransactionFeePreference,
  ): Promise<Awaited<ReturnType<GasFeeEngineDependency['getFeeData']>>> {
    try {
      if (preference === 'legacy') {
        return await this.gasFeeEngine.getLegacyFeeData();
      }
      if (preference === 'eip1559') {
        return await this.gasFeeEngine.getEip1559FeeData();
      }
      return await this.gasFeeEngine.getFeeData();
    } catch (error) {
      throw dependencyError(error);
    }
  }

  private async runLogged<T>(action: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await action();
      secureLogger.debug('Unsigned transaction constructed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        durationMs: Math.max(0, this.now() - startedAt),
        success: true,
      });
      return result;
    } catch (error) {
      secureLogger.warning('Unsigned transaction construction failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: errorCategory(error),
      });
      throw error;
    }
  }
}

export async function createTransactionConstructionEngine(
  registry: NetworkRegistry,
  provider: EvmRpcProvider,
  accounts: readonly PublicWalletAccount[],
  options: TransactionConstructionEngineOptions = {},
): Promise<TransactionConstructionEngine> {
  if (!provider.isInitialized()) {
    await provider.initialize();
  }
  return new TransactionConstructionEngine(registry, provider, accounts, options);
}