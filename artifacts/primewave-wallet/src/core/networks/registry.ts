import type { EvmNetwork } from './types';

/**
 * PrimeWave Chain is intentionally represented as an unconfigured primary
 * network in Phase 0A. Production values must be supplied and reviewed later.
 */
export const supportedNetworks: readonly EvmNetwork[] = [
  {
    id: 'primewave',
    name: 'PrimeWave Chain',
    chainId: null,
    rpcUrl: null,
    explorerUrl: null,
    nativeCurrency: {
      name: 'PrimeWave native currency',
      symbol: 'TBD',
      decimals: 18,
    },
    isPrimary: true,
    environment: 'mainnet',
  },
];