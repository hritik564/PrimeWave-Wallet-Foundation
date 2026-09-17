import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
    defaultNetworkRegistry.listEnabledNetworks().map((network) => network.id),
    [
      'primewave',
      'ethereum',
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
    'PRIMARY_NETWORK_INVALID',
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