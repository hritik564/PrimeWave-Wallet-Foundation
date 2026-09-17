import type { TokenAssetIdentity } from '../../models';
import { getAssetIdentityKey } from '../../registry';
import type {
  TokenPreferenceRecord,
  TokenPreferenceRepository,
} from './models';

function cloneRecord(record: TokenPreferenceRecord): TokenPreferenceRecord {
  return Object.freeze({
    ...record,
    assetIdentity: Object.freeze({ ...record.assetIdentity }),
    visibility: record.visibility,
    provenance: Object.freeze([...record.provenance]),
    metadataSnapshot: Object.freeze({ ...record.metadataSnapshot }),
  });
}

/**
 * Public metadata repository for tests and session-only consumers.
 *
 * It deliberately has no SecureStore or secret-storage capability. A native
 * public-preference adapter can implement the same interface later.
 */
export class InMemoryTokenPreferenceRepository
  implements TokenPreferenceRepository
{
  private readonly records = new Map<string, TokenPreferenceRecord>();

  async get(
    identity: TokenAssetIdentity,
  ): Promise<TokenPreferenceRecord | undefined> {
    const record = this.records.get(getAssetIdentityKey(identity));
    return record ? cloneRecord(record) : undefined;
  }

  async list(): Promise<readonly TokenPreferenceRecord[]> {
    return Object.freeze([...this.records.values()].map(cloneRecord));
  }

  async save(record: TokenPreferenceRecord): Promise<void> {
    this.records.set(getAssetIdentityKey(record.assetIdentity), cloneRecord(record));
  }

  async delete(identity: TokenAssetIdentity): Promise<void> {
    this.records.delete(getAssetIdentityKey(identity));
  }
}