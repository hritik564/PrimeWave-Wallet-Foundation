import type {
  SwapQuoteProvider,
  SwapQuoteProviderMetadata,
} from './models';
import { SwapError } from './errors';

const CAPABILITIES = new Set([
  'exact-input',
  'multi-hop-route',
  'transaction-request',
]);

export function validateSwapQuoteProviderMetadata(
  metadata: SwapQuoteProviderMetadata,
): SwapQuoteProviderMetadata {
  if (
    typeof metadata.providerId !== 'string' ||
    metadata.providerId.trim().length === 0 ||
    typeof metadata.displayName !== 'string' ||
    metadata.displayName.trim().length === 0 ||
    !Array.isArray(metadata.supportedNetworks) ||
    metadata.supportedNetworks.length === 0 ||
    metadata.supportedNetworks.some(
      (networkId) => typeof networkId !== 'string' || networkId.trim().length === 0,
    ) ||
    !Array.isArray(metadata.supportedCapabilities) ||
    metadata.supportedCapabilities.some(
      (capability) => !CAPABILITIES.has(capability),
    )
  ) {
    throw new SwapError('SWAP_PROVIDER_ERROR');
  }
  return Object.freeze({
    ...metadata,
    supportedNetworks: Object.freeze([...metadata.supportedNetworks]),
    supportedCapabilities: Object.freeze([...metadata.supportedCapabilities]),
  });
}

export function createSwapQuoteProvider(
  provider: SwapQuoteProvider,
): SwapQuoteProvider {
  if (
    typeof provider !== 'object' ||
    provider === null ||
    typeof provider.getQuote !== 'function'
  ) {
    throw new SwapError('SWAP_PROVIDER_ERROR');
  }
  const metadata = validateSwapQuoteProviderMetadata(provider.metadata);
  return Object.freeze({
    metadata,
    getQuote: provider.getQuote,
  });
}