import {
  AssetRegistry,
  ERC20TokenService,
  NativeAssetBalanceService,
  TokenDiscoveryService,
  TokenRegistry,
  InMemoryTokenPreferenceRepository,
  PersistentTokenPreferenceRepository,
  type TokenCandidate,
  type TokenAssetIdentity,
  type TokenPreferenceRepository,
  type TokenPreferencePersistenceState,
  type UserAddedTokenRequest,
  type TokenPreferenceKeyValueStorage,
  type TokenVisibility,
} from '@/src/core/assets';
import { EvmAccountStateService } from '@/src/core/blockchain/account-state';
import { createEvmRpcProvider } from '@/src/core/blockchain/rpc';
import { defaultNetworkRegistry, type NetworkRegistry } from '@/src/core/networks';
import { PortfolioAggregationService } from './service';
import { PortfolioReadModelError, PortfolioReadModelService } from './portfolio-read-model-service';
import { PortfolioError } from './errors';

type ReadProvider = Awaited<ReturnType<typeof createEvmRpcProvider>>;

export interface AppPortfolioRuntime {
  readonly readModel: PortfolioReadModelService;
  ready(): Promise<void>;
  registerToken(request: UserAddedTokenRequest): Promise<TokenCandidate>;
  setTokenVisibility(identity: TokenAssetIdentity, visibility: TokenVisibility): Promise<TokenCandidate>;
  getRegisteredTokens(): readonly TokenCandidate[];
  getPreferenceState(): 'loading' | 'ready' | 'write-failed' | 'unavailable' | 'cleared';
  subscribePreferenceState(listener: (state: TokenPreferencePersistenceState) => void): () => void;
  clear(): Promise<void>;
}

export interface AppPortfolioRuntimeOptions {
  readonly walletId?: string;
  readonly preferenceStorage?: TokenPreferenceKeyValueStorage;
}

export function createAppPortfolioRuntime(
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
  options: AppPortfolioRuntimeOptions = {},
): AppPortfolioRuntime {
  if (!!options.walletId !== !!options.preferenceStorage) {
    throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE');
  }
  const assets = new AssetRegistry(registry);
  const tokenRegistry = new TokenRegistry(assets);
  const repository: TokenPreferenceRepository = options.walletId && options.preferenceStorage
    ? new PersistentTokenPreferenceRepository(options.walletId, options.preferenceStorage)
    : new InMemoryTokenPreferenceRepository();
  const providers = new Map<string, { readonly chainId: number | null; readonly promise: Promise<ReadProvider> }>();
  const discoveries = new Map<string, TokenDiscoveryService>();
  const candidateCatalog = new Map<string, TokenCandidate>();
  let preferenceRecords = [] as Awaited<ReturnType<typeof repository.list>>;
  let retired = false;
  let lifecycleRevision = 0;
  const readyPromise = (async () => {
    try {
      await repository.ready?.();
      preferenceRecords = await repository.list();
    } catch {
      throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE');
    }
  })();
  void readyPromise.catch(() => undefined);
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
    await ensureReady();
    if (retired) throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE');
    const network = registry.getActiveNetwork();
    if (!network || network.id !== networkId) {
      throw new PortfolioError('PORTFOLIO_NETWORK_UNAVAILABLE');
    }
    const selectionRevision = registry.getSelectionRevision();
    const provider = await providerFor(networkId);
    if (registry.getActiveNetwork()?.id !== networkId ||
        registry.getSelectionRevision() !== selectionRevision ||
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
    const active = activeReaders;
    const networkPreferences = preferenceRecords.filter((record) => record.assetIdentity.networkId === networkId);
    for (const record of networkPreferences) {
      const identityKey = JSON.stringify([record.assetIdentity.networkId, record.assetIdentity.contractAddress]);
      const existing = candidateCatalog.get(identityKey);
      if (existing) {
        if (!active.discovery.getCandidate(existing.assetIdentity)) active.discovery.restoreCandidate(existing);
        continue;
      }
      if (record.chainId !== network.chainId) continue;
      try {
        const token = await active.tokens.getTokenMetadata({
          networkId,
          contractAddress: record.assetIdentity.contractAddress,
        });
        if (retired || registry.getActiveNetwork()?.id !== networkId ||
            registry.getSelectionRevision() !== selectionRevision ||
            active.provider !== provider) {
          throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
        }
        const candidate = active.discovery.restorePreference(record, token);
        candidateCatalog.set(identityKey, candidate);
      } catch (error) {
        if (error instanceof PortfolioReadModelError) throw error;
        // Keep the persisted identity for a future retry without presenting stale metadata or balances.
      }
    }
    if (retired || registry.getActiveNetwork()?.id !== networkId || registry.getSelectionRevision() !== selectionRevision) {
      throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
    }
    return { accountState, readService, ...activeReaders };
  };

  const ensureReady = async () => {
    try { await readyPromise; }
    catch { throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE'); }
  };

  const readModel = new PortfolioReadModelService({
    async getPortfolio(query) {
      await ensureReady();
      const requestRevision = lifecycleRevision;
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
      const portfolio = await aggregation.getPortfolio({ ...query, tokenIdentities: identities });
      if (retired || lifecycleRevision !== requestRevision) {
        throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
      }
      return portfolio;
    },
  });

  return Object.freeze({
    readModel,
    ready: ensureReady,
    async registerToken(request: UserAddedTokenRequest): Promise<TokenCandidate> {
      await ensureReady();
      if (retired) throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE');
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
    async setTokenVisibility(identity: TokenAssetIdentity, visibility: TokenVisibility): Promise<TokenCandidate> {
      await ensureReady();
      if (retired) throw new PortfolioReadModelError('READ_MODEL_PREFERENCES_UNAVAILABLE');
      const candidate = candidateCatalog.get(JSON.stringify([identity.networkId, identity.contractAddress]));
      if (!candidate) throw new PortfolioReadModelError('READ_MODEL_AGGREGATION_FAILED');
      const { discovery } = await servicesFor(identity.networkId);
      const updated = await discovery.setVisibility(identity, visibility);
      candidateCatalog.set(JSON.stringify([identity.networkId, identity.contractAddress]), updated);
      return updated;
    },
    getRegisteredTokens,
    getPreferenceState: () => repository.getPersistenceState?.() ?? 'ready',
    subscribePreferenceState: (listener: (state: TokenPreferencePersistenceState) => void) => repository.subscribePersistenceState?.(listener) ?? (() => undefined),
    async clear() {
      retired = true;
      lifecycleRevision += 1;
      if (repository.clearDurable) await repository.clearDurable();
      else for (const record of await repository.list()) await repository.delete(record.assetIdentity);
      candidateCatalog.clear();
      preferenceRecords = [];
      discoveries.clear();
      activeReaders = null;
    },
  });
}

/** Returns no native runtime in Preview Test Mode or before a wallet session exists. */
export function createWalletPortfolioRuntime(
  input: { readonly previewMode: boolean; readonly walletId: string | null; readonly preferenceStorage: TokenPreferenceKeyValueStorage },
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
): AppPortfolioRuntime | null {
  if (input.previewMode || !input.walletId) return null;
  return createAppPortfolioRuntime(registry, createProvider, {
    walletId: input.walletId,
    preferenceStorage: input.preferenceStorage,
  });
}

export function createAppPortfolioReadModelService(
  registry: NetworkRegistry = defaultNetworkRegistry,
  createProvider = createEvmRpcProvider,
): PortfolioReadModelService {
  return createAppPortfolioRuntime(registry, createProvider).readModel;
}
