import { secureLogger } from '@/src/core/security/logging';
import {
  EvmRpcProvider,
  RpcProviderError,
  type RpcBlockTag,
} from '@/src/core/blockchain/rpc';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { AccountStateError } from './errors';
import { normalizePublicEvmAddress } from './address';
import type {
  AccountNonceState,
  AccountStateNetworkContext,
  AccountStateServiceOptions,
  AccountStateSnapshot,
  ContractCodeState,
  EvmChainState,
  LatestBlockState,
  NativeBalanceState,
} from './types';

function parseQuantity(value: string, method: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) {
    throw new RpcProviderError('INVALID_RESPONSE', { method });
  }
  try {
    return BigInt(value);
  } catch {
    throw new RpcProviderError('INVALID_RESPONSE', { method });
  }
}

function quantityToBlockTag(value: bigint): RpcBlockTag {
  return `0x${value.toString(16)}`;
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction.length === 0
    ? whole.toString()
    : `${whole.toString()}.${trimmedFraction}`;
}

function parseBlock(
  block: Record<string, unknown> | null,
): LatestBlockState | null {
  if (block === null) {
    return null;
  }

  const blockNumber =
    block.number === undefined || block.number === null
      ? null
      : parseQuantityField(block.number, 'eth_getBlockByNumber');
  const timestamp =
    block.timestamp === undefined || block.timestamp === null
      ? null
      : parseQuantityField(block.timestamp, 'eth_getBlockByNumber');
  const hash =
    block.hash === undefined || block.hash === null
      ? null
      : typeof block.hash === 'string' && block.hash.length > 0
        ? block.hash
        : null;

  if (
    (block.number !== undefined &&
      block.number !== null &&
      blockNumber === null) ||
    (block.timestamp !== undefined &&
      block.timestamp !== null &&
      timestamp === null) ||
    (block.hash !== undefined && block.hash !== null && hash === null)
  ) {
    throw new RpcProviderError('INVALID_RESPONSE', {
      method: 'eth_getBlockByNumber',
    });
  }

  return { number: blockNumber, hash, timestamp };
}

function parseQuantityField(value: unknown, method: string): bigint | null {
  return typeof value === 'string' ? parseQuantity(value, method) : null;
}

