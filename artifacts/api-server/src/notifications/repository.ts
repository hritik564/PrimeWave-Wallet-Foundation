import {
  and,
  asc,
  eq,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  notificationDeliveriesTable,
  notificationDevicesTable,
  notificationEventsTable,
  notificationPreferencesTable,
} from "@workspace/db/schema";
import type { ServerConfig } from "../config";
import { NotificationError } from "./errors";
import type {
  NotificationDeliveryRecord,
  NotificationDeliveryWorkItem,
  NotificationDeviceRegistration,
  NotificationDeviceSummary,
  NotificationEnvironment,
  NotificationEventRecord,
  NotificationFailureKind,
  NotificationPlatform,
  NotificationPreferences,
  PublicNotificationDevice,
  NotificationProviderResult,
  NotificationRepository,
  NotificationScope,
} from "./types";
import { parseMarketAssetDescriptor } from "../market/validation";
import { publicDate } from "./validation";

function scopeKey(scope: NotificationScope): string {
  return `${scope.networkId}:${scope.chainId}:${scope.accountAddress}`;
}

function eventKey(scope: NotificationScope, deduplicationKey: string): string {
  return `${scopeKey(scope)}:${deduplicationKey}`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function eventFromRow(
  row: typeof notificationEventsTable.$inferSelect,
): NotificationEventRecord {
  return {
    networkId: row.networkId,
    chainId: row.chainId,
    accountAddress: row.accountAddress,
    notificationEventId: row.notificationEventId,
    eventType: row.eventType,
    transactionHash: row.transactionHash,
    logIndex: row.logIndex,
    asset: row.assetDescriptor
      ? parseMarketAssetDescriptor(row.assetDescriptor)
      : null,
    amountRaw: row.amountRaw,
    counterpartyAddress: row.counterpartyAddress,
    eventTimestamp: row.eventTimestamp,
    source: row.source,
    deduplicationKey: row.deduplicationKey,
    createdAt: row.createdAt,
  };
}

function deviceFromRow(
  row: typeof notificationDevicesTable.$inferSelect,
): NotificationDeviceRegistration {
  return {
    registrationId: row.registrationId,
    networkId: row.networkId,
    chainId: row.chainId,
    accountAddress: row.accountAddress,
    deviceIdentifier: row.deviceIdentifier,
    platform: row.platform,
    pushToken: row.pushToken,
    appVersion: row.appVersion,
    environment: row.environment,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDeliveryAt: row.lastDeliveryAt,
  };
}

function deviceSummary(
  device: NotificationDeviceRegistration,
): NotificationDeviceSummary {
  return {
    registrationId: device.registrationId,
    networkId: device.networkId,
    chainId: device.chainId,
    accountAddress: device.accountAddress,
    enabled: device.enabled,
  };
}

function preferencesFromRow(
  row: typeof notificationPreferencesTable.$inferSelect,
): NotificationPreferences {
  return {
    networkId: row.networkId,
    chainId: row.chainId,
    accountAddress: row.accountAddress,
    transactionConfirmations: row.transactionConfirmations,
    incomingTransactions: row.incomingTransactions,
    transactionFailures: row.transactionFailures,
    swaps: row.swaps,
    securityEvents: row.securityEvents,
    updatedAt: row.updatedAt,
  };
}

function deliveryFromRow(
  row: typeof notificationDeliveriesTable.$inferSelect,
): NotificationDeliveryRecord {
  return {
    id: row.id,
    notificationEventId: row.notificationEventId,
    registrationId: row.registrationId,
    state: row.state,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    providerId: row.providerId,
    providerMessageId: row.providerMessageId,
    lastErrorKind: row.lastErrorCode as NotificationFailureKind | null,
    lastErrorMessage: row.lastErrorMessage,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const defaultPreferences = (
  scope: NotificationScope,
  now = new Date(),
): NotificationPreferences => ({
  ...scope,
  transactionConfirmations: false,
  incomingTransactions: false,
  transactionFailures: false,
  swaps: false,
  securityEvents: false,
  updatedAt: now,
});

export class EmptyNotificationRepository implements NotificationRepository {
  async upsertDevice(): Promise<PublicNotificationDevice> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async getDevice(): Promise<NotificationDeviceRegistration | null> {
    return null;
  }

  async getDeviceByRegistrationId(): Promise<NotificationDeviceSummary | null> {
    return null;
  }

  async disableDevice(): Promise<boolean> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async listDevices(): Promise<readonly NotificationDeviceSummary[]> {
    return [];
  }

  async getPreferences(scope: NotificationScope): Promise<NotificationPreferences> {
    return defaultPreferences(scope);
  }

  async updatePreferences(): Promise<NotificationPreferences> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async getEventByDeduplication(): Promise<NotificationEventRecord | null> {
    return null;
  }

  async createEvent(): Promise<never> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async countPendingDeliveries(): Promise<number> {
    return 0;
  }

  async claimNextDelivery(): Promise<NotificationDeliveryWorkItem | null> {
    return null;
  }

  async markDeliverySent(): Promise<void> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async markDeliveryFailed(): Promise<void> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }

  async expireDelivery(): Promise<void> {
    throw new NotificationError(
      "PERSISTENCE_FAILURE",
      "Notification persistence is not configured.",
    );
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly devices = new Map<string, NotificationDeviceRegistration>();
  private readonly preferences = new Map<string, NotificationPreferences>();
  private readonly events = new Map<string, NotificationEventRecord>();
  private readonly deliveries = new Map<number, NotificationDeliveryRecord>();
  private nextDeliveryId = 1;

  getDeliveriesForTests(): readonly NotificationDeliveryRecord[] {
    return [...this.deliveries.values()];
  }

  async upsertDevice(input: {
    readonly registrationId: string;
    readonly scope: NotificationScope;
    readonly deviceIdentifier: string;
    readonly platform: NotificationPlatform;
    readonly pushToken: string;
    readonly appVersion: string;
    readonly environment: NotificationEnvironment;
  }, maxDevicesPerScope: number): Promise<PublicNotificationDevice> {
    const now = new Date();
    const existing = [...this.devices.values()].find(
      (device) =>
        scopeKey(device) === scopeKey(input.scope) &&
        device.deviceIdentifier === input.deviceIdentifier,
    );
    if (
      !existing &&
      [...this.devices.values()].filter(
        (device) => scopeKey(device) === scopeKey(input.scope),
      ).length >= maxDevicesPerScope
    ) {
      throw new NotificationError(
        "DEVICE_LIMIT",
        "The maximum number of notification devices has been reached.",
      );
    }
    const record: NotificationDeviceRegistration = {
      ...input.scope,
      registrationId: existing?.registrationId ?? input.registrationId,
      deviceIdentifier: input.deviceIdentifier,
      platform: input.platform,
      pushToken: input.pushToken,
      appVersion: input.appVersion,
      environment: input.environment,
      enabled: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastDeliveryAt: existing?.lastDeliveryAt ?? null,
    };
    this.devices.set(record.registrationId, record);
    return publicDevice(record);
  }

  async getDevice(
    scope: NotificationScope,
    registrationId: string,
  ): Promise<NotificationDeviceRegistration | null> {
    const device = this.devices.get(registrationId);
    return device && scopeKey(device) === scopeKey(scope) ? device : null;
  }

  async getDeviceByRegistrationId(
    registrationId: string,
  ): Promise<NotificationDeviceSummary | null> {
    const device = this.devices.get(registrationId);
    return device ? deviceSummary(device) : null;
  }

  async disableDevice(
    scope: NotificationScope,
    registrationId: string,
  ): Promise<boolean> {
    const device = await this.getDevice(scope, registrationId);
    if (!device) return false;
    this.devices.set(registrationId, {
      ...device,
      enabled: false,
      updatedAt: new Date(),
    });
    for (const [id, delivery] of this.deliveries) {
      if (
        delivery.registrationId === registrationId &&
        (delivery.state === "pending" || delivery.state === "sending")
      ) {
        this.deliveries.set(id, { ...delivery, state: "disabled" });
      }
    }
    return true;
  }

  async listDevices(
    scope: NotificationScope,
  ): Promise<readonly NotificationDeviceSummary[]> {
    return [...this.devices.values()].filter(
      (device) => scopeKey(device) === scopeKey(scope),
    ).map(deviceSummary);
  }

  async getPreferences(scope: NotificationScope): Promise<NotificationPreferences> {
    return this.preferences.get(scopeKey(scope)) ?? defaultPreferences(scope);
  }

  async updatePreferences(
    scope: NotificationScope,
    update: Omit<NotificationPreferences, keyof NotificationScope | "updatedAt">,
  ): Promise<NotificationPreferences> {
    const record = { ...scope, ...update, updatedAt: new Date() };
    this.preferences.set(scopeKey(scope), record);
    return record;
  }

  async getEventByDeduplication(
    scope: NotificationScope,
    deduplicationKey: string,
  ): Promise<NotificationEventRecord | null> {
    return this.events.get(eventKey(scope, deduplicationKey)) ?? null;
  }

  async createEvent(
    event: NotificationEventRecord,
    registrationIds: readonly string[],
    maxPendingDeliveries: number,
  ): Promise<{
    readonly event: NotificationEventRecord;
    readonly deliveries: readonly NotificationDeliveryRecord[];
  }> {
    const key = eventKey(event, event.deduplicationKey);
    const existing = this.events.get(key);
    if (existing) {
      return {
        event: existing,
        deliveries: [...this.deliveries.values()].filter(
          (delivery) => delivery.notificationEventId === existing.notificationEventId,
        ),
      };
    }
    const pending = [...this.deliveries.values()].filter(
      (delivery) => delivery.state === "pending" || delivery.state === "sending",
    ).length;
    if (pending + registrationIds.length > maxPendingDeliveries) {
      throw new NotificationError(
        "QUEUE_LIMIT",
        "The notification delivery queue is full.",
      );
    }
    this.events.set(key, event);
    const deliveries: NotificationDeliveryRecord[] = [];
    for (const registrationId of registrationIds) {
      const device = this.devices.get(registrationId);
      if (!device || !device.enabled) continue;
      const delivery: NotificationDeliveryRecord = {
        id: this.nextDeliveryId++,
        notificationEventId: event.notificationEventId,
        registrationId,
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        providerId: null,
        providerMessageId: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        sentAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.deliveries.set(delivery.id, delivery);
      deliveries.push(delivery);
    }
    return { event, deliveries };
  }

  async countPendingDeliveries(): Promise<number> {
    return [...this.deliveries.values()].filter(
      (delivery) => delivery.state === "pending" || delivery.state === "sending",
    ).length;
  }

  async claimNextDelivery(
    now: Date,
  ): Promise<NotificationDeliveryWorkItem | null> {
    const candidates = [...this.deliveries.values()]
      .filter(
        (delivery) =>
          delivery.state === "pending" &&
          asDate(delivery.nextAttemptAt) <= now,
      )
      .sort((left, right) => left.id - right.id);
    for (const delivery of candidates) {
      const device = this.devices.get(delivery.registrationId);
      if (!device || !device.enabled) {
        this.deliveries.set(delivery.id, {
          ...delivery,
          state: "disabled",
          updatedAt: now,
        });
        continue;
      }
      const sending = {
        ...delivery,
        state: "sending" as const,
        attemptCount: delivery.attemptCount + 1,
        updatedAt: now,
      };
      this.deliveries.set(delivery.id, sending);
      const event = [...this.events.values()].find(
        (candidate) => candidate.notificationEventId === delivery.notificationEventId,
      );
      if (!event) continue;
      return { delivery: sending, event, device };
    }
    return null;
  }

  async markDeliverySent(
    deliveryId: number,
    providerId: string,
    result: NotificationProviderResult,
    now: Date,
  ): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    this.deliveries.set(deliveryId, {
      ...delivery,
      state: result.status === "delivered" ? "delivered" : "sent",
      providerId,
      providerMessageId: result.providerMessageId,
      sentAt: now,
      deliveredAt: result.status === "delivered" ? now : null,
      updatedAt: now,
    });
    const device = this.devices.get(delivery.registrationId);
    if (device) {
      this.devices.set(device.registrationId, {
        ...device,
        lastDeliveryAt: now,
        updatedAt: now,
      });
    }
  }

  async markDeliveryFailed(
    deliveryId: number,
    failure: {
      readonly kind: NotificationFailureKind;
      readonly message: string;
      readonly retryAt: Date | null;
    },
    now: Date,
  ): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    this.deliveries.set(deliveryId, {
      ...delivery,
      state: failure.retryAt ? "pending" : "failed",
      nextAttemptAt: failure.retryAt ?? delivery.nextAttemptAt,
      lastErrorKind: failure.kind,
      lastErrorMessage: failure.message,
      updatedAt: now,
    });
  }

  async expireDelivery(deliveryId: number, now: Date): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    this.deliveries.set(deliveryId, { ...delivery, state: "expired", updatedAt: now });
  }
}

export class PostgresNotificationRepository
  implements NotificationRepository
{
  private async database() {
    return import("@workspace/db").then(({ db }) => db);
  }

  async upsertDevice(input: {
    readonly registrationId: string;
    readonly scope: NotificationScope;
    readonly deviceIdentifier: string;
    readonly platform: NotificationPlatform;
    readonly pushToken: string;
    readonly appVersion: string;
    readonly environment: NotificationEnvironment;
  }, maxDevicesPerScope: number): Promise<PublicNotificationDevice> {
    const db = await this.database();
    const now = new Date();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey(input.scope)}, 0))`,
      );
      const existing = await tx
        .select({ registrationId: notificationDevicesTable.registrationId })
        .from(notificationDevicesTable)
        .where(
          and(
            eq(notificationDevicesTable.networkId, input.scope.networkId),
            eq(notificationDevicesTable.chainId, input.scope.chainId),
            eq(notificationDevicesTable.accountAddress, input.scope.accountAddress),
            eq(notificationDevicesTable.deviceIdentifier, input.deviceIdentifier),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        const count = await tx
          .select({ count: sql<number>`count(*)` })
          .from(notificationDevicesTable)
          .where(
            and(
              eq(notificationDevicesTable.networkId, input.scope.networkId),
              eq(notificationDevicesTable.chainId, input.scope.chainId),
              eq(notificationDevicesTable.accountAddress, input.scope.accountAddress),
            ),
          );
        if (Number(count[0]?.count ?? 0) >= maxDevicesPerScope) {
          throw new NotificationError(
            "DEVICE_LIMIT",
            "The maximum number of notification devices has been reached.",
          );
        }
      }
      const rows = await tx
        .insert(notificationDevicesTable)
        .values({
          registrationId: input.registrationId,
          networkId: input.scope.networkId,
          chainId: input.scope.chainId,
          accountAddress: input.scope.accountAddress,
          deviceIdentifier: input.deviceIdentifier,
          platform: input.platform,
          pushToken: input.pushToken,
          appVersion: input.appVersion,
          environment: input.environment,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            notificationDevicesTable.networkId,
            notificationDevicesTable.chainId,
            notificationDevicesTable.accountAddress,
            notificationDevicesTable.deviceIdentifier,
          ],
          set: {
            pushToken: input.pushToken,
            platform: input.platform,
            appVersion: input.appVersion,
            environment: input.environment,
            enabled: true,
            updatedAt: now,
          },
        })
        .returning();
      return publicDevice(deviceFromRow(rows[0]!));
    });
  }

  async getDevice(
    scope: NotificationScope,
    registrationId: string,
  ): Promise<NotificationDeviceRegistration | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(notificationDevicesTable)
      .where(
        and(
          eq(notificationDevicesTable.registrationId, registrationId),
          eq(notificationDevicesTable.networkId, scope.networkId),
          eq(notificationDevicesTable.chainId, scope.chainId),
          eq(notificationDevicesTable.accountAddress, scope.accountAddress),
        ),
      )
      .limit(1);
    return rows[0] ? deviceFromRow(rows[0]) : null;
  }

  async getDeviceByRegistrationId(
    registrationId: string,
  ): Promise<NotificationDeviceSummary | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(notificationDevicesTable)
      .where(eq(notificationDevicesTable.registrationId, registrationId))
      .limit(1);
    return rows[0] ? deviceSummary(deviceFromRow(rows[0])) : null;
  }

  async disableDevice(
    scope: NotificationScope,
    registrationId: string,
  ): Promise<boolean> {
    const db = await this.database();
    const now = new Date();
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(notificationDevicesTable)
        .set({ enabled: false, updatedAt: now })
        .where(
          and(
            eq(notificationDevicesTable.registrationId, registrationId),
            eq(notificationDevicesTable.networkId, scope.networkId),
            eq(notificationDevicesTable.chainId, scope.chainId),
            eq(notificationDevicesTable.accountAddress, scope.accountAddress),
          ),
        )
        .returning({ registrationId: notificationDevicesTable.registrationId });
      if (rows.length !== 1) return false;
      await tx
        .update(notificationDeliveriesTable)
        .set({ state: "disabled", updatedAt: now })
        .where(
          and(
            eq(notificationDeliveriesTable.registrationId, registrationId),
            or(
              eq(notificationDeliveriesTable.state, "pending"),
              eq(notificationDeliveriesTable.state, "sending"),
            ),
          ),
        );
      return true;
    });
  }

  async listDevices(
    scope: NotificationScope,
  ): Promise<readonly NotificationDeviceSummary[]> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(notificationDevicesTable)
      .where(
        and(
          eq(notificationDevicesTable.networkId, scope.networkId),
          eq(notificationDevicesTable.chainId, scope.chainId),
          eq(notificationDevicesTable.accountAddress, scope.accountAddress),
        ),
      );
    return rows.map(deviceFromRow).map(deviceSummary);
  }

  async getPreferences(scope: NotificationScope): Promise<NotificationPreferences> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.networkId, scope.networkId),
          eq(notificationPreferencesTable.chainId, scope.chainId),
          eq(notificationPreferencesTable.accountAddress, scope.accountAddress),
        ),
      )
      .limit(1);
    return rows[0] ? preferencesFromRow(rows[0]) : defaultPreferences(scope);
  }

  async updatePreferences(
    scope: NotificationScope,
    update: Omit<NotificationPreferences, keyof NotificationScope | "updatedAt">,
  ): Promise<NotificationPreferences> {
    const db = await this.database();
    const rows = await db
      .insert(notificationPreferencesTable)
      .values({ ...scope, ...update, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.networkId,
          notificationPreferencesTable.chainId,
          notificationPreferencesTable.accountAddress,
        ],
        set: { ...update, updatedAt: new Date() },
      })
      .returning();
    return preferencesFromRow(rows[0]!);
  }

  async getEventByDeduplication(
    scope: NotificationScope,
    deduplicationKey: string,
  ): Promise<NotificationEventRecord | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(notificationEventsTable)
      .where(
        and(
          eq(notificationEventsTable.networkId, scope.networkId),
          eq(notificationEventsTable.chainId, scope.chainId),
          eq(notificationEventsTable.accountAddress, scope.accountAddress),
          eq(notificationEventsTable.deduplicationKey, deduplicationKey),
        ),
      )
      .limit(1);
    return rows[0] ? eventFromRow(rows[0]) : null;
  }

  async createEvent(
    event: NotificationEventRecord,
    registrationIds: readonly string[],
    maxPendingDeliveries: number,
  ): Promise<{
    readonly event: NotificationEventRecord;
    readonly deliveries: readonly NotificationDeliveryRecord[];
  }> {
    const db = await this.database();
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('notifications:pending-deliveries', 0))`,
      );
      const inserted = await tx
        .insert(notificationEventsTable)
        .values({
          notificationEventId: event.notificationEventId,
          networkId: event.networkId,
          chainId: event.chainId,
          accountAddress: event.accountAddress,
          eventType: event.eventType,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          assetDescriptor:
            event.asset?.kind === "native"
              ? `native:${event.asset.networkId}`
              : event.asset
                ? `erc20:${event.asset.networkId}:${event.asset.contractAddress}`
                : null,
          amountRaw: event.amountRaw,
          counterpartyAddress: event.counterpartyAddress,
          eventTimestamp: asDate(event.eventTimestamp),
          source: event.source,
          deduplicationKey: event.deduplicationKey,
          metadata: null,
          createdAt: asDate(event.createdAt),
        })
        .onConflictDoNothing()
        .returning();
      const storedRow =
        inserted[0] ??
        (
          await tx
            .select()
            .from(notificationEventsTable)
            .where(
              and(
                eq(notificationEventsTable.networkId, event.networkId),
                eq(notificationEventsTable.chainId, event.chainId),
                eq(notificationEventsTable.accountAddress, event.accountAddress),
                eq(notificationEventsTable.deduplicationKey, event.deduplicationKey),
              ),
            )
            .limit(1)
        )[0];
      const stored = storedRow ? eventFromRow(storedRow) : null;
      if (!stored) {
        throw new NotificationError(
          "PERSISTENCE_FAILURE",
          "The notification event could not be stored.",
        );
      }
      if (inserted.length > 0 && registrationIds.length > 0) {
        const pending = await tx
          .select({ count: sql<number>`count(*)` })
          .from(notificationDeliveriesTable)
          .where(
            or(
              eq(notificationDeliveriesTable.state, "pending"),
              eq(notificationDeliveriesTable.state, "sending"),
            ),
          );
        if (
          Number(pending[0]?.count ?? 0) + registrationIds.length >
          maxPendingDeliveries
        ) {
          throw new NotificationError(
            "QUEUE_LIMIT",
            "The notification delivery queue is full.",
          );
        }
      }
      if (inserted.length > 0 && registrationIds.length > 0) {
        await tx
          .insert(notificationDeliveriesTable)
          .values(
            registrationIds.map((registrationId) => ({
              notificationEventId: stored.notificationEventId,
              registrationId,
              state: "pending" as const,
              attemptCount: 0,
              nextAttemptAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
          )
          .onConflictDoNothing();
      }
      const deliveryRows = await tx
        .select()
        .from(notificationDeliveriesTable)
        .where(eq(notificationDeliveriesTable.notificationEventId, stored.notificationEventId));
      return {
        event: stored,
        deliveries: deliveryRows.map(deliveryFromRow),
      };
    });
    return result;
  }

  async countPendingDeliveries(): Promise<number> {
    const db = await this.database();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificationDeliveriesTable)
      .where(
        or(
          eq(notificationDeliveriesTable.state, "pending"),
          eq(notificationDeliveriesTable.state, "sending"),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async claimNextDelivery(now: Date): Promise<NotificationDeliveryWorkItem | null> {
    const db = await this.database();
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({
          delivery: notificationDeliveriesTable,
          event: notificationEventsTable,
          device: notificationDevicesTable,
        })
        .from(notificationDeliveriesTable)
        .innerJoin(
          notificationEventsTable,
          eq(
            notificationEventsTable.notificationEventId,
            notificationDeliveriesTable.notificationEventId,
          ),
        )
        .innerJoin(
          notificationDevicesTable,
          eq(
            notificationDevicesTable.registrationId,
            notificationDeliveriesTable.registrationId,
          ),
        )
        .where(
          and(
            eq(notificationDeliveriesTable.state, "pending"),
            lte(notificationDeliveriesTable.nextAttemptAt, now),
            eq(notificationDevicesTable.enabled, true),
          ),
        )
        .orderBy(asc(notificationDeliveriesTable.id))
        .limit(1);
      const candidate = candidates[0];
      if (!candidate) return null;
      const claimed = await tx
        .update(notificationDeliveriesTable)
        .set({
          state: "sending",
          attemptCount: sql`${notificationDeliveriesTable.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(notificationDeliveriesTable.id, candidate.delivery.id),
            eq(notificationDeliveriesTable.state, "pending"),
          ),
        )
        .returning();
      const delivery = claimed[0];
      if (!delivery) return null;
      return {
        delivery: deliveryFromRow(delivery),
        event: eventFromRow(candidate.event),
        device: deviceFromRow(candidate.device),
      };
    });
  }

  async markDeliverySent(
    deliveryId: number,
    providerId: string,
    result: NotificationProviderResult,
    now: Date,
  ): Promise<void> {
    const db = await this.database();
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(notificationDeliveriesTable)
        .set({
          state: result.status === "delivered" ? "delivered" : "sent",
          providerId,
          providerMessageId: result.providerMessageId,
          sentAt: now,
          deliveredAt: result.status === "delivered" ? now : null,
          updatedAt: now,
        })
        .where(eq(notificationDeliveriesTable.id, deliveryId))
        .returning({ registrationId: notificationDeliveriesTable.registrationId });
      if (rows[0]) {
        await tx
          .update(notificationDevicesTable)
          .set({ lastDeliveryAt: now, updatedAt: now })
          .where(eq(notificationDevicesTable.registrationId, rows[0].registrationId));
      }
    });
  }

  async markDeliveryFailed(
    deliveryId: number,
    failure: {
      readonly kind: NotificationFailureKind;
      readonly message: string;
      readonly retryAt: Date | null;
    },
    now: Date,
  ): Promise<void> {
    const db = await this.database();
    await db
      .update(notificationDeliveriesTable)
      .set({
        state: failure.retryAt ? "pending" : "failed",
        nextAttemptAt: failure.retryAt ?? now,
        lastErrorCode: failure.kind,
        lastErrorMessage: failure.message,
        updatedAt: now,
      })
      .where(eq(notificationDeliveriesTable.id, deliveryId));
  }

  async expireDelivery(deliveryId: number, now: Date): Promise<void> {
    const db = await this.database();
    await db
      .update(notificationDeliveriesTable)
      .set({ state: "expired", updatedAt: now })
      .where(
        and(
          eq(notificationDeliveriesTable.id, deliveryId),
          or(
            eq(notificationDeliveriesTable.state, "pending"),
            eq(notificationDeliveriesTable.state, "failed"),
          ),
        ),
      );
  }
}

export function createNotificationRepository(
  config: ServerConfig,
): NotificationRepository {
  return config.databaseUrl
    ? new PostgresNotificationRepository()
    : new EmptyNotificationRepository();
}

export function publicDevice(
  device: NotificationDeviceRegistration,
) {
  return {
    registrationId: device.registrationId,
    networkId: device.networkId,
    chainId: device.chainId,
    accountAddress: device.accountAddress,
    platform: device.platform,
    appVersion: device.appVersion,
    environment: device.environment,
    enabled: device.enabled,
    createdAt: publicDate(device.createdAt)!,
    updatedAt: publicDate(device.updatedAt)!,
    lastDeliveryAt: publicDate(device.lastDeliveryAt),
  };
}