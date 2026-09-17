import type {
  BlockExplorerConfiguration,
  EvmNetwork,
  NativeCurrency,
  NetworkEnvironment,
  RpcEndpoint,
} from './types';

export type NetworkRegistryErrorCode =
  | 'INVALID_NETWORK'
  | 'DUPLICATE_NETWORK_ID'
  | 'DUPLICATE_CHAIN_ID'
  | 'PRIMARY_NETWORK_INVALID'
  | 'NETWORK_NOT_FOUND'
  | 'NETWORK_DISABLED'
  | 'NETWORK_NOT_CONFIGURED';

export class NetworkRegistryError extends Error {
  constructor(
    public readonly code: NetworkRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkRegistryError';
  }
}

const NETWORK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const TEMPLATE_TOKEN_PATTERN = /\{(address|txHash)\}/g;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function failInvalid(message: string): never {
  throw new NetworkRegistryError('INVALID_NETWORK', message);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    failInvalid(`${label} must not be empty.`);
  }
}

function parsePublicUrl(
  value: string,
  label: string,
  environment: NetworkEnvironment,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    failInvalid(`${label} must be a valid URL.`);
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    failInvalid(`${label} must not contain credentials, query parameters, or fragments.`);
  }

  if (parsed.protocol !== 'https:') {
    const isAllowedLocalDevelopmentUrl =
      environment === 'development' &&
      parsed.protocol === 'http:' &&
      LOCAL_HOSTS.has(parsed.hostname);
    if (!isAllowedLocalDevelopmentUrl) {
      failInvalid(`${label} must use HTTPS outside local development.`);
    }
  }

  return parsed;
}

function validateNativeCurrency(currency: NativeCurrency): void {
  assertNonEmpty(currency.name, 'Native currency name');
  if (!SYMBOL_PATTERN.test(currency.symbol)) {
    failInvalid(
      'Native currency symbol must be 2-10 uppercase letters or digits.',
    );
  }
  if (
    !Number.isSafeInteger(currency.decimals) ||
    currency.decimals < 0 ||
    currency.decimals > 36
  ) {
    failInvalid('Native currency decimals must be a safe integer from 0 to 36.');
  }
}

function validateRpcEndpoints(
  endpoints: readonly RpcEndpoint[],
  environment: NetworkEnvironment,
  isPlaceholder: boolean,
): void {
  if (isPlaceholder && endpoints.length > 0) {
    failInvalid('Placeholder networks cannot contain RPC endpoints.');
  }
  if (!isPlaceholder && endpoints.length === 0) {
    failInvalid('Configured networks must contain at least one RPC endpoint.');
  }

  const endpointIds = new Set<string>();
  const priorities = new Set<number>();
  for (const endpoint of endpoints) {
    assertNonEmpty(endpoint.id, 'RPC endpoint ID');
    if (endpointIds.has(endpoint.id)) {
      failInvalid(`RPC endpoint ID is duplicated: ${endpoint.id}.`);
    }
    endpointIds.add(endpoint.id);

    if (!Number.isSafeInteger(endpoint.priority) || endpoint.priority < 0) {
      failInvalid(`RPC endpoint priority is invalid: ${endpoint.id}.`);
    }
    if (priorities.has(endpoint.priority)) {
      failInvalid(`RPC endpoint priority is duplicated: ${endpoint.priority}.`);
    }
    priorities.add(endpoint.priority);

    parsePublicUrl(endpoint.url, `RPC endpoint ${endpoint.id}`, environment);
  }
}

function validateExplorer(
  explorer: BlockExplorerConfiguration,
  environment: NetworkEnvironment,
  isPlaceholder: boolean,
): void {
  assertNonEmpty(explorer.name, 'Block explorer name');
  if (isPlaceholder) {
    if (
      explorer.baseUrl !== null ||
      explorer.addressUrlTemplate !== null ||
      explorer.transactionUrlTemplate !== null
    ) {
      failInvalid('Placeholder networks cannot contain explorer URLs.');
    }
    return;
  }

  if (explorer.baseUrl === null) {
    failInvalid('Configured networks must contain a block explorer URL.');
  }
  parsePublicUrl(explorer.baseUrl, 'Block explorer URL', environment);

  if (
    explorer.addressUrlTemplate === null ||
    explorer.transactionUrlTemplate === null
  ) {
    failInvalid('Configured networks must contain explorer URL templates.');
  }
  validateTemplate(explorer.addressUrlTemplate, 'address', 'address');
  validateTemplate(explorer.transactionUrlTemplate, 'transaction', 'txHash');
}

