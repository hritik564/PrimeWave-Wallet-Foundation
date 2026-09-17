import {
  AccountStateError,
  type EvmAccountStateService,
} from '@/src/core/blockchain/account-state';
import {
  RpcProviderError,
} from '@/src/core/blockchain/rpc';
import { AssetError } from '../errors';
import { formatAssetAmount } from '../amount';
import { AssetRegistry } from '../registry';
import type {
  NativeAssetBalance,
  NativeAssetBalanceRequest,
  NativeAssetBalanceServiceOptions,
  NetworkBoundAccountStateService,
} from '../models';

function mapBalanceError(error: unknown): AssetError {
  if (error instanceof AssetError) {
    return error;
  }
  if (error instanceof AccountStateError) {
    switch (error.code) {
      case 'INVALID_ADDRESS':
        return new AssetError('BALANCE_INVALID_ADDRESS');
      case 'NETWORK_CHANGED':
        return new AssetError('BALANCE_NETWORK_CHANGED');
      case 'CONFIGURATION_ERROR':
        return new AssetError('BALANCE_CONFIGURATION_ERROR');
    }
  }
  if (error instanceof RpcProviderError) {
    switch (error.code) {
      case 'NETWORK_UNAVAILABLE':
      case 'TIMEOUT':
      case 'ENDPOINT_UNAVAILABLE':
        return new AssetError('BALANCE_NETWORK_UNAVAILABLE');
      case 'CHAIN_ID_MISMATCH':
        return new AssetError('BALANCE_CHAIN_MISMATCH');
      case 'PROVIDER_NOT_INITIALIZED':
      case 'CONFIGURATION_ERROR':
        return new AssetError('BALANCE_CONFIGURATION_ERROR');
      default:
        return new AssetError('BALANCE_RPC_FAILURE');
    }
  }
  return new AssetError('BALANCE_RPC_FAILURE');
}

export class NativeAssetBalanceService {
  private readonly services = new Map<
    string,
    Pick<EvmAccountStateService, 'getNetwork' | 'getNativeBalance'>
  >();
  private readonly now: () => number;

  constructor(
    private readonly assets: AssetRegistry,
    accountStateServices: readonly NetworkBoundAccountStateService[],
    options: NativeAssetBalanceServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    for (const entry of accountStateServices) {
      const network = entry.service.getNetwork();
      if (this.services.has(network.id)) {
        throw new AssetError('ASSET_DUPLICATE_IDENTITY');
      }
      if (!this.assets.getNetworkRegistry().getById(network.id)) {
        throw new AssetError('ASSET_INVALID_METADATA');
      }
      this.services.set(network.id, entry.service);
    }
  }

  async getBalance(
    request: NativeAssetBalanceRequest,
  ): Promise<NativeAssetBalance> {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.networkId !== 'string' ||
      request.networkId.trim().length === 0 ||
      typeof request.accountId !== 'string' ||
      request.accountId.trim().length === 0
    ) {
      throw new AssetError('BALANCE_CONFIGURATION_ERROR');
    }

    const asset = this.assets.resolveNativeAsset(request.networkId);
    const service = this.services.get(request.networkId);
    if (!service) {
      throw new AssetError('BALANCE_NETWORK_UNAVAILABLE');
    }

    try {
      const result = await service.getNativeBalance(request.address);
      if (
        result.networkId !== asset.networkId ||
        result.chainId !== BigInt(asset.chainId) ||
        result.symbol !== asset.symbol ||
        result.decimals !== asset.decimals
      ) {
        throw new AssetError('BALANCE_CHAIN_MISMATCH');
      }
      return Object.freeze({
        kind: 'native-asset-balance',
        asset,
        assetIdentity: {
          assetType: asset.assetType,
          networkId: asset.networkId,
          assetId: asset.assetId,
        },
        networkId: asset.networkId,
        chainId: result.chainId,
        accountId: request.accountId,
        address: result.address,
        rawBalance: result.raw,
        decimals: asset.decimals,
        symbol: asset.symbol,
        displayAmount: formatAssetAmount(result.raw, asset.decimals),
        blockNumber: null,
        blockHash: null,
        retrievedAtMs: this.now(),
      });
    } catch (error) {
      throw mapBalanceError(error);
    }
  }
}