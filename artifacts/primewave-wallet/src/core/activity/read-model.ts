import type {
  ActivityListOptions,
  ActivityRecord,
  ActivityScope,
} from './models';
import type { ActivityRepository } from './repository';
import { defaultNetworkRegistry } from '@/src/core/networks';
import {
  toActivityPresentationModel,
  type ActivityPresentationModel,
  type ActivityPresentationOptions,
} from './presentation-model';

export interface ActivityReadModelItem
  extends Omit<ActivityRecord, 'kind' | 'chainId'> {
  readonly kind: 'activity-item';
  readonly chainId: bigint;
  readonly identity: string;
  readonly presentation: ActivityPresentationModel;
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

function toItem(
  record: ActivityRecord,
  presentationOptions: ActivityPresentationOptions,
): ActivityReadModelItem {
  return Object.freeze({
    ...record,
    kind: 'activity-item',
    identity: identityFor(record),
    presentation: toActivityPresentationModel(record, presentationOptions),
  });
}

export class ActivityReadModelService {
  constructor(
    private readonly repository: ActivityRepository,
    presentationOptions: ActivityPresentationOptions = {},
  ) {
    this.presentationOptions = {
      networkRegistry: defaultNetworkRegistry,
      ...presentationOptions,
    };
  }

  private readonly presentationOptions: ActivityPresentationOptions;

  getActivity(query: ActivityReadModelQuery): ActivityReadModel {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const items = this.repository.listByAccountAndNetwork(query, {
      limit,
      offset,
    }).map((record) => toItem(record, this.presentationOptions));
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