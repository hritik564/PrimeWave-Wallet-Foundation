export type NetworkEnvironment = 'development' | 'testnet' | 'mainnet';

export type NetworkConfigurationStatus = 'configured' | 'placeholder';

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface RpcEndpoint {
  /**
   * Public endpoint metadata only. Authentication material must be resolved
   * outside this module and must never be embedded in a network definition.
   */
  readonly id: string;
  readonly url: string;
  readonly priority: number;
  readonly enabled?: boolean;
}

export interface RpcEndpointConfiguration {
  /**
   * Ordered endpoints leave room for health checks and failover without
   * changing the network abstraction.
   */
  readonly endpoints: readonly RpcEndpoint[];
}

export interface BlockExplorerConfiguration {
  readonly name: string;
  readonly baseUrl: string | null;
  readonly addressUrlTemplate: string | null;
  readonly transactionUrlTemplate: string | null;
}

export interface EvmNetwork {
  readonly id: string;
  readonly displayName: string;
  readonly chainId: number | null;
  readonly nativeCurrency: NativeCurrency;
  readonly rpc: RpcEndpointConfiguration;
  readonly explorer: BlockExplorerConfiguration;
  readonly environment: NetworkEnvironment;
  readonly isPrimary: boolean;
  readonly enabled: boolean;
  readonly configurationStatus: NetworkConfigurationStatus;
  readonly configurationNote?: string;
}