function validateTemplate(
  template: string,
  label: string,
  requiredToken: 'address' | 'txHash',
): void {
  assertNonEmpty(template, `${label} explorer URL template`);
  const tokens = [...template.matchAll(TEMPLATE_TOKEN_PATTERN)].map(
    (match) => match[1],
  );
  if (tokens.length !== 1 || tokens[0] !== requiredToken) {
    failInvalid(
      `${label} explorer URL template must contain exactly {${requiredToken}}.`,
    );
  }
  const parsed = parsePublicUrl(
    template.replace(`{${requiredToken}}`, 'placeholder'),
    `${label} explorer URL template`,
    'mainnet',
  );
  if (!parsed.pathname.includes('placeholder')) {
    failInvalid(`${label} explorer URL template must place its token in the path.`);
  }
}

export function validateEvmNetwork(network: EvmNetwork): void {
  if (!NETWORK_ID_PATTERN.test(network.id)) {
    failInvalid(
      'Network ID must use lowercase letters, digits, and single hyphens.',
    );
  }
  assertNonEmpty(network.displayName, 'Network display name');
  validateNativeCurrency(network.nativeCurrency);

  const isPlaceholder = network.configurationStatus === 'placeholder';
  if (isPlaceholder && !network.isPrimary) {
    failInvalid('Only the primary network may use placeholder configuration.');
  }
  if (isPlaceholder && !network.configurationNote?.trim()) {
    failInvalid('Placeholder networks must explain their missing configuration.');
  }
  if (
    network.configurationStatus !== 'configured' &&
    network.configurationStatus !== 'placeholder'
  ) {
    failInvalid('Network configuration status is invalid.');
  }

  if (network.chainId !== null) {
    if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) {
      failInvalid('Chain ID must be a positive safe integer.');
    }
  } else if (!isPlaceholder) {
    failInvalid('Only placeholder networks may omit a chain ID.');
  }

  validateRpcEndpoints(network.rpc.endpoints, network.environment, isPlaceholder);
  validateExplorer(network.explorer, network.environment, isPlaceholder);

  if (network.environment === 'mainnet' && network.chainId === null) {
    if (!isPlaceholder || !network.isPrimary) {
      failInvalid('Mainnet networks must have a configured chain ID.');
    }
  }
}

function createRpcEndpoint(
  id: string,
  url: string,
  priority = 0,
): RpcEndpoint {
  return { id, url, priority };
}

function createExplorer(
  name: string,
  baseUrl: string,
  addressUrlTemplate: string,
  transactionUrlTemplate: string,
): BlockExplorerConfiguration {
  return { name, baseUrl, addressUrlTemplate, transactionUrlTemplate };
}

const placeholderExplorer: BlockExplorerConfiguration = {
  name: 'PrimeWave Explorer',
  baseUrl: null,
  addressUrlTemplate: null,
  transactionUrlTemplate: null,
};

const primeWaveNetwork: EvmNetwork = {
  id: 'primewave',
  displayName: 'PrimeWave Chain',
  chainId: null,
  nativeCurrency: {
    name: 'PrimeWave native currency',
    symbol: 'TBD',
    decimals: 18,
  },
  rpc: { endpoints: [] },
  explorer: placeholderExplorer,
  environment: 'mainnet',
  isPrimary: true,
  enabled: true,
  configurationStatus: 'placeholder',
  configurationNote:
    'PrimeWave Chain launch configuration must be supplied and reviewed before activation.',
};

function createMainnetNetwork(
  id: string,
  displayName: string,
  chainId: number,
  currency: NativeCurrency,
  rpcUrl: string,
  explorer: BlockExplorerConfiguration,
): EvmNetwork {
  return {
    id,
    displayName,
    chainId,
    nativeCurrency: currency,
    rpc: { endpoints: [createRpcEndpoint('public', rpcUrl)] },
    explorer,
    environment: 'mainnet',
    isPrimary: false,
    enabled: true,
    configurationStatus: 'configured',
  };
}

