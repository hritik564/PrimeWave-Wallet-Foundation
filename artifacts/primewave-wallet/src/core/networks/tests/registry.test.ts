import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSepoliaNetwork,
  NetworkRegistry,
  NetworkRegistryError,
  defaultNetworkRegistry,
  supportedNetworks,
} from '../registry';
import type { EvmNetwork } from '../types';

const configuredEthereum = supportedNetworks.find(
  (network) => network.id === 'ethereum',
) as EvmNetwork;

function expectRegistryError(
  callback: () => unknown,
  code: NetworkRegistryError['code'],
): void {
  assert.throws(callback, (error: unknown) => {
    return error instanceof NetworkRegistryError && error.code === code;
  });
}

test('defines the requested enabled networks and one primary placeholder', () => {
  assert.deepEqual(
    defaultNetworkRegistry.listNetworks().map((network) => network.id),
    [
      'primewave',
      'ethereum',
      'ethereum-sepolia',
      'bnb-smart-chain',
      'polygon',
      'arbitrum',
      'base',
      'optimism',
    ],
  );
  assert.deepEqual(
    defaultNetworkRegistry.listEnabledNetworks().map((network) => network.id),
    [
      'primewave',
      'ethereum',
      'ethereum-sepolia',
      'bnb-smart-chain',
      'polygon',
      'arbitrum',
      'base',
      'optimism',
    ],
  );
  assert.equal(defaultNetworkRegistry.getPrimaryNetwork().id, 'primewave');
  assert.equal(defaultNetworkRegistry.getPrimaryNetwork().chainId, null);
  assert.equal(
    defaultNetworkRegistry.getPrimaryNetwork().configurationStatus,
    'placeholder',
  );
  assert.equal(defaultNetworkRegistry.getActiveNetwork(), null);
});

test('supports lookup by stable ID and numeric chain ID', () => {
  assert.equal(defaultNetworkRegistry.getById('base')?.chainId, 8453);
  assert.equal(defaultNetworkRegistry.getByChainId(42161)?.id, 'arbitrum');
  assert.equal(defaultNetworkRegistry.getById('ethereum-sepolia')?.chainId, 11155111);
  assert.equal(defaultNetworkRegistry.getByChainId(11155111)?.id, 'ethereum-sepolia');
  assert.equal(defaultNetworkRegistry.getByChainId(999999), undefined);
});

test('requires explicit selection and rejects unconfigured primary activation', () => {
  expectRegistryError(
    () => defaultNetworkRegistry.selectActiveNetwork('primewave'),
    'NETWORK_NOT_CONFIGURED',
  );
  const selected = defaultNetworkRegistry.selectActiveNetwork('ethereum');
  assert.equal(selected.id, 'ethereum');
  assert.equal(defaultNetworkRegistry.getActiveNetwork()?.id, 'ethereum');

  defaultNetworkRegistry.clearActiveNetwork();
  assert.equal(defaultNetworkRegistry.getActiveNetwork(), null);

  const selectedSepolia = defaultNetworkRegistry.selectActiveNetwork('ethereum-sepolia');
  assert.equal(selectedSepolia.displayName, 'Ethereum Sepolia');
  assert.equal(selectedSepolia.environment, 'testnet');
  defaultNetworkRegistry.clearActiveNetwork();
});

test('registers Sepolia with isolated testnet metadata and explorer URLs', () => {
  const sepolia = defaultNetworkRegistry.getById('ethereum-sepolia') as EvmNetwork;
  assert.equal(sepolia.chainId, 11155111);
  assert.equal(sepolia.environment, 'testnet');
  assert.equal(sepolia.nativeCurrency.symbol, 'ETH');
  assert.equal(sepolia.nativeCurrency.decimals, 18);
  assert.equal(sepolia.isPrimary, false);
  assert.equal(sepolia.configurationStatus, 'configured');
  assert.equal(sepolia.explorer.baseUrl, 'https://sepolia.etherscan.io');
  assert.equal(
    sepolia.explorer.addressUrlTemplate,
    'https://sepolia.etherscan.io/address/{address}',
  );
  assert.equal(
    sepolia.explorer.transactionUrlTemplate,
    'https://sepolia.etherscan.io/tx/{txHash}',
  );
  assert.equal(sepolia.rpc.endpoints.length, 1);
  assert.equal(defaultNetworkRegistry.getById('ethereum')?.chainId, 1);
});

