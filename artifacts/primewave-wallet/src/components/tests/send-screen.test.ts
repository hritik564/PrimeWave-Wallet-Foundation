import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel } from '@/src/core/portfolio';
import {
  assetIdentityKey,
  createPublicSendDraft,
  formatMaxAmount,
  getSendableAssets,
  selectDefaultSendAsset,
  validateAmount,
  validateRecipient,
  validateSendForm,
} from '../WalletSendScreen.logic';

const network: EvmNetwork = {
  id: 'primewave-testnet',
  displayName: 'PrimeWave Testnet',
  chainId: 777,
  nativeCurrency: { name: 'Prime', symbol: 'PRM', decimals: 18 },
  rpc: { endpoints: [] },
  explorer: { name: 'Explorer', baseUrl: null, addressUrlTemplate: null, transactionUrlTemplate: null },
  environment: 'testnet',
  isPrimary: true,
  enabled: true,
  configurationStatus: 'configured',
};

function asset(overrides: Partial<PortfolioAssetViewModel> = {}): PortfolioAssetViewModel {
  return {
    identity: { assetType: 'native', networkId: network.id, assetId: 'native' },
    assetType: 'native',
    networkId: network.id,
    contractAddress: null,
    symbol: 'PRM',
    name: 'Prime',
    decimals: 18,
    rawBalance: 1250000000000000000n,
    formattedBalance: '1.25',
    visibility: 'visible',
    verificationStatus: 'unknown',
    metadataStatus: 'complete',
    provenance: [],
    icon: {
      source: 'none',
      status: 'unavailable',
      reference: null,
      dimensions: null,
      provenance: 'none',
      fallback: { type: 'native_currency', initials: 'PRM', deterministicId: '0x1234' },
    },
    balanceState: 'positive',
    availabilityState: 'available',
    ...overrides,
  };
}

const validRecipient = '0x0000000000000000000000000000000000000001';

test('Send screen logic starts with network-scoped native asset', () => {
  const native = asset();
  const token = asset({
    identity: { assetType: 'fungible_token', networkId: network.id, assetId: '0xtoken' },
    assetType: 'fungible_token',
    contractAddress: '0x0000000000000000000000000000000000000002',
    symbol: 'WAVE',
    name: 'Wave Token',
    decimals: 6,
    rawBalance: 1200000n,
    formattedBalance: '1.2',
  });
  assert.equal(selectDefaultSendAsset([token, native], network), native);
  assert.deepEqual(getSendableAssets([native, token], network), [native, token]);
  assert.equal(assetIdentityKey(token.identity), `${network.id}:fungible_token:0xtoken`);
});

test('recipient validation distinguishes empty, typing, invalid, valid, and normalized', () => {
  assert.equal(validateRecipient('').state, 'empty');
  assert.equal(validateRecipient('0x12').state, 'typing');
  assert.equal(validateRecipient('0x000000000000000000000000000000000000000z').state, 'invalid');
  assert.equal(validateRecipient(validRecipient).state, 'valid');
  const mixed = validateRecipient('0x52908400098527886e0f7030069857d2e4169ee7');
  assert.equal(mixed.state, 'normalized');
  assert.equal(mixed.normalized, '0x52908400098527886E0F7030069857D2E4169EE7');
});

test('amount validation uses exact decimals, rejects zero, and enforces balance', () => {
  const selected = asset();
  assert.equal(validateAmount('', selected.decimals, selected.rawBalance).state, 'empty');
  assert.equal(validateAmount('1.25', selected.decimals, selected.rawBalance).rawAmount, 1250000000000000000n);
  assert.equal(validateAmount('1.251', 2, 200n).message, 'Use no more than 2 decimal places.');
  assert.equal(validateAmount('0', selected.decimals, selected.rawBalance).message, 'Amount must be greater than zero.');
  assert.equal(validateAmount('1.26', 2, 125n).message, 'Amount exceeds the available balance.');
});

test('MAX preserves the exact available balance', () => {
  assert.equal(formatMaxAmount(asset()), '1.25');
  assert.equal(formatMaxAmount(asset({ rawBalance: null, formattedBalance: null })), '');
});

test('review is gated by network, asset, recipient, and amount', () => {
  const selected = asset();
  assert.equal(validateSendForm({ network, asset: selected, recipient: validRecipient, amount: '1' }).canReview, true);
  assert.equal(validateSendForm({ network, asset: selected, recipient: '', amount: '1' }).canReview, false);
  assert.equal(validateSendForm({ network, asset: selected, recipient: validRecipient, amount: '2' }).canReview, false);
  assert.equal(validateSendForm({ network: { ...network, configurationStatus: 'placeholder' }, asset: selected, recipient: validRecipient, amount: '1' }).canReview, false);
  assert.equal(validateSendForm({ network, asset: asset({ networkId: 'other-network' }), recipient: validRecipient, amount: '1' }).canReview, false);
});

test('public review draft contains only non-secret data', () => {
  const draft = createPublicSendDraft({
    accountId: 'account-1',
    senderPublicAddress: '0x0000000000000000000000000000000000000003',
    network,
    asset: asset(),
    recipient: validRecipient,
    amount: '1.25',
  });
  assert.deepEqual(Object.keys(draft).sort(), [
    'accountId',
    'amount',
    'networkId',
    'recipient',
    'selectedAssetIdentity',
    'senderPublicAddress',
  ]);
  assert.equal('privateKey' in draft, false);
  assert.equal('mnemonic' in draft, false);
  assert.equal('pin' in draft, false);
});

test('QR scanning remains deferred and no scan API is represented by send logic', () => {
  assert.equal('scan' in validateSendForm, false);
});