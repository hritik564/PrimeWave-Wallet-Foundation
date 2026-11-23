import assert from 'node:assert/strict';
import test from 'node:test';
import { networkArtwork, tokenArtwork } from '@/src/design-system/icons/artwork';

test('network and native identities are independent', () => {
  assert.equal(networkArtwork('arbitrum'), 'networks-arbitrum-one');
  assert.equal(networkArtwork('ethereum-sepolia'), networkArtwork('ethereum'));
  assert.equal(networkArtwork('primewave'), undefined);
  assert.equal(tokenArtwork({ networkId:'arbitrum', assetType:'native', assetId:'native' }), 'tokens-ETH');
  assert.equal(tokenArtwork({ networkId:'polygon', assetType:'native', assetId:'native' }), 'tokens-POL');
});

test('contract artwork is scoped to chain and normalized contract', () => {
  const asset = { networkId:'ethereum', assetType:'fungible_token' as const, assetId:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
  assert.equal(tokenArtwork(asset), 'tokens-USDC');
  assert.equal(tokenArtwork({ ...asset, networkId:'base' }), undefined);
  assert.equal(tokenArtwork({ ...asset, assetId:'USDC' }), undefined);
  assert.equal(tokenArtwork({ ...asset, assetType:'nft' }), undefined);
});