test('fails closed when Sepolia RPC configuration is missing or invalid', () => {
  const unavailable = createSepoliaNetwork('');
  assert.equal(unavailable.enabled, false);
  assert.equal(unavailable.configurationStatus, 'unavailable');
  assert.deepEqual(unavailable.rpc.endpoints, []);
  const registry = new NetworkRegistry([
    defaultNetworkRegistry.getPrimaryNetwork(),
    unavailable,
  ]);
  expectRegistryError(
    () => registry.selectActiveNetwork('ethereum-sepolia'),
    'NETWORK_DISABLED',
  );

  expectRegistryError(
    () => new NetworkRegistry([
      defaultNetworkRegistry.getPrimaryNetwork(),
      createSepoliaNetwork('http://rpc.example.com'),
    ]),
    'INVALID_NETWORK',
  );
});

test('rejects duplicate IDs, duplicate chain IDs, and invalid primary rules', () => {
  assert.throws(
    () => new NetworkRegistry([configuredEthereum, configuredEthereum]),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'DUPLICATE_NETWORK_ID',
  );

  const duplicateChainId = {
    ...configuredEthereum,
    id: 'ethereum-copy',
  };
  assert.throws(
    () => new NetworkRegistry([configuredEthereum, duplicateChainId]),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'DUPLICATE_CHAIN_ID',
  );

  assert.throws(
    () => new NetworkRegistry([configuredEthereum]),
    (error: unknown) =>
      error instanceof NetworkRegistryError &&
      error.code === 'PRIMARY_NETWORK_INVALID',
  );
});

test('validates chain, URL, currency, and environment combinations', () => {
  const invalidChainId = {
    ...configuredEthereum,
    chainId: 1.5,
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, invalidChainId]),
    'INVALID_NETWORK',
  );

  const invalidRpc = {
    ...configuredEthereum,
    id: 'invalid-rpc',
    chainId: 999,
    rpc: {
      endpoints: [
        {
          id: 'public',
          url: 'http://rpc.example.com',
          priority: 0,
        },
      ],
    },
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, invalidRpc]),
    'INVALID_NETWORK',
  );

  const credentialedRpc = {
    ...configuredEthereum,
    id: 'credentialed-rpc',
    chainId: 998,
    rpc: {
      endpoints: [
        {
          id: 'public',
          url: 'https://rpc.example.com?apiKey=secret',
          priority: 0,
        },
      ],
    },
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, credentialedRpc]),
    'INVALID_NETWORK',
  );

  const invalidCurrency = {
    ...configuredEthereum,
    id: 'invalid-currency',
    chainId: 997,
    nativeCurrency: {
      ...configuredEthereum.nativeCurrency,
      symbol: 'eth',
    },
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, invalidCurrency]),
    'INVALID_NETWORK',
  );

  const invalidEnvironment = {
    ...configuredEthereum,
    id: 'invalid-environment',
    chainId: 996,
    environment: 'production' as never,
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, invalidEnvironment]),
    'INVALID_NETWORK',
  );

  const mainnetPlaceholder = {
    ...configuredEthereum,
    id: 'mainnet-placeholder',
    chainId: null,
    configurationStatus: 'placeholder' as const,
    isPrimary: true,
    configurationNote: 'Not configured.',
    rpc: { endpoints: [] },
    explorer: {
      name: 'Placeholder Explorer',
      baseUrl: null,
      addressUrlTemplate: null,
      transactionUrlTemplate: null,
    },
  };
  expectRegistryError(
    () => new NetworkRegistry([configuredEthereum, mainnetPlaceholder]),
    'INVALID_NETWORK',
  );
});

test('allows future custom development networks without enabling automatic switching', () => {
  const customDevelopmentNetwork: EvmNetwork = {
    id: 'local-anvil',
    displayName: 'Local Anvil',
    chainId: 31337,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpc: {
      endpoints: [
        {
          id: 'local',
          url: 'http://127.0.0.1:8545',
          priority: 0,
        },
      ],
    },
    explorer: {
      name: 'Local Explorer',
      baseUrl: 'https://explorer.example.com',
      addressUrlTemplate: 'https://explorer.example.com/address/{address}',
      transactionUrlTemplate: 'https://explorer.example.com/tx/{txHash}',
    },
    environment: 'development',
    isPrimary: false,
    enabled: true,
    configurationStatus: 'configured',
  };
  const registry = new NetworkRegistry([
    defaultNetworkRegistry.getPrimaryNetwork(),
    customDevelopmentNetwork,
  ]);

  assert.equal(registry.getActiveNetwork(), null);
  assert.equal(registry.selectActiveNetwork('local-anvil').chainId, 31337);
});