import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetDisplayName,
  assetDisplaySubtitle,
  assetStateLabel,
  filterPortfolioAssets,
  getHomeBalancePresentation,
  getPortfolioState,
  homeNavigationLabels,
  safePortfolioDiagnostic,
  safePortfolioMessage,
  shortPublicAddress,
} from '@/src/components/WalletHomeShell.logic';
import { PortfolioReadModelError } from '../index';
import type { PortfolioAssetViewModel } from '../read-model';

function asset(
  overrides: Partial<PortfolioAssetViewModel> = {},
): PortfolioAssetViewModel {
  return {
    identity: {
      assetType: 'native',
      networkId: 'primewave',
      assetId: 'native',
    },
    assetType: 'native',
    networkId: 'primewave',
    contractAddress: null,
    symbol: 'PWX',
    name: 'PrimeWave',
    decimals: 18,
    rawBalance: 1n,
    formattedBalance: '1',
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
      fallback: {
        type: 'native_currency',
        initials: 'PW',
        deterministicId: '0x1111111111111111111111111111111111111111111111111111111111111111',
      },
    },
    balanceState: 'positive',
    availabilityState: 'available',
    ...overrides,
  };
}

test('keeps the Home navigation contract explicit', () => {
  assert.deepEqual(homeNavigationLabels, [
    'Home',
    'Assets',
    'Swap',
    'Activity',
    'Settings',
  ]);
  assert.equal(shortPublicAddress('0x1Ef7EA6f787891789852f5E51896966b51589a62'), '0x1Ef7…9a62');
  assert.equal(shortPublicAddress('0x1234'), '0x1234');
  assert.equal(shortPublicAddress('   '), 'Unavailable');
});

test('derives honest portfolio and asset presentation states', () => {
  assert.equal(getPortfolioState(0), 'empty');
  assert.equal(getPortfolioState(1), 'available');
  assert.equal(assetStateLabel(asset()), 'AVAILABLE');
  assert.equal(assetStateLabel(asset({ balanceState: 'zero' })), 'ZERO BALANCE');
  assert.equal(
    assetStateLabel(asset({ availabilityState: 'unavailable', balanceState: 'unavailable' })),
    'UNAVAILABLE',
  );
  assert.equal(assetStateLabel(asset({ availabilityState: 'stale' })), 'STALE');
  assert.equal(assetStateLabel(asset({ availabilityState: 'invalid' })), 'INVALID');
  assert.equal(assetStateLabel(asset({ verificationStatus: 'verified' })), 'VERIFIED');
});

test('keeps Home balance presentation honest when fiat values are unavailable', () => {
  assert.deepEqual(getHomeBalancePresentation('empty', null), {
    value: '0',
    detail: 'Available balance',
    supporting: 'No assets on this network yet',
    available: true,
    zero: true,
  });
  assert.equal(getHomeBalancePresentation('loading', null).available, false);
  assert.equal(getHomeBalancePresentation('unavailable', null).detail, 'Balance unavailable');
});

test('does not collapse unavailable asset reads into an available zero balance', () => {
  const model = {
    assets: [asset({ availabilityState: 'unavailable', balanceState: 'unavailable' })],
  } as unknown as Parameters<typeof getHomeBalancePresentation>[1];
  const presentation = getHomeBalancePresentation('available', model);
  assert.equal(presentation.value, '—');
  assert.equal(presentation.zero, false);
  assert.equal(presentation.detail, 'Balance partially unavailable');
});

test('uses metadata fallbacks without inferring trust', () => {
  assert.equal(assetDisplayName(asset()), 'PrimeWave');
  assert.equal(assetDisplaySubtitle(asset()), 'PWX');
  assert.equal(
    assetDisplayName(asset({ name: null, symbol: null })),
    'Native asset',
  );
  assert.equal(
    assetDisplaySubtitle(asset({ name: null, symbol: null, assetType: 'fungible_token' })),
    'Fungible token',
  );
});

test('filters the read-model collection locally by visibility and public fields', () => {
  const token = asset({
    assetType: 'fungible_token',
    identity: {
      assetType: 'fungible_token',
      networkId: 'primewave',
      assetId: '0xAbCd000000000000000000000000000000000001',
    },
    contractAddress: '0xAbCd000000000000000000000000000000000001',
    name: 'USD Coin',
    symbol: 'USDC',
  });
  const hidden = asset({
    identity: {
      assetType: 'native',
      networkId: 'primewave',
      assetId: 'hidden-native',
    },
    name: 'Hidden Reserve',
    symbol: 'HIDE',
    visibility: 'hidden',
  });
  const assets = [asset(), token, hidden];

  assert.deepEqual(filterPortfolioAssets(assets, 'all', 'usdc'), [token]);
  assert.deepEqual(filterPortfolioAssets(assets, 'all', '0xabcd'), [token]);
  assert.deepEqual(filterPortfolioAssets(assets, 'visible', ''), [assets[0], token]);
  assert.deepEqual(filterPortfolioAssets(assets, 'hidden', ''), [hidden]);
  assert.deepEqual(filterPortfolioAssets(assets, 'hidden', 'reserve'), [hidden]);
});

test('sanitizes application errors before they reach the Home UI', () => {
  assert.equal(
    safePortfolioMessage(new Error('private RPC URL and stack')),
    'Portfolio data is currently unavailable. Try refreshing again later.',
  );
  assert.equal(
    safePortfolioMessage(new PortfolioReadModelError('READ_MODEL_AGGREGATION_FAILED')),
    'The portfolio read-model could not be generated.',
  );
  assert.equal(
    safePortfolioDiagnostic(new PortfolioReadModelError('READ_MODEL_AGGREGATION_FAILED')),
    'READ_MODEL_AGGREGATION_FAILED: The portfolio read-model could not be generated.',
  );
  assert.equal(
    safePortfolioDiagnostic(new Error('private RPC URL and stack')),
    null,
  );
});