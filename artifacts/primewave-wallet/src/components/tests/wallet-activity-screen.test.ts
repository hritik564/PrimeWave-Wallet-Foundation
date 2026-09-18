import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ActivityReadModelItem,
  ActivityPresentationModel,
} from '@/src/core/activity';
import { createAssetIcon } from '@/src/core/portfolio';
import {
  activityActionLabel,
  activityContextLabel,
  activityFilterOptions,
  activityStatusLabel,
  activityDateLabel,
  filterActivityItems,
  groupActivityItems,
  networksForActivityFilter,
  readableActivityLabel,
  shortActivityAddress,
  statusTone,
} from '../WalletActivityScreen.logic';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';

function presentation(
  overrides: Partial<ActivityPresentationModel> = {},
): ActivityPresentationModel {
  const identity = {
    assetType: 'native' as const,
    networkId: 'ethereum',
    assetId: 'native',
  };
  return {
    kind: 'activity-presentation',
    activityId: 'activity-1',
    transactionHash: null,
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
    action: 'sent',
    transactionType: 'native-transfer',
    primaryAsset: {
      identity,
      assetType: 'native',
      networkId: 'ethereum',
      assetId: 'native',
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      icon: createAssetIcon(identity, 'Ether', 'ETH', 'native_currency'),
      metadataStatus: 'complete',
      verificationStatus: 'unknown',
    },
    secondaryAsset: null,
    direction: 'outgoing',
    counterparty: {
      type: 'to',
      address: recipient,
      displayAddress: '0x2222...2222',
      directionLabel: 'To',
    },
    primaryAmount: {
      raw: 1250000000000000000n,
      decimals: 18,
      symbol: 'ETH',
      display: '1.25',
      signedDisplay: '-1.25 ETH',
      sign: 'negative',
    },
    secondaryAmount: null,
    fiatValue: null,
    status: 'confirmed',
    timestamp: {
      timestamp: 1_700_000_000,
      source: 'blockchain',
      isBlockchainDerived: true,
    },
    provenance: 'blockchain_read',
    network: {
      networkId: 'ethereum',
      name: 'Ethereum',
      badgeId: 'network:ethereum',
      badgeFallbackInitials: 'ET',
      chainId: 1n,
      configured: true,
      available: true,
      configurationStatus: 'configured',
    },
    explorerAvailability: {
      available: false,
      url: null,
      explorerName: null,
    },
    ...overrides,
  };
}

function item(
  overrides: Partial<ActivityReadModelItem> = {},
  presentationOverrides: Partial<ActivityPresentationModel> = {},
): ActivityReadModelItem {
  return {
    kind: 'activity-item',
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
    localTransactionId: 'local-1',
    transactionHash: null,
    senderAddress: sender,
    transactionType: 'native-transfer',
    direction: 'outgoing',
    assetIdentity: {
      assetType: 'native',
      networkId: 'ethereum',
      assetId: 'native',
    },
    recipient,
    amountRaw: 1250000000000000000n,
    amountDecimals: 18,
    amountDisplay: '1.25',
    nativeValue: 1250000000000000000n,
    tokenContractAddress: null,
    nonce: null,
    gasLimit: null,
    feeModel: null,
    feeAmount: null,
    createdAt: 1_700_000_000_000,
    blockTimestamp: 1_700_000_000,
    broadcastAt: null,
    confirmedAt: 1_700_000_000_000,
    status: 'confirmed',
    confirmation: null,
    explorerUrl: null,
    provenance: 'blockchain_read',
    observedAt: 1_700_000_000_000,
    identity: 'local:local-1',
    presentation: presentation(presentationOverrides),
    ...overrides,
  };
}

test('formats activity addresses and labels without losing the full public address', () => {
  const activity = item();
  assert.equal(shortActivityAddress(recipient), '0x2222…2222');
  assert.equal(activityActionLabel(activity), 'Sent ETH');
  assert.equal(activityContextLabel(activity), 'To: 0x2222...2222');
  assert.match(readableActivityLabel(activity), new RegExp(recipient));
  assert.equal(activityStatusLabel('confirmed'), 'Confirmed');
});

