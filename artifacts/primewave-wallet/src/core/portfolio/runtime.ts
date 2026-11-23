import {
  AssetRegistry,
  ERC20TokenService,
  NativeAssetBalanceService,
  TokenDiscoveryService,
  TokenRegistry,
  InMemoryTokenPreferenceRepository,
  type TokenCandidate,
  type UserAddedTokenRequest,
} from '@/src/core/assets';
import { EvmAccountStateService } from '@/src/core/blockchain/account-state';
import { createEvmRpcProvider } from '@/src/core/blockchain/rpc';
import { defaultNetworkRegistry, type NetworkRegistry } from '@/src/core/networks';
import { PortfolioAggregationService } from './service';
import { PortfolioReadModelService } from './portfolio-read-model-service';
import { PortfolioError } from './errors';

type ReadProvider = Awaited<ReturnType<typeof createEvmRpcProvider>>;

export interface AppPortfolioRuntime {
  readonly readModel: PortfolioReadModelService;
  registerToken(request: UserAddedTokenRequest): Promise<TokenCandidate>;
  getRegisteredTokens(): readonly TokenCandidate[];
}

export function createAppPortfolioRuntime(
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
): AppPortfolioRuntime {
  const assets = new AssetRegistry(registry);
  const tokenRegistry = new TokenRegistry(assets);
  const repository = new InMemoryTokenPreferenceRepository();
  const providers = new Map<string, { readonly chainId: number | null; readonly promise: Promise<ReadProvider> }>();
  const discoveries = new Map<string, TokenDiscoveryService>();
  const candidateCatalog = new Map<string, TokenCandidate>();
  let activeReaders: {
    networkId: string;
    provider: ReadProvider;
    tokens: ERC20TokenService;
    discovery: TokenDiscoveryService;
  } | null = null;
  const getRegisteredTokens = () =>
    Object.freeze([...candidateCatalog.values()]);

  const providerFor = (networkId: string): Promise<ReadProvider> => {
    const network = registry.getById(networkId);
    if (!network || network.configurationStatus !== 'configured' || network.chainId === null) {
      throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
    }
    const cached = providers.get(networkId);
    if (cached?.chainId === network.chainId) return cached.promise;
    const promise = createProvider(registry);
    const entry = { chainId: network.chainId, promise };
    providers.set(networkId, entry);
    void promise.catch(() => {
      if (providers.get(networkId) === entry) providers.delete(networkId);
    });
    return promise;
  };

  const servicesFor = async (networkId: string) => {
    const network = registry.getActiveNetwork();
    if (!network || network.id !== networkId) {
      throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
    }
    const provider = await providerFor(networkId);
    if (registry.getActiveNetwork()?.id !== networkId ||
        provider.getNetwork().id !== networkId ||
        provider.getNetwork().chainId !== network.chainId) {
      providers.delete(networkId);
      throw new PortfolioError('PORTFOLIO_NETWORK_CHANGED');
    }
    const accountState = new EvmAccountStateService(registry, provider);
    const readService = { accountState, provider };
    if (
      activeReaders?.networkId !== networkId ||
      activeReaders.provider !== provider
    ) {
      const tokens = new ERC20TokenService(assets, [readService], {}, tokenRegistry);
      const discovery = new TokenDiscoveryService(tokens, [readService], { repository });
      for (const candidate of candidateCatalog.values()) {
        if (candidate.assetIdentity.networkId === networkId) {
          discovery.restoreCandidate(candidate);
        }
      }
      activeReaders = { networkId, provider, tokens, discovery };
      discoveries.set(networkId, discovery);
    }
    return { accountState, readService, ...activeReaders };
  };

  const readModel = new PortfolioReadModelService({
    async getPortfolio(query) {
      const networkId = query.networkIds[0];
      if (!networkId) throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
      const { accountState, readService, tokens, discovery } = await servicesFor(networkId);
      const aggregation = new PortfolioAggregationService(
        assets,
        new NativeAssetBalanceService(assets, [{ service: accountState }]),
        tokens,
        [readService],
        { tokenDiscoveryService: discovery },
      );
      const identities =
        query.tokenIdentities ??
        discovery
          .getCandidates()
          .filter((candidate) => candidate.assetIdentity.networkId === networkId)
          .map((candidate) => candidate.assetIdentity);
      return aggregation.getPortfolio({ ...query, tokenIdentities: identities });
    },
  });

  return Object.freeze({
    readModel,
    async registerToken(request: UserAddedTokenRequest): Promise<TokenCandidate> {
      const { discovery } = await servicesFor(request.networkId);
      const candidate = await discovery.addUserToken(request);
      candidateCatalog.set(
        JSON.stringify([
          candidate.assetIdentity.networkId,
          candidate.assetIdentity.contractAddress,
        ]),
        candidate,
      );
      return candidate;
    },
    getRegisteredTokens,
  });
}

export function createAppPortfolioReadModelService(
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
): PortfolioReadModelService {
  return createAppPortfolioRuntime(registry, createProvider).readModel;
}
