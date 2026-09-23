import {
  AssetRegistry,
  ERC20TokenService,
  NativeAssetBalanceService,
} from '@/src/core/assets';
import {
  EvmAccountStateService,
} from '@/src/core/blockchain/account-state';
import {
  createEvmRpcProvider,
  type EvmRpcProvider,
} from '@/src/core/blockchain/rpc';
import {
  defaultNetworkRegistry,
  type NetworkRegistry,
} from '@/src/core/networks';
import {
  PortfolioAggregationService,
  PortfolioReadModelError,
  PortfolioReadModelService,
  type PortfolioReadModel,
  type PortfolioReadModelQuery,
  type PortfolioReadModelService as PortfolioReadModelServiceType,
} from '@/src/core/portfolio';
import { secureLogger } from '@/src/core/security/logging';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import {
  isPreviewTestModeAvailable,
  PREVIEW_TEST_ADDRESS,
} from './preview-test-mode';

export interface PreviewPortfolioServiceOptions {
  readonly createProvider?: (registry: NetworkRegistry) => Promise<EvmRpcProvider>;
}

type PreviewPortfolioReadModelService = Pick<
  PortfolioReadModelServiceType,
  'getPortfolio'
>;

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'UNEXPECTED_ERROR';
}

/**
 * Development-only portfolio adapter.
 *
 * It deliberately constructs the normal public read stack per request and
 * never receives a wallet, vault, signer, or transaction dependency. The
 * selected network's existing RPC endpoint is the only balance source.
 */
export function createPreviewPortfolioReadModelService(
  registry: NetworkRegistry = defaultNetworkRegistry,
  options: PreviewPortfolioServiceOptions = {},
): PreviewPortfolioReadModelService {
  const createProvider =
    options.createProvider ??
    ((networkRegistry: NetworkRegistry) => createEvmRpcProvider(networkRegistry));

  return {
    async getPortfolio(
      query: PortfolioReadModelQuery,
    ): Promise<PortfolioReadModel> {
      if (!isPreviewTestModeAvailable()) {
        throw new PortfolioReadModelError('READ_MODEL_AGGREGATION_FAILED');
      }

      let normalizedAddress: string;
      try {
        normalizedAddress = normalizePublicEvmAddress(query.accountAddress);
      } catch {
        throw new PortfolioReadModelError('READ_MODEL_INVALID_REQUEST');
      }
      if (normalizedAddress.toLowerCase() !== PREVIEW_TEST_ADDRESS.toLowerCase()) {
        throw new PortfolioReadModelError('READ_MODEL_INVALID_REQUEST');
      }

      const activeNetwork = registry.getActiveNetwork();
      if (!activeNetwork || activeNetwork.id !== query.networkId) {
        throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
      }

      secureLogger.debug('Preview portfolio read started', {
        networkId: activeNetwork.id,
        chainId: activeNetwork.chainId,
        address: normalizedAddress,
      });

      try {
        const provider = await createProvider(registry);
        const accountState = new EvmAccountStateService(registry, provider);
        const assets = new AssetRegistry(registry);
        const nativeBalanceService = new NativeAssetBalanceService(assets, [
          { service: accountState },
        ]);
        const tokenService = new ERC20TokenService(assets, []);
        const aggregation = new PortfolioAggregationService(
          assets,
          nativeBalanceService,
          tokenService,
          [{ accountState, provider }],
        );

        const model = await new PortfolioReadModelService(aggregation).getPortfolio(query);
        secureLogger.debug('Preview portfolio read completed', {
          networkId: activeNetwork.id,
          chainId: activeNetwork.chainId,
          address: normalizedAddress,
          assetCount: model.assets.length,
          state: model.state,
        });
        return model;
      } catch (error) {
        secureLogger.warning('Preview portfolio read failed', {
          networkId: activeNetwork.id,
          chainId: activeNetwork.chainId,
          address: normalizedAddress,
          errorCode: errorCode(error),
        });
        throw error;
      }
    },
  };
}