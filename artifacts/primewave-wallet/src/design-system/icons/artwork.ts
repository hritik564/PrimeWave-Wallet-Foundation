import type { AssetIdentity } from '@/src/core/assets';
import { defaultNetworkRegistry } from '@/src/core/networks';

const networks = new Map([
  ['ethereum', 'networks-ethereum'], ['ethereum-sepolia', 'networks-ethereum'],
  ['bnb-smart-chain', 'networks-binance-smart-chain'], ['polygon', 'networks-polygon'],
  ['arbitrum', 'networks-arbitrum-one'], ['base', 'networks-base'], ['optimism', 'networks-optimism'],
]);

const native = new Map([
  [1, 'tokens-ETH'], [11155111, 'tokens-ETH'], [42161, 'tokens-ETH'],
  [10, 'tokens-ETH'], [8453, 'tokens-ETH'], [56, 'tokens-BNB'], [137, 'tokens-POL'],
]);

const contracts = new Map([
  ['1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'tokens-USDC'],
]);

export function networkArtwork(networkId: string) {
  return networks.get(networkId);
}

export function tokenArtwork(asset?: AssetIdentity | null) {
  if (!asset) return;
  const chain = defaultNetworkRegistry.getById(asset.networkId)?.chainId;
  if (chain == null) return;
  if (asset.assetType === 'native' && asset.assetId === 'native') return native.get(chain);
  if (asset.assetType === 'fungible_token') return contracts.get(`${chain}:${asset.assetId.toLowerCase()}`);
}