test('uses neutral self-transfer and contract interaction labels', () => {
  const selfTransfer = item(
    {
      direction: 'self-transfer',
      transactionType: 'native-transfer',
    },
    {
      direction: 'self-transfer',
      counterparty: {
        type: 'unknown',
        address: null,
        displayAddress: null,
        directionLabel: null,
      },
    },
  );
  assert.equal(activityActionLabel(selfTransfer), 'Self transfer');
  assert.equal(activityContextLabel(selfTransfer), 'Between accounts in this wallet');

  const contract = item(
    {
      transactionType: 'contract-interaction',
      direction: 'unknown',
      assetIdentity: null,
      amountRaw: null,
      amountDecimals: null,
      amountDisplay: null,
    },
    {
      action: 'contract_interaction',
      transactionType: 'contract-interaction',
      direction: 'unknown',
      primaryAsset: null,
      counterparty: {
        type: 'contract',
        address: token,
        displayAddress: '0x3333...3333',
        directionLabel: 'Contract',
      },
    },
  );
  assert.equal(activityActionLabel(contract), 'Contract Interaction');
  assert.equal(activityContextLabel(contract), 'Contract: 0x3333...3333');
});

test('renders only explicit swap interpretation in the swap filter', () => {
  const swapAssetIdentity = {
    assetType: 'fungible_token' as const,
    networkId: 'ethereum',
    assetId: token,
  };
  const swap = item(
    {
      identity: 'local:swap',
      transactionType: 'contract-interaction',
    },
    {
      action: 'swapped',
      primaryAsset: null,
      secondaryAsset: {
        identity: swapAssetIdentity,
        assetType: 'fungible_token',
        networkId: 'ethereum',
        assetId: token,
        symbol: 'TST',
        name: 'Test Token',
        decimals: 6,
        icon: createAssetIcon(swapAssetIdentity, 'Test Token', 'TST'),
        metadataStatus: 'complete',
        verificationStatus: 'unverified',
      },
      secondaryAmount: {
        raw: 1065500n,
        decimals: 6,
        symbol: 'TST',
        display: '1.0655',
        signedDisplay: '+1.0655 TST',
        sign: 'positive',
      },
    },
  );
  const options = activityFilterOptions([item(), swap]);
  assert.deepEqual(
    options.map((option) => option.value),
    ['transactions', 'swaps', 'contract-interactions', 'all'],
  );
  assert.deepEqual(filterActivityItems([item(), swap], 'swaps'), [swap]);
  assert.equal(activityActionLabel(swap), 'Swapped');
});

test('does not expose unsupported approvals or swaps as active filters', () => {
  const options = activityFilterOptions([item()]);
  assert.equal(options.some((option) => option.value === 'swaps'), false);
  assert.equal(options.some((option) => option.value === 'approvals'), false);
  assert.deepEqual(
    filterActivityItems([item()], 'transactions').map((entry) => entry.identity),
    ['local:local-1'],
  );
});

test('keeps Activity network filtering separate from active network selection', () => {
  const networks = [
    { id: 'ethereum' },
    { id: 'base' },
  ] as const;
  assert.deepEqual(
    networksForActivityFilter(networks as never, 'all').map((network) => network.id),
    ['ethereum', 'base'],
  );
  assert.deepEqual(
    networksForActivityFilter(networks as never, 'base').map((network) => network.id),
    ['base'],
  );
});

test('groups blockchain seconds and observation milliseconds by readable date', () => {
  const now = 1_700_000_100_000;
  const today = item();
  const yesterday = item(
    { identity: 'local:yesterday', localTransactionId: 'yesterday' },
    {
      timestamp: {
        timestamp: now - 86_400_000,
        source: 'observation',
        isBlockchainDerived: false,
      },
    },
  );
  assert.equal(activityDateLabel(today, now), 'Today');
  assert.equal(activityDateLabel(yesterday, now), 'Yesterday');
  const groups = groupActivityItems([today, yesterday], now);
  assert.deepEqual(groups.map((group) => group.label), ['Today', 'Yesterday']);
  assert.deepEqual(groups.map((group) => group.items.length), [1, 1]);
});

test('keeps unknown status visually distinct from failed status', () => {
  assert.equal(statusTone('unknown'), 'muted');
  assert.equal(statusTone('failed'), 'danger');
  assert.equal(statusTone('confirmed'), 'success');
});