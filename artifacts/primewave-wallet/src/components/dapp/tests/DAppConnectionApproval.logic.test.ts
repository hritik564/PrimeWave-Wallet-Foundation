import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultNetworkRegistry } from '@/src/core/networks';
import { DAppError } from '@/src/core/dapp';
import type { DAppSessionProposal } from '@/src/core/dapp';
import {
  assertDAppApprovalCheckpoint,
  dappCapabilityLabel,
  toDAppApprovalViewModel,
} from '@/src/core/dapp';
import {
  createDAppApprovalSnapshot,
  dappIdentityChanged,
  validateDAppApproval,
} from '../DAppConnectionApproval.logic';
import type { Wallet } from '@/src/core/wallet/models';

const wallet: Wallet = {
  walletId: 'wallet-1',
  createdAt: '2026-09-21T00:00:00.000Z',
  accountCount: 1,
  accounts: [
    {
      accountId: 'account-1',
      index: 0,
      address: '0x52908400098527886e0f7030069857d2e4169ee7',
      derivationPath: "m/44'/60'/0'/0/0",
    },
  ],
};

const identity = {
  dappId: 'walletconnect:42',
  name: 'Example DApp',
  description: 'Untrusted public metadata.',
  url: 'https://example.test/app',
  iconUrl: null,
  origin: 'https://example.test',
  providerSessionId: 'pairing-topic',
  metadataVersion: 'walletconnect-v2',
};

function proposal(
  overrides: Partial<DAppSessionProposal> = {},
): DAppSessionProposal {
  return {
    proposalId: '42',
    providerId: 'walletconnect',
    identity,
    requestedNetworkIds: ['ethereum', 'polygon'],
    requestedChainIds: [1n, 137n],
    requestedCapabilities: [
      'account-access',
      'network-access',
      'message-signing',
    ],
    expiresAt: 2_000_000_000_000,
    ...overrides,
  };
}

const ethereumContext = {
  accountId: 'account-1',
  walletAddress: wallet.accounts[0].address,
  networkId: 'ethereum',
  chainId: 1n,
};

test('builds a public approval model with configured networks and unsupported capabilities', () => {
  const model = toDAppApprovalViewModel(
    proposal(),
    wallet,
    defaultNetworkRegistry,
  );
  assert.equal(model.identity.name, 'Example DApp');
  assert.equal(model.identity.iconUrl, null);
  assert.equal(model.accountAddress, '0x52908400098527886E0F7030069857D2E4169EE7');
  assert.deepEqual(
    model.requestedNetworks.map((network) => [network.displayName, network.chainId]),
    [
      ['Ethereum', 1n],
      ['Polygon', 137n],
    ],
  );
  assert.deepEqual(model.unsupportedCapabilities, ['message-signing']);
  assert.match(dappCapabilityLabel('transaction-signing'), /not available/);
});

test('rejects unsupported or unavailable networks instead of silently filtering them', () => {
  assert.throws(
    () =>
      toDAppApprovalViewModel(
        proposal({
          requestedNetworkIds: ['primewave'],
          requestedChainIds: [999999n],
        }),
        wallet,
        defaultNetworkRegistry,
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'PROVIDER_UNSUPPORTED_CHAIN',
  );
});

test('requires an unchanged account and active network at the approval checkpoint', () => {
  const snapshot = createDAppApprovalSnapshot(
    proposal(),
    wallet,
    defaultNetworkRegistry,
    ethereumContext,
  );
  assert.doesNotThrow(() =>
    validateDAppApproval(snapshot, ethereumContext, 1_000_000),
  );
  assert.throws(
    () =>
      validateDAppApproval(snapshot, {
        ...ethereumContext,
        networkId: 'polygon',
        chainId: 137n,
      }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'NETWORK_MISMATCH',
  );
  assert.throws(
    () =>
      validateDAppApproval(snapshot, {
        ...ethereumContext,
        accountId: 'account-2',
      }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'ACCOUNT_MISMATCH',
  );
});

test('expired proposals cannot be approved', () => {
  assert.throws(
    () =>
      assertDAppApprovalCheckpoint(
        proposal({ expiresAt: 1_000 }),
        ethereumContext,
        ethereumContext,
        1_001,
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'PROVIDER_SESSION_EXPIRED',
  );
});

test('identity changes invalidate the approval context', () => {
  assert.equal(dappIdentityChanged(identity, identity), false);
  assert.equal(
    dappIdentityChanged(identity, { ...identity, url: 'https://other.test' }),
    true,
  );
});