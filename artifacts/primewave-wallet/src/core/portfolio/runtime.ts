import { AssetRegistry, ERC20TokenService, NativeAssetBalanceService } from '@/src/core/assets';
import { EvmAccountStateService } from '@/src/core/blockchain/account-state';
import { createEvmRpcProvider } from '@/src/core/blockchain/rpc';
import { defaultNetworkRegistry, type NetworkRegistry } from '@/src/core/networks';
import { PortfolioAggregationService } from './service';
import { PortfolioReadModelService } from './portfolio-read-model-service';
import { PortfolioError } from './errors';

export function createAppPortfolioReadModelService(
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
): PortfolioReadModelService {
  return new PortfolioReadModelService({
    async getPortfolio(query) {
      const network = registry.getActiveNetwork();
      if (!network || network.id !== query.networkIds[0]) {
        throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
      }

      const provider = await createProvider(registry);
      const accountState = new EvmAccountStateService(registry, provider);
      const assets = new AssetRegistry(registry);
      const aggregation = new PortfolioAggregationService(
        assets,
        new NativeAssetBalanceService(assets, [{ service: accountState }]),
        new ERC20TokenService(assets, []),
        [{ accountState, provider }],
      );
      return aggregation.getPortfolio(query);
    },
  });
}