function classifyCode(code: `0x${string}`): ContractCodeState['kind'] {
  return code === '0x' ? 'externally-owned-account' : 'contract';
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorCategory(error: unknown): string {
  if (error instanceof RpcProviderError) {
    return error.code;
  }
  if (error instanceof AccountStateError) {
    return error.code;
  }
  return 'UNEXPECTED_ERROR';
}

export class EvmAccountStateService {
  private readonly now: () => number;
  private readonly network: EvmNetwork;

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly provider: EvmRpcProvider,
    options: AccountStateServiceOptions = {},
  ) {
    this.network = provider.getNetwork();
    this.now = options.now ?? (() => Date.now());
    this.assertNetworkUnchanged();
  }

  getNetwork(): EvmNetwork {
    return this.network;
  }

  /**
   * Allows other read-only blockchain layers to reuse the same captured
   * network-consistency guard without exposing the provider or registry.
   */
  assertNetworkContext(): void {
    this.assertNetworkUnchanged();
  }

  async getNativeBalance(address: unknown): Promise<NativeBalanceState> {
    const normalizedAddress = normalizePublicEvmAddress(address);
    return this.runLogged('native-balance', normalizedAddress, async () => {
      const chainId = await this.readVerifiedChainId();
      const rawHex = await this.provider.request('eth_getBalance', [
        normalizedAddress,
        'latest',
      ]);
      this.assertNetworkUnchanged();
      const raw = parseQuantity(rawHex, 'eth_getBalance');
      return {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        symbol: this.network.nativeCurrency.symbol,
        decimals: this.network.nativeCurrency.decimals,
        raw,
        display: formatUnits(raw, this.network.nativeCurrency.decimals),
      };
    });
  }

  async getChainState(): Promise<EvmChainState> {
    return this.runLogged('chain-state', undefined, async () => {
      const chainId = await this.readVerifiedChainId();
      const blockNumberHex = await this.provider.request('eth_blockNumber', []);
      this.assertNetworkUnchanged();
      return {
        networkId: this.network.id,
        chainId,
        latestBlockNumber: parseQuantity(blockNumberHex, 'eth_blockNumber'),
      };
    });
  }

  async getNonce(address: unknown): Promise<AccountNonceState> {
    const normalizedAddress = normalizePublicEvmAddress(address);
    return this.runLogged('account-nonce', normalizedAddress, async () => {
      const chainId = await this.readVerifiedChainId();
      const nonceHex = await this.provider.request('eth_getTransactionCount', [
        normalizedAddress,
        'latest',
      ]);
      this.assertNetworkUnchanged();
      return {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        value: parseQuantity(nonceHex, 'eth_getTransactionCount'),
      };
    });
  }

  async getContractCode(address: unknown): Promise<ContractCodeState> {
    const normalizedAddress = normalizePublicEvmAddress(address);
    return this.runLogged('contract-code', normalizedAddress, async () => {
      const chainId = await this.readVerifiedChainId();
      const code = await this.provider.request('eth_getCode', [
        normalizedAddress,
        'latest',
      ]);
      this.assertNetworkUnchanged();
      return {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        kind: classifyCode(code),
        hasCode: code !== '0x',
        code,
      };
    });
  }

  async getLatestBlock(): Promise<LatestBlockState | null> {
    return this.runLogged('latest-block', undefined, async () => {
      const { latestBlockNumber } = await this.readChainStateInternal();
      const blockTag = quantityToBlockTag(latestBlockNumber);
      const block = await this.provider.request('eth_getBlockByNumber', [
        blockTag,
        false,
      ]);
      this.assertNetworkUnchanged();
      return parseBlock(block);
    });
  }

  async getSnapshot(address: unknown): Promise<AccountStateSnapshot> {
    const normalizedAddress = normalizePublicEvmAddress(address);
    return this.runLogged('account-snapshot', normalizedAddress, async () => {
      const { chainId, latestBlockNumber } =
        await this.readChainStateInternal();
      const blockTag = quantityToBlockTag(latestBlockNumber);
      const [balanceHex, nonceHex, code, block] = await Promise.all([
        this.provider.request('eth_getBalance', [normalizedAddress, blockTag]),
        this.provider.request('eth_getTransactionCount', [
          normalizedAddress,
          blockTag,
        ]),
        this.provider.request('eth_getCode', [normalizedAddress, blockTag]),
        this.provider.request('eth_getBlockByNumber', [blockTag, false]),
      ]);
      this.assertNetworkUnchanged();

      const raw = parseQuantity(balanceHex, 'eth_getBalance');
      const nativeBalance: NativeBalanceState = {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        symbol: this.network.nativeCurrency.symbol,
        decimals: this.network.nativeCurrency.decimals,
        raw,
        display: formatUnits(raw, this.network.nativeCurrency.decimals),
      };
      const codeState: ContractCodeState = {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        kind: classifyCode(code),
        hasCode: code !== '0x',
        code,
      };

      return {
        address: normalizedAddress,
        networkId: this.network.id,
        chainId,
        nativeBalance,
        nonce: parseQuantity(nonceHex, 'eth_getTransactionCount'),
        code: codeState,
        latestBlock: parseBlock(block),
        retrievedAtMs: this.now(),
      };
    });
  }

  async refresh(address: unknown): Promise<AccountStateSnapshot> {
    return this.getSnapshot(address);
  }

  private async readVerifiedChainId(): Promise<bigint> {
    this.assertNetworkUnchanged();
    const chainIdHex = await this.provider.request('eth_chainId', []);
    const chainId = parseQuantity(chainIdHex, 'eth_chainId');
    const expectedChainId = BigInt(this.network.chainId as number);
    if (chainId !== expectedChainId) {
      throw new RpcProviderError('CHAIN_ID_MISMATCH', {
        endpointId: this.provider.getEndpointId(),
        method: 'eth_chainId',
      });
    }
    this.assertNetworkUnchanged();
    return chainId;
  }

  private async readChainStateInternal(): Promise<EvmChainState> {
    const chainId = await this.readVerifiedChainId();
    const blockNumberHex = await this.provider.request('eth_blockNumber', []);
    const latestBlockNumber = parseQuantity(
      blockNumberHex,
      'eth_blockNumber',
    );
    this.assertNetworkUnchanged();
    return {
      networkId: this.network.id,
      chainId,
      latestBlockNumber,
    };
  }

  private assertReady(): void {
    if (!this.provider.isInitialized()) {
      throw new AccountStateError('CONFIGURATION_ERROR');
    }
  }

  private assertNetworkUnchanged(): void {
    const activeNetwork = this.registry.getActiveNetwork();
    if (
      !activeNetwork ||
      activeNetwork.id !== this.network.id ||
      activeNetwork.chainId !== this.network.chainId
    ) {
      throw new AccountStateError('NETWORK_CHANGED');
    }
    this.assertReady();
  }

  private async runLogged<T>(
    operation: string,
    address: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await action();
      secureLogger.debug('Account state read completed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        operation,
        address: address ? maskAddress(address) : null,
        durationMs: Math.max(0, this.now() - startedAt),
        success: true,
      });
      return result;
    } catch (error) {
      secureLogger.warning('Account state read failed', {
        networkId: this.network.id,
        chainId: this.network.chainId,
        endpointId: this.provider.getEndpointId(),
        operation,
        address: address ? maskAddress(address) : null,
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: errorCategory(error),
      });
      throw error;
    }
  }
}

export async function createEvmAccountStateService(
  registry: NetworkRegistry,
  provider: EvmRpcProvider,
  options: AccountStateServiceOptions = {},
): Promise<EvmAccountStateService> {
  if (!provider.isInitialized()) {
    await provider.initialize();
  }
  return new EvmAccountStateService(registry, provider, options);
}