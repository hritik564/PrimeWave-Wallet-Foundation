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

      return new PortfolioReadModelService(aggregation).getPortfolio(query);
    },
  };
}