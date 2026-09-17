export type WalletEnvironment = 'development' | 'testnet' | 'mainnet';

export interface EnvironmentConfig {
  environment: WalletEnvironment;
  allowUserAddedNetworks: boolean;
  enableDebugLogging: boolean;
}

export const environmentConfig: EnvironmentConfig = {
  environment: 'development',
  allowUserAddedNetworks: false,
  enableDebugLogging: true,
};