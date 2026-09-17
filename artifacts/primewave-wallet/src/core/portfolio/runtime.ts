import { AssetRegistry, ERC20TokenService, NativeAssetBalanceService } from '@/src/core/assets';
import { defaultNetworkRegistry } from '@/src/core/networks';
import { PortfolioAggregationService } from './service';
import { PortfolioReadModelService } from './portfolio-read-model-service';

/**
 * Creates the app's initial read-model boundary.
 *
 * Phase 4.1 does not select or switch networks. The primary PrimeWave network
 * remains an explicit placeholder in the registry, so the aggregation layer
 * will return an honest unavailable result until a configured network is
 * selected by a later phase. Keeping the service wired here means the UI still
 * consumes the same production read-model path without inventing a second
 * balance source for the shell.
 */
export function createAppPortfolioReadModelService(): PortfolioReadModelService {
  const assets = new AssetRegistry(defaultNetworkRegistry);
  const nativeBalanceService = new NativeAssetBalanceService(assets, []);
  const tokenService = new ERC20TokenService(assets, []);
  const aggregation = new PortfolioAggregationService(
    assets,
    nativeBalanceService,
    tokenService,
    [],
  );
  return new PortfolioReadModelService(aggregation);
}