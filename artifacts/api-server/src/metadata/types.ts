export type MetadataStatus = "available" | "partial" | "invalid" | "unavailable";
export type MetadataProvenance =
  | "verified_provider"
  | "user_provided"
  | "registry"
  | "unavailable";
export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";
export type DiscoveryStatus = "not_discovered" | "user_declared" | "observed";
export type VisibilityStatus = "public" | "hidden";
export type TrustStatus = "unassessed" | "review_required" | "not_trusted";
export type FreshnessStatus = "fresh" | "cached" | "stale" | "unavailable";

export interface MetadataProvenanceRecord {
  readonly source: MetadataProvenance;
  readonly reference: string | null;
  readonly observedAt: string | null;
}

export interface PublicNetworkMetadata {
  readonly networkId: string;
  readonly chainId: number | null;
  readonly displayName: string;
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly explorer: {
    readonly name: string;
    readonly baseUrl: string | null;
    readonly addressUrlTemplate: string | null;
    readonly transactionUrlTemplate: string | null;
  };
  readonly environment: "development" | "testnet" | "mainnet";
  readonly isPrimary: boolean;
  readonly enabled: boolean;
  readonly configurationStatus: "configured" | "unavailable" | "placeholder";
  readonly configurationNote: string | null;
  readonly rpc: {
    readonly configured: boolean;
  };
  readonly updatedAt: string | null;
}

export interface StoredNetworkMetadata {
  readonly networkId: string;
  readonly chainId: number | null;
  readonly displayName: string;
  readonly nativeCurrencyName: string;
  readonly nativeCurrencySymbol: string;
  readonly nativeCurrencyDecimals: number;
  readonly explorerName: string;
  readonly explorerBaseUrl: string | null;
  readonly explorerAddressUrlTemplate: string | null;
  readonly explorerTransactionUrlTemplate: string | null;
  readonly environment: "development" | "testnet" | "mainnet";
  readonly isPrimary: boolean;
  readonly enabled: boolean;
  readonly configurationStatus: "configured" | "unavailable" | "placeholder";
  readonly configurationNote: string | null;
  readonly updatedAt: Date | string;
  readonly rpcConfigured: boolean;
}

export interface StoredTokenMetadata {
  readonly networkId: string;
  readonly contractAddress: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly description: string | null;
  readonly logoReference: string | null;
  readonly logoProvenance: MetadataProvenance;
  readonly metadataStatus: MetadataStatus;
  readonly provenance: MetadataProvenance;
  readonly provenanceReference: string | null;
  readonly verificationStatus: VerificationStatus;
  readonly discoveryStatus: DiscoveryStatus;
  readonly visibility: VisibilityStatus;
  readonly trustStatus: TrustStatus;
  readonly freshnessStatus: FreshnessStatus;
  readonly updatedAt: Date | string;
}

export interface PublicTokenMetadata {
  readonly networkId: string;
  readonly contractAddress: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly description: string | null;
  readonly logo: {
    readonly reference: string;
    readonly provenance: MetadataProvenance;
  } | null;
  readonly metadataStatus: MetadataStatus;
  readonly provenance: MetadataProvenanceRecord;
  readonly verificationStatus: VerificationStatus;
  readonly discoveryStatus: DiscoveryStatus;
  readonly visibility: VisibilityStatus;
  readonly trustStatus: TrustStatus;
  readonly freshnessStatus: FreshnessStatus;
  readonly updatedAt: string | null;
}

export interface MetadataRepository {
  listNetworks(): Promise<readonly StoredNetworkMetadata[]>;
  getToken(
    networkId: string,
    contractAddress: string,
  ): Promise<StoredTokenMetadata | null>;
  listTokens(
    networkId: string,
    contractAddresses: readonly string[],
  ): Promise<readonly StoredTokenMetadata[]>;
}