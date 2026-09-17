import type {
  ERC20Token,
  TokenAssetIdentity,
  TokenMetadataStatus,
  TokenRequest,
  TokenVerificationStatus,
} from '../../models';

export type TokenProvenance =
  | 'user_added'
  | 'discovered'
  | 'registry'
  | 'external_source';

export type FunctionalTokenProvenance = 'user_added' | 'discovered';

export type TokenDiscoveryState =
  | 'not_discovered'
  | 'discovered'
  | 'manually_added'
  | 'hidden'
  | 'unavailable';

export type TokenVisibility = 'visible' | 'hidden';

export interface TokenMetadataSnapshot {
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly metadataStatus: TokenMetadataStatus;
  readonly observedAtMs: number;
}

export interface TokenDiscoveryObservation {
  readonly assetIdentity: TokenAssetIdentity;
  readonly networkId: string;
  readonly accountId: string | null;
  readonly accountAddress: string | null;
  readonly provenance: FunctionalTokenProvenance;
  readonly discoveredAtMs: number;
  readonly reason: string;
  readonly metadataSnapshot: TokenMetadataSnapshot | null;
}

export interface TokenCandidate {
  readonly token: ERC20Token;
  readonly assetIdentity: TokenAssetIdentity;
  readonly provenance: FunctionalTokenProvenance;
  readonly provenanceObservations: readonly TokenDiscoveryObservation[];
  readonly discoveryState: TokenDiscoveryState;
  readonly verificationStatus: TokenVerificationStatus;
  readonly metadataSnapshot: TokenMetadataSnapshot;
  readonly visibility: TokenVisibility;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface UserAddedTokenRequest extends TokenRequest {
  readonly reason?: string;
  readonly visibility?: TokenVisibility;
}

export interface KnownTokenDiscoveryRequest extends TokenRequest {
  readonly accountId?: string;
  readonly accountAddress?: unknown;
  readonly reason?: string;
  readonly visibility?: TokenVisibility;
}

export interface TransferDiscoveryRequest {
  readonly networkId: string;
  readonly accountId: string;
  readonly accountAddress: unknown;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly maxResults?: number;
  readonly maxMetadataLookups?: number;
}

export interface TokenDiscoveryResult {
  readonly networkId: string;
  readonly accountId: string;
  readonly accountAddress: string;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly candidates: readonly TokenCandidate[];
  readonly logsObserved: number;
  readonly metadataResolved: number;
  readonly retrievedAtMs: number;
}

export interface TokenDiscoveryLimits {
  readonly maxBlockRange: bigint;
  readonly maxResults: number;
  readonly maxMetadataLookups: number;
  readonly maxReasonLength: number;
}

export interface TokenDiscoveryServiceOptions {
  readonly now?: () => number;
  readonly repository?: TokenPreferenceRepository;
  readonly limits?: Partial<TokenDiscoveryLimits>;
}

export interface TokenPreferenceRecord {
  readonly assetIdentity: TokenAssetIdentity;
  readonly visibility: TokenVisibility;
  readonly provenance: readonly TokenProvenance[];
  readonly metadataSnapshot: TokenMetadataSnapshot;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface TokenPreferenceRepository {
  get(identity: TokenAssetIdentity): Promise<TokenPreferenceRecord | undefined>;
  list(): Promise<readonly TokenPreferenceRecord[]>;
  save(record: TokenPreferenceRecord): Promise<void>;
  delete(identity: TokenAssetIdentity): Promise<void>;
}