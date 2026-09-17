import type {
  ActivityListOptions,
  ActivityRecord,
  ActivityScope,
} from './models';
import type { ActivityRepository } from './repository';

export interface ActivityReadModelItem
  extends Omit<ActivityRecord, 'kind' | 'chainId'> {
  readonly kind: 'activity-item';
  readonly chainId: bigint;
  readonly identity: string;
}

export interface ActivityReadModel {
  readonly kind: 'activity-read-model';
  readonly scope: ActivityScope;
  readonly items: readonly ActivityReadModelItem[];
  readonly totalReturned: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
}

export interface ActivityReadModelQuery extends ActivityScope, ActivityListOptions {}

function identityFor(record: ActivityRecord): string {
  return record.localTransactionId
    ? `local:${record.localTransactionId}`
    : `hash:${record.networkId}:${record.chainId.toString()}:${record.transactionHash}`;
}

function toItem(record: ActivityRecord): ActivityReadModelItem {
  return Object.freeze({
    ...record,
    kind: 'activity-item',
    identity: identityFor(record),
  });
}

export class ActivityReadModelService {
  constructor(private readonly repository: ActivityRepository) {}

  getActivity(query: ActivityReadModelQuery): ActivityReadModel {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const items = this.repository.listByAccountAndNetwork(query, {
      limit,
      offset,
    }).map(toItem);
    return Object.freeze({
      kind: 'activity-read-model',
      scope: Object.freeze({
        accountId: query.accountId,
        networkId: query.networkId,
        chainId: query.chainId,
      }),
      items: Object.freeze(items),
      totalReturned: items.length,
      offset,
      limit,
      nextOffset: items.length === limit ? offset + limit : null,
    });
  }
}