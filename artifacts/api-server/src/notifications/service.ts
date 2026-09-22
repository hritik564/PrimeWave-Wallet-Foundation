import { randomUUID } from "node:crypto";
import { NotificationError, NotificationProviderError } from "./errors";
import type { NotificationConfig } from "./types";
import type {
  NotificationContent,
  NotificationDeliveryWorkItem,
  NotificationEventRecord,
  NotificationProvider,
  NotificationProviderResult,
  NotificationRepository,
  PublicNotificationDevice,
  NotificationScope,
} from "./types";
import {
  normalizeNotificationEvent,
  normalizeNotificationScope,
  preferenceForEventType,
  publicDate,
  type NotificationDeviceBody,
  type NotificationEventInput,
  type NotificationPreferencesInput,
} from "./validation";

const providerFailureMessages: Record<string, string> = {
  CONFIGURATION_MISSING: "No notification provider is configured.",
  TIMEOUT: "The notification provider timed out.",
  RATE_LIMIT: "The notification provider rate-limited the request.",
  INVALID_TOKEN: "The registered device token is invalid.",
  DISABLED_REGISTRATION: "The device registration is disabled.",
  MALFORMED_REQUEST: "The notification request was rejected.",
  UNAVAILABLE: "The notification provider is unavailable.",
};

function preferenceEnabled(
  preferences: Awaited<ReturnType<NotificationRepository["getPreferences"]>>,
  event: NotificationEventRecord,
): boolean {
  return preferences[preferenceForEventType(event.eventType)];
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function contentForEvent(event: NotificationEventRecord): NotificationContent {
  const network = event.networkId;
  switch (event.eventType) {
    case "transaction_confirmed":
      return {
        title: "Transaction confirmed",
        body: `A transaction was confirmed on ${network}.`,
        data: {
          notificationEventId: event.notificationEventId,
          eventType: event.eventType,
          networkId: network,
          transactionHash: event.transactionHash,
        },
      };
    case "transaction_reverted":
      return {
        title: "Transaction reverted",
        body: `A transaction reverted on ${network}.`,
        data: {
          notificationEventId: event.notificationEventId,
          eventType: event.eventType,
          networkId: network,
          transactionHash: event.transactionHash,
        },
      };
    case "incoming_transaction":
      return {
        title: "Incoming transaction",
        body: event.counterpartyAddress
          ? `Incoming public blockchain activity from ${shortAddress(event.counterpartyAddress)}.`
          : `Incoming public blockchain activity on ${network}.`,
        data: {
          notificationEventId: event.notificationEventId,
          eventType: event.eventType,
          networkId: network,
          transactionHash: event.transactionHash,
        },
      };
    case "swap_completed":
      return {
        title: "Swap completed",
        body: `A swap completed on ${network}.`,
        data: {
          notificationEventId: event.notificationEventId,
          eventType: event.eventType,
          networkId: network,
          transactionHash: event.transactionHash,
        },
      };
    case "security_event":
      return {
        title: "Security event",
        body: "A security event requires your attention.",
        data: {
          notificationEventId: event.notificationEventId,
          eventType: event.eventType,
          networkId: network,
          transactionHash: null,
        },
      };
  }
}

function providerFailure(error: unknown): {
  readonly kind:
    | "configuration_missing"
    | "timeout"
    | "rate_limit"
    | "invalid_token"
    | "disabled_registration"
    | "malformed_request"
    | "provider_unavailable";
  readonly message: string;
  readonly retryable: boolean;
} {
  if (!(error instanceof NotificationProviderError)) {
    return {
      kind: "provider_unavailable",
      message: "The notification provider returned an unavailable response.",
      retryable: true,
    };
  }
  switch (error.code) {
    case "TIMEOUT":
      return { kind: "timeout", message: providerFailureMessages.TIMEOUT, retryable: true };
    case "RATE_LIMIT":
      return {
        kind: "rate_limit",
        message: providerFailureMessages.RATE_LIMIT,
        retryable: true,
      };
    case "INVALID_TOKEN":
      return {
        kind: "invalid_token",
        message: providerFailureMessages.INVALID_TOKEN,
        retryable: false,
      };
    case "DISABLED_REGISTRATION":
      return {
        kind: "disabled_registration",
        message: providerFailureMessages.DISABLED_REGISTRATION,
        retryable: false,
      };
    case "MALFORMED_REQUEST":
      return {
        kind: "malformed_request",
        message: providerFailureMessages.MALFORMED_REQUEST,
        retryable: false,
      };
    case "CONFIGURATION_MISSING":
      return {
        kind: "configuration_missing",
        message: providerFailureMessages.CONFIGURATION_MISSING,
        retryable: false,
      };
    case "UNAVAILABLE":
      return {
        kind: "provider_unavailable",
        message: providerFailureMessages.UNAVAILABLE,
        retryable: true,
      };
  }
}

export class NotificationService {
  constructor(
    private readonly config: NotificationConfig,
    private readonly repository: NotificationRepository,
  ) {}

  async registerDevice(input: NotificationDeviceBody): Promise<PublicNotificationDevice> {
    if (!this.config.enabled) {
      throw new NotificationError(
        "PERSISTENCE_FAILURE",
        "Notifications are disabled by server configuration.",
      );
    }
    const scope = normalizeNotificationScope(input);
    return this.repository.upsertDevice({
      registrationId: randomUUID(),
      scope,
      deviceIdentifier: input.deviceIdentifier,
      platform: input.platform,
      pushToken: input.pushToken,
      appVersion: input.appVersion,
      environment: input.environment,
    }, this.config.maxDevicesPerScope);
  }

  async unregisterDevice(
    scopeInput: NotificationScope,
    registrationId: string,
  ): Promise<void> {
    const scope = normalizeNotificationScope(scopeInput);
    const stored = await this.repository.getDeviceByRegistrationId(registrationId);
    if (
      !stored ||
      stored.networkId !== scope.networkId ||
      stored.chainId !== scope.chainId ||
      stored.accountAddress !== scope.accountAddress ||
      !(await this.repository.disableDevice(stored, registrationId))
    ) {
      throw new NotificationError("DEVICE_NOT_FOUND", "The device registration was not found.");
    }
  }

  async getPreferences(scopeInput: NotificationScope) {
    return this.repository.getPreferences(normalizeNotificationScope(scopeInput));
  }

  async updatePreferences(
    scopeInput: NotificationScope,
    update: NotificationPreferencesInput,
  ) {
    const scope = normalizeNotificationScope(scopeInput);
    return this.repository.updatePreferences(scope, update);
  }

  async createEvent(input: NotificationEventInput) {
    const normalized = normalizeNotificationEvent(input);
    const event: NotificationEventRecord = {
      ...normalized,
      notificationEventId: normalized.notificationEventId,
      createdAt: new Date(),
    };
    const existing = await this.repository.getEventByDeduplication(
      event,
      event.deduplicationKey,
    );
    if (existing) return { event: existing, deliveries: [], duplicate: true };
    const preferences = await this.repository.getPreferences(event);
    const devices = preferenceEnabled(preferences, event)
      ? (await this.repository.listDevices(event)).filter((device) => device.enabled)
      : [];
    const result = await this.repository.createEvent(
      event,
      devices.map((device) => device.registrationId),
      this.config.maxPendingDeliveries,
    );
    return { ...result, duplicate: false };
  }

  async processNextDelivery(
    provider: NotificationProvider,
    now = new Date(),
  ): Promise<{
    readonly state: "delivered" | "sent" | "retrying" | "failed" | "empty";
    readonly deliveryId?: number;
  }> {
    const item = await this.repository.claimNextDelivery(now);
    if (!item) return { state: "empty" };
    const content = contentForEvent(item.event);
    if (Buffer.byteLength(JSON.stringify(content), "utf8") > provider.maxPayloadBytes) {
      await this.repository.markDeliveryFailed(
        item.delivery.id,
        {
          kind: "malformed_request",
          message: "The notification payload exceeds the provider limit.",
          retryAt: null,
        },
        now,
      );
      return { state: "failed", deliveryId: item.delivery.id };
    }
    try {
      const result = await provider.send({
        pushToken: item.device.pushToken,
        content,
      });
      await this.repository.markDeliverySent(
        item.delivery.id,
        provider.providerId,
        result,
        now,
      );
      return { state: result.status === "delivered" ? "delivered" : "sent", deliveryId: item.delivery.id };
    } catch (error) {
      const failure = providerFailure(error);
      const retryAllowed =
        failure.retryable && item.delivery.attemptCount < this.config.maxAttempts;
      const retryAt = retryAllowed
        ? new Date(
            now.getTime() +
              Math.min(
                this.config.maxBackoffMs,
                1_000 * 2 ** Math.max(0, item.delivery.attemptCount - 1),
              ),
          )
        : null;
      await this.repository.markDeliveryFailed(
        item.delivery.id,
        { kind: failure.kind, message: failure.message, retryAt },
        now,
      );
      return {
        state: retryAt ? "retrying" : "failed",
        deliveryId: item.delivery.id,
      };
    }
  }

  static contentForEvent(event: NotificationEventRecord): NotificationContent {
    return contentForEvent(event);
  }

  static publicPreferences(
    preferences: Awaited<ReturnType<NotificationRepository["getPreferences"]>>,
  ) {
    return {
      networkId: preferences.networkId,
      chainId: preferences.chainId,
      accountAddress: preferences.accountAddress,
      transactionConfirmations: preferences.transactionConfirmations,
      incomingTransactions: preferences.incomingTransactions,
      transactionFailures: preferences.transactionFailures,
      swaps: preferences.swaps,
      securityEvents: preferences.securityEvents,
      updatedAt: publicDate(preferences.updatedAt)!,
    };
  }
}