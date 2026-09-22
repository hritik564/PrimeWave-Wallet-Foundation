import type { MarketAssetIdentity } from "../market/types";

export type NotificationPlatform = "ios" | "android" | "web";
export type NotificationEnvironment = "development" | "testnet" | "mainnet";

export type NotificationEventType =
  | "transaction_confirmed"
  | "transaction_reverted"
  | "incoming_transaction"
  | "swap_completed"
  | "security_event";

export type NotificationDeliveryState =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "disabled"
  | "expired";

export type NotificationPreferenceKey =
  | "transactionConfirmations"
  | "incomingTransactions"
  | "transactionFailures"
  | "swaps"
  | "securityEvents";

export type NotificationFailureKind =
  | "configuration_missing"
  | "timeout"
  | "rate_limit"
  | "invalid_token"
  | "disabled_registration"
  | "malformed_request"
  | "provider_unavailable";

export interface NotificationScope {
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
}

export interface NotificationConfig {
  readonly enabled: boolean;
  readonly maxDevicesPerScope: number;
  readonly maxPendingDeliveries: number;
  readonly maxAttempts: number;
  readonly maxBackoffMs: number;
  readonly deliveryRetentionMs: number;
}

export interface NotificationDeviceRegistration extends NotificationScope {
  readonly registrationId: string;
  readonly deviceIdentifier: string;
  readonly platform: NotificationPlatform;
  readonly pushToken: string;
  readonly appVersion: string;
  readonly environment: NotificationEnvironment;
  readonly enabled: boolean;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
  readonly lastDeliveryAt: Date | string | null;
}

export interface PublicNotificationDevice extends NotificationScope {
  readonly registrationId: string;
  readonly platform: NotificationPlatform;
  readonly appVersion: string;
  readonly environment: NotificationEnvironment;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastDeliveryAt: string | null;
}

export interface NotificationDeviceSummary extends NotificationScope {
  readonly registrationId: string;
  readonly enabled: boolean;
}

export interface NotificationPreferences extends NotificationScope {
  readonly transactionConfirmations: boolean;
  readonly incomingTransactions: boolean;
  readonly transactionFailures: boolean;
  readonly swaps: boolean;
  readonly securityEvents: boolean;
  readonly updatedAt: Date | string;
}

export interface NotificationEventRecord extends NotificationScope {
  readonly notificationEventId: string;
  readonly eventType: NotificationEventType;
  readonly transactionHash: string | null;
  readonly logIndex: number | null;
  readonly asset: MarketAssetIdentity | null;
  readonly amountRaw: string | null;
  readonly counterpartyAddress: string | null;
  readonly eventTimestamp: Date | string;
  readonly source: string;
  readonly deduplicationKey: string;
  readonly createdAt: Date | string;
}

export interface NotificationDeliveryRecord {
  readonly id: number;
  readonly notificationEventId: string;
  readonly registrationId: string;
  readonly state: NotificationDeliveryState;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date | string;
  readonly providerId: string | null;
  readonly providerMessageId: string | null;
  readonly lastErrorKind: NotificationFailureKind | null;
  readonly lastErrorMessage: string | null;
  readonly sentAt: Date | string | null;
  readonly deliveredAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface NotificationDeliveryWorkItem {
  readonly delivery: NotificationDeliveryRecord;
  readonly event: NotificationEventRecord;
  readonly device: NotificationDeviceRegistration;
}

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
  readonly data: {
    readonly notificationEventId: string;
    readonly eventType: NotificationEventType;
    readonly networkId: string;
    readonly transactionHash: string | null;
  };
}

export interface NotificationProviderResult {
  readonly status: "accepted" | "delivered" | "unknown";
  readonly providerMessageId: string | null;
}

export interface NotificationProvider {
  readonly providerId: string;
  readonly maxPayloadBytes: number;
  send(input: {
    readonly pushToken: string;
    readonly content: NotificationContent;
  }): Promise<NotificationProviderResult>;
}

export interface NotificationRepository {
  upsertDevice(input: {
    readonly registrationId: string;
    readonly scope: NotificationScope;
    readonly deviceIdentifier: string;
    readonly platform: NotificationPlatform;
    readonly pushToken: string;
    readonly appVersion: string;
    readonly environment: NotificationEnvironment;
  }, maxDevicesPerScope: number): Promise<PublicNotificationDevice>;
  getDeviceByRegistrationId(
    registrationId: string,
  ): Promise<NotificationDeviceSummary | null>;
  disableDevice(scope: NotificationScope, registrationId: string): Promise<boolean>;
  listDevices(scope: NotificationScope): Promise<
    readonly NotificationDeviceSummary[]
  >;
  getPreferences(scope: NotificationScope): Promise<NotificationPreferences>;
  updatePreferences(
    scope: NotificationScope,
    update: Omit<
      NotificationPreferences,
      keyof NotificationScope | "updatedAt"
    >,
  ): Promise<NotificationPreferences>;
  getEventByDeduplication(
    scope: NotificationScope,
    deduplicationKey: string,
  ): Promise<NotificationEventRecord | null>;
  createEvent(
    event: NotificationEventRecord,
    registrationIds: readonly string[],
    maxPendingDeliveries: number,
  ): Promise<{
    readonly event: NotificationEventRecord;
    readonly deliveries: readonly NotificationDeliveryRecord[];
  }>;
  countPendingDeliveries(): Promise<number>;
  claimNextDelivery(now: Date): Promise<NotificationDeliveryWorkItem | null>;
  markDeliverySent(
    deliveryId: number,
    providerId: string,
    result: NotificationProviderResult,
    now: Date,
  ): Promise<void>;
  markDeliveryFailed(
    deliveryId: number,
    failure: {
      readonly kind: NotificationFailureKind;
      readonly message: string;
      readonly retryAt: Date | null;
    },
    now: Date,
  ): Promise<void>;
  expireDelivery(deliveryId: number, now: Date): Promise<void>;
}