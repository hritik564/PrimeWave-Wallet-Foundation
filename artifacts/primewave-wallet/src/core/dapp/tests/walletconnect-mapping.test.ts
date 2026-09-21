import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultNetworkRegistry } from '@/src/core/networks';
import { DAppError } from '..';
import {
  buildApprovedNamespaces,
  mapWalletConnectProposal,
  readWalletConnectAccounts,
} from '../providers/walletconnect/mapping';
import type { ProposalTypes, SessionTypes } from '@walletconnect/types';

const metadata = {
  name: 'Example DApp',
  description: 'Untrusted public metadata.',
  url: 'https://example.test/app',
  icons: ['https://example.test/icon.png'],
};

function makeProposal(
  overrides: Partial<ProposalTypes.Struct> = {},
): ProposalTypes.Struct {
  return {
    id: 42,
    expiryTimestamp: 2_000_000_000,
    relays: [{ protocol: 'irn' }],
    proposer: { publicKey: 'public-key', metadata },
    requiredNamespaces: {
      eip155: {
        chains: ['eip155:1', 'eip155:137'],
        methods: ['eth_chainId', 'personal_sign'],
        events: ['accountsChanged', 'chainChanged'],
      },
    },
    optionalNamespaces: {},
    pairingTopic: 'pairing-topic',
    ...overrides,
  };
}

test('maps only registered configured EVM chains and treats metadata as untrusted', () => {
  const mapped = mapWalletConnectProposal(
    makeProposal(),
    defaultNetworkRegistry,
    1_000_000,
  );

  assert.deepEqual(mapped.proposal.requestedNetworkIds, [
    'ethereum',
    'polygon',
  ]);
  assert.deepEqual(mapped.proposal.requestedChainIds, [1n, 137n]);
  assert.deepEqual(mapped.proposal.requestedCapabilities, [
    'account-access',
    'network-access',
    'message-signing',
  ]);
  assert.equal(mapped.proposal.identity.origin, 'https://example.test');
  assert.equal(mapped.requestedEvents.length, 2);
});

test('rejects PrimeWave placeholder and unsupported namespaces before approval', () => {
  assert.throws(
    () =>
      mapWalletConnectProposal(
        makeProposal({
          requiredNamespaces: {
            eip155: {
              chains: ['eip155:1', 'eip155:999999'],
              methods: [],
              events: [],
            },
          },
        }),
        defaultNetworkRegistry,
        1_000_000,
      ),
    (error: unknown) =>
      error instanceof DAppError &&
      error.code === 'PROVIDER_UNSUPPORTED_CHAIN',
  );
  assert.throws(
    () =>
      mapWalletConnectProposal(
        makeProposal({
          requiredNamespaces: {
            cosmos: { chains: ['cosmos:1'], methods: [], events: [] },
          },
        }),
        defaultNetworkRegistry,
        1_000_000,
      ),
    (error: unknown) =>
      error instanceof DAppError &&
      error.code === 'PROVIDER_UNSUPPORTED_NAMESPACE',
  );
});

test('approves public account and network namespaces without signing methods', () => {
  const mapped = mapWalletConnectProposal(
    makeProposal(),
    defaultNetworkRegistry,
    1_000_000,
  );
  const namespaces = buildApprovedNamespaces(
    mapped,
    {
      decision: 'approved',
      accountId: 'account-1',
      walletAddress: '0x52908400098527886e0f7030069857d2e4169ee7',
      networkId: 'ethereum',
      chainId: 1n,
      approvedNetworkIds: ['ethereum', 'polygon'],
      approvedChainIds: [1n, 137n],
      approvedCapabilities: ['account-access', 'network-access'],
    },
    defaultNetworkRegistry,
  );

  assert.deepEqual(namespaces, {
    eip155: {
      accounts: [
        'eip155:1:0x52908400098527886E0F7030069857D2E4169EE7',
        'eip155:137:0x52908400098527886E0F7030069857D2E4169EE7',
      ],
      methods: [],
      events: ['accountsChanged', 'chainChanged'],
    },
  });
});

test('reads only configured EVM accounts from a provider session', () => {
  const session = {
    namespaces: {
      eip155: {
        accounts: [
          'eip155:1:0x52908400098527886e0f7030069857d2e4169ee7',
        ],
        methods: [],
        events: [],
      },
    },
  } as unknown as SessionTypes.Struct;

  assert.deepEqual(
    readWalletConnectAccounts(session, defaultNetworkRegistry),
    [
      {
        networkId: 'ethereum',
        chainId: 1n,
        address: '0x52908400098527886E0F7030069857D2E4169EE7',
      },
    ],
  );
});