export const supportedNetworks: readonly EvmNetwork[] = [
  primeWaveNetwork,
  createMainnetNetwork(
    'ethereum',
    'Ethereum',
    1,
    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    'https://ethereum-rpc.publicnode.com',
    createExplorer(
      'Etherscan',
      'https://etherscan.io',
      'https://etherscan.io/address/{address}',
      'https://etherscan.io/tx/{txHash}',
    ),
  ),
  createMainnetNetwork(
    'bnb-smart-chain',
    'BNB Smart Chain',
    56,
    { name: 'BNB', symbol: 'BNB', decimals: 18 },
    'https://bsc-rpc.publicnode.com',
    createExplorer(
      'BscScan',
      'https://bscscan.com',
      'https://bscscan.com/address/{address}',
      'https://bscscan.com/tx/{txHash}',
    ),
  ),
  createMainnetNetwork(
    'polygon',
    'Polygon',
    137,
    { name: 'POL', symbol: 'POL', decimals: 18 },
    'https://polygon-bor-rpc.publicnode.com',
    createExplorer(
      'PolygonScan',
      'https://polygonscan.com',
      'https://polygonscan.com/address/{address}',
      'https://polygonscan.com/tx/{txHash}',
    ),
  ),
  createMainnetNetwork(
    'arbitrum',
    'Arbitrum One',
    42161,
    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    'https://arbitrum-one-rpc.publicnode.com',
    createExplorer(
      'Arbiscan',
      'https://arbiscan.io',
      'https://arbiscan.io/address/{address}',
      'https://arbiscan.io/tx/{txHash}',
    ),
  ),
  createMainnetNetwork(
    'base',
    'Base',
    8453,
    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    'https://base-rpc.publicnode.com',
    createExplorer(
      'BaseScan',
      'https://basescan.org',
      'https://basescan.org/address/{address}',
      'https://basescan.org/tx/{txHash}',
    ),
  ),
  createMainnetNetwork(
    'optimism',
    'Optimism',
    10,
    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    'https://optimism-rpc.publicnode.com',
    createExplorer(
      'Optimism Etherscan',
      'https://optimistic.etherscan.io',
      'https://optimistic.etherscan.io/address/{address}',
      'https://optimistic.etherscan.io/tx/{txHash}',
    ),
  ),
];

export class NetworkRegistry {
  private readonly networks: readonly EvmNetwork[];
  private activeNetworkId: string | null = null;

  constructor(networks: readonly EvmNetwork[]) {
    if (networks.length === 0) {
      throw new NetworkRegistryError(
        'PRIMARY_NETWORK_INVALID',
        'The network registry must contain a primary network.',
      );
    }

    const ids = new Set<string>();
    const chainIds = new Set<number>();
    const primaryNetworks: EvmNetwork[] = [];

    for (const network of networks) {
      validateEvmNetwork(network);
      if (ids.has(network.id)) {
        throw new NetworkRegistryError(
          'DUPLICATE_NETWORK_ID',
          `Network ID is duplicated: ${network.id}.`,
        );
      }
      ids.add(network.id);

      if (network.chainId !== null) {
        if (chainIds.has(network.chainId)) {
          throw new NetworkRegistryError(
            'DUPLICATE_CHAIN_ID',
            `Chain ID is duplicated: ${network.chainId}.`,
          );
        }
        chainIds.add(network.chainId);
      }

      if (network.isPrimary) {
        primaryNetworks.push(network);
      }
    }

    if (primaryNetworks.length !== 1) {
      throw new NetworkRegistryError(
        'PRIMARY_NETWORK_INVALID',
        'The network registry must contain exactly one primary network.',
      );
    }
    if (!primaryNetworks[0].enabled) {
      throw new NetworkRegistryError(
        'PRIMARY_NETWORK_INVALID',
        'The primary network must be enabled.',
      );
    }

    this.networks = Object.freeze([...networks]);
  }

  listEnabledNetworks(): readonly EvmNetwork[] {
    return this.networks.filter((network) => network.enabled);
  }

  getById(id: string): EvmNetwork | undefined {
    return this.networks.find((network) => network.id === id);
  }

  getByChainId(chainId: number): EvmNetwork | undefined {
    return this.networks.find((network) => network.chainId === chainId);
  }

  getPrimaryNetwork(): EvmNetwork {
    return this.networks.find((network) => network.isPrimary) as EvmNetwork;
  }

  getActiveNetwork(): EvmNetwork | null {
    return this.activeNetworkId === null
      ? null
      : (this.getById(this.activeNetworkId) ?? null);
  }

  selectActiveNetwork(networkId: string): EvmNetwork {
    const network = this.getById(networkId);
    if (!network) {
      throw new NetworkRegistryError(
        'NETWORK_NOT_FOUND',
        `Network was not found: ${networkId}.`,
      );
    }
    if (!network.enabled) {
      throw new NetworkRegistryError(
        'NETWORK_DISABLED',
        `Network is disabled: ${networkId}.`,
      );
    }
    if (network.configurationStatus !== 'configured') {
      throw new NetworkRegistryError(
        'NETWORK_NOT_CONFIGURED',
        `Network is not configured for activation: ${networkId}.`,
      );
    }

    this.activeNetworkId = network.id;
    return network;
  }

  clearActiveNetwork(): void {
    this.activeNetworkId = null;
  }
}

export const defaultNetworkRegistry = new NetworkRegistry(supportedNetworks);