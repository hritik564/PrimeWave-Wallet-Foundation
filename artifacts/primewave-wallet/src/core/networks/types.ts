export type NetworkEnvironment = 'development' | 'testnet' | 'mainnet';

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface EvmNetwork {
  id: string;
  name: string;
  chainId: number | null;
  rpcUrl: string | null;
  explorerUrl: string | null;
  nativeCurrency: NativeCurrency;
  isPrimary: boolean;
  environment: NetworkEnvironment;
}