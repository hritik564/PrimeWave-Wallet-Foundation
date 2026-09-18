import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityReadModelItem } from '@/src/core/activity';
import { createAssetIcon } from '@/src/core/portfolio';
import type {
  ConfirmationResult,
  TransactionLookupResult,
} from '@/src/core/transactions/broadcast';
import {
  canPersistConfirmation,
  createLookupContext,
  createTransactionDetailSelection,
  detailStatusCopy,
  detailSummaryLabel,
  formatExactQuantity,
  reconciliationOutcome,
  shortDetailValue,
  transactionTypeLabel,
} from '../TransactionDetailScreen.logic';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}` as `0x${string}`;
const identity = {
  assetType: 'native' as const,
  networkId: 'ethereum',
  assetId: 'native',
};

function item(
  overrides: Partial<ActivityReadModelItem> = {},
): ActivityReadModelItem {
  return {
    kind: 'activity-item',
    identity: 'local:activity-1',
    localTransactionId: 'activity-1',
    transactionHash: hash,
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
    senderAddress: sender,
    transactionType: 'native-transfer',
    direction: 'outgoing',
    assetIdentity: identity,
    recipient,
    amountRaw: 1234567890123456789n,
    amountDecimals: 18,
    amountDisplay: '1.234567890123456789',
    nativeValue: 1234567890123456789n,
    tokenContractAddress: null,
    nonce: 7n,
    gasLimit: 21000n,
    feeModel: 'eip1559',
    feeAmount: 42000000000000n,
    createdAt: 1_700_000_000_000,
    blockTimestamp: null,
    broadcastAt: 1_700_000_000_000,
    confirmedAt: null,
    status: 'unknown',
    confirmation: null,
    explorerUrl: null,
    provenance: 'broadcast_engine',
    observedAt: 1_700_000_000_000,
    presentation: {
      kind: 'activity-presentation',
      activityId: 'activity-1',
      transactionHash: hash,
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
        displayAddress: '0x2222…2222',
        directionLabel: 'To',
      },
      primaryAmount: {
        raw: 1234567890123456789n,
        decimals: 18,
        symbol: 'ETH',
        display: '1.234567890123456789',
        signedDisplay: '-1.234567890123456789 ETH',
        sign: 'negative',
      },
      secondaryAmount: null,
      fiatValue: null,
      status: 'unknown',
      timestamp: {
        timestamp: 1_700_000_000_000,
        source: 'observation',
        isBlockchainDerived: false,
      },
      provenance: 'broadcast_engine',
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
    },
    ...overrides,
  };
}

function lookup(
  state: TransactionLookupResult['state'],
): TransactionLookupResult {
  return {
    kind: 'transaction-lookup',
    state,
    transactionHash: hash,
    networkId: 'ethereum',
    chainId: 1n,
    blockHash: state === 'mined' ? hash : null,
    blockNumber: state === 'mined' ? 100n : null,
  };
}

function confirmation(
  state: ConfirmationResult['state'],
): ConfirmationResult {
  return {
    kind: 'confirmation-result',
    state,
    transactionHash: hash,
    networkId: 'ethereum',
    chainId: 1n,
    receipt: state === 'unknown'
      ? null
      : {
          transactionHash: hash,
          blockHash: hash,
          blockNumber: 100n,
          status: state === 'confirmed' ? 'success' : 'reverted',
          gasUsed: 21000n,
          effectiveGasPrice: 2_000_000_000n,
        },
    polls: 1,
    checkedAtMs: 1_700_000_000_000,
  };
}

test('activity rows navigate with only public identity and scope', () => {
  const selection = createTransactionDetailSelection(item());
  assert.deepEqual(selection, {
    activityId: 'local:activity-1',
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
  });
  assert.equal('privateKey' in selection, false);
  assert.equal('mnemonic' in selection, false);
  assert.equal('pin' in selection, false);
});

test('keeps all transaction statuses honest and distinct', () => {
  const expected: Record<string, string> = {
    draft: 'Draft',
    signed: 'Signed locally — not broadcast',
    broadcasting: 'Broadcasting',
    broadcasted: 'Broadcasted — awaiting confirmation',
    confirming: 'Confirming',
    confirmed: 'Confirmed',
    reverted: 'Reverted',
    failed: 'Broadcast failed',
    unknown: 'Status unknown',
  };
  for (const [status, label] of Object.entries(expected)) {
    assert.equal(detailStatusCopy(status as ActivityReadModelItem['status']).label, label);
  }
  assert.notEqual(detailStatusCopy('unknown').label, 'Failed');
  assert.notEqual(detailStatusCopy('broadcasted').label, 'Confirmed');
});

test('preserves exact signed amounts and never uses a floating conversion', () => {
  assert.equal(
    formatExactQuantity(1234567890123456789n, 18),
    '1.234567890123456789',
  );
  assert.equal(shortDetailValue(sender), '0x11111111…11111111');
  assert.equal(detailSummaryLabel(item()), 'Sent');
});

test('creates a read-only lookup context bound to the activity network', () => {
  const context = createLookupContext(item());
  assert.deepEqual(context, {
    kind: 'broadcast-result',
    state: 'unknown',
    transactionHash: hash,
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: 'native-transfer',
    from: sender,
    submittedAtMs: 1_700_000_000_000,
  });
  assert.equal(transactionTypeLabel(item()), 'Native Transfer');
  assert.equal(canPersistConfirmation(item()), true);
});

test('maps bounded lookup and receipt results without assuming confirmation', () => {
  assert.equal(reconciliationOutcome(lookup('not-found'), null), 'not-found');
  assert.equal(reconciliationOutcome(lookup('pending'), null), 'pending');
  assert.equal(
    reconciliationOutcome(lookup('mined'), confirmation('confirmed')),
    'confirmed',
  );
  assert.equal(
    reconciliationOutcome(lookup('mined'), confirmation('reverted')),
    'reverted',
  );
  assert.equal(
    reconciliationOutcome(lookup('mined'), confirmation('unknown')),
    'unknown',
  );
});

test('does not infer swaps or persist terminal confirmations through a local update', () => {
  const contract = item({
    identity: 'hash:ethereum:1:0xcontract',
    localTransactionId: null,
    transactionType: 'contract-interaction',
    direction: 'unknown',
    provenance: 'blockchain_read',
    presentation: {
      ...item().presentation,
      action: 'contract_interaction',
      transactionType: 'contract-interaction',
      primaryAsset: null,
      primaryAmount: {
        ...item().presentation.primaryAmount,
        raw: null,
        display: null,
        signedDisplay: null,
        sign: 'unknown',
      },
      counterparty: {
        type: 'contract',
        address: recipient,
        displayAddress: '0x2222…2222',
        directionLabel: 'Contract',
      },
    },
  });
  assert.equal(detailSummaryLabel(contract), 'Contract Interaction');
  assert.equal(transactionTypeLabel(contract), 'Contract Interaction');
  assert.equal(canPersistConfirmation(contract), false);
});