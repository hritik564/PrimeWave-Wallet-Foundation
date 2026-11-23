import { NetworkRegistry, supportedNetworks } from "@/src/core/networks";
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvmNetwork } from '@/src/core/networks';
import {
  createReceiveQrPayload,
  receivingNetworks, receivingAddress, receivingExplorer,
  receiveNetworkStatus,
} from '../receive.logic';

function network(overrides: Partial<EvmNetwork> = {}): EvmNetwork {
  return {
    id: 'receive-testnet',
    displayName: 'Receive Testnet',
    chainId: 777,
    nativeCurrency: { name: 'Prime', symbol: 'PRM', decimals: 18 },
    rpc: { endpoints: [] },
    explorer: {
      name: 'Explorer',
      baseUrl: null,
      addressUrlTemplate: null,
      transactionUrlTemplate: null,
    },
    environment: 'testnet',
    isPrimary: true,
    enabled: true,
    configurationStatus: 'configured',
    ...overrides,
  };
}

test('Receive QR payload contains only the trimmed public address', () => {
  const address = '  0x0000000000000000000000000000000000000001  ';
  assert.equal(createReceiveQrPayload(address), address.trim());
  assert.equal(createReceiveQrPayload('   '), null);
});

test('Receive network status keeps configured, unconfigured, and disabled states distinct', () => {
  assert.deepEqual(receiveNetworkStatus(network()), {
    label: 'Configured',
    configured: true,
  });
  assert.deepEqual(
    receiveNetworkStatus(network({ configurationStatus: 'placeholder', chainId: null })),
    { label: 'Not configured', configured: false },
  );
  assert.deepEqual(receiveNetworkStatus(network({ enabled: false })), {
    label: 'Disabled',
    configured: false,
  });
});
test('Receive uses the same exact public address independently of the active network', () => {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork('ethereum');
  const list = receivingNetworks(registry.listNetworks());
  const first = '0x0000000000000000000000000000000000000001';
  const second = '0x0000000000000000000000000000000000000002';
  for (const id of ['ethereum', 'bnb-smart-chain']) {
    const entry = list.find(item => item.id === id)!;
    assert.equal(receivingAddress(entry, first), first);
    assert.equal(createReceiveQrPayload(receivingAddress(entry, second)!), second);
    assert.equal(receivingExplorer(entry, second), entry.explorer.addressUrlTemplate?.replace('{address}', second));
    assert.equal(receivingExplorer(entry, 'invalid/path'), null);
  }
  const planned = list.find(item => item.id === 'primewave')!;
  assert.equal(receivingAddress(planned, first), null);
  assert.equal(receivingExplorer(planned, first), null);
  assert.equal(registry.getActiveNetwork()?.id, 'ethereum');
});
