import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel } from '@/src/core/portfolio';
import {
  createSwapQuoteRequest,
  formatMaxSwapAmount,
  getSellAssets,
  getSwapAssets,
  parseSlippageBps,
  selectDefaultBuyAsset,
  selectDefaultSellAsset,
  swapAssetKey,
  validateSwapAmount,
  validateSwapForm,
} from '../WalletSwapScreen.logic';

const network: EvmNetwork = {
  id: 'swap-testnet',
  displayName: 'Swap Testnet',
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

const token = asset({
  identity: { assetType: 'fungible_token', networkId: network.id, assetId: '0x0000000000000000000000000000000000000002' },
  assetType: 'fungible_token',
  contractAddress: '0x0000000000000000000000000000000000000002',
  symbol: 'WAVE',
  name: 'Wave Token',
  decimals: 6,
  rawBalance: 1200001n,
  formattedBalance: '1.2',
});

test('swap asset selectors remain scoped to the selected network and supported types', () => {
  const otherNetwork = asset({
    networkId: 'other-network',
    identity: { assetType: 'native', networkId: 'other-network', assetId: 'native' },
  });
  const nft = asset({
    assetType: 'nft',
    identity: { assetType: 'nft', networkId: network.id, assetId: 'collection' },
  });
  assert.deepEqual(getSwapAssets([otherNetwork, nft, token, asset()], network), [token, asset()]);
  assert.deepEqual(getSellAssets([token, asset({ rawBalance: null }), asset()], network), [token, asset()]);
  assert.equal(selectDefaultSellAsset([token, asset()], network)?.assetType, 'native');
  assert.equal(selectDefaultBuyAsset([asset(), token], network, asset())?.symbol, 'WAVE');
  assert.equal(swapAssetKey(token.identity), `${network.id}:fungible_token:${token.contractAddress}`);
});

test('swap amount validation and MAX preserve exact decimal values', () => {
  assert.equal(formatMaxSwapAmount(asset()), '1.25');
  assert.equal(validateSwapAmount('1.2', token).rawAmount, 1200000n);
  assert.equal(validateSwapAmount('1.200001', token).state, 'valid');
  assert.equal(validateSwapAmount('1.2000001', token).message, 'Use no more than 6 decimal places.');
  assert.equal(validateSwapAmount('1.21', token).message, 'Amount exceeds the available balance.');
  assert.equal(validateSwapAmount('0', token).message, 'Amount must be greater than zero.');
});

test('slippage accepts bounded basis-point percentages and warns through validation', () => {
  assert.deepEqual(parseSlippageBps('0.50'), { state: 'valid', bps: 50, message: null });
  assert.deepEqual(parseSlippageBps('50.00'), { state: 'valid', bps: 5000, message: null });
  assert.equal(parseSlippageBps('50.01').state, 'invalid');
  assert.equal(parseSlippageBps('1.005').state, 'invalid');
  const form = validateSwapForm({
    accountId: 'account-1',
    senderAddress: '0x0000000000000000000000000000000000000001',
    network,
    sellAsset: asset(),
    buyAsset: token,
    amount: '0.5',
    slippage: '1.00',
  });
  assert.equal(form.canQuote, true);
  assert.equal(form.slippage.bps, 100);
});

test('quote request is public, network-bound, and exact', () => {
  const request = createSwapQuoteRequest({
    accountId: 'account-1',
    senderAddress: '0x0000000000000000000000000000000000000001',
    network,
    sellAsset: asset(),
    buyAsset: token,
    amount: 500000000000000000n,
    slippageBps: 50,
  });
  assert.equal(request.chainId, 777n);
  assert.equal(request.sellAmount, 500000000000000000n);
  assert.equal(request.slippageBps, 50);
  assert.equal('privateKey' in request, false);
  assert.equal('mnemonic' in request, false);
  assert.equal('sign' in request, false);
});

test('quote gating rejects same assets, unavailable context, and network changes', () => {
  const base = {
    accountId: 'account-1',
    senderAddress: '0x0000000000000000000000000000000000000001',
    network,
    amount: '0.5',
    slippage: '0.50',
  };
  assert.equal(validateSwapForm({ ...base, sellAsset: asset(), buyAsset: asset() }).canQuote, false);
  assert.equal(validateSwapForm({ ...base, sellAsset: asset(), buyAsset: token, network: { ...network, id: 'other-network' } }).canQuote, false);
  assert.equal(validateSwapForm({ ...base, sellAsset: asset(), buyAsset: token, network: { ...network, configurationStatus: 'placeholder' } }).canQuote, false);
  assert.equal(validateSwapForm({ ...base, sellAsset: asset(), buyAsset: token, amount: '2' }).canQuote, false);
});