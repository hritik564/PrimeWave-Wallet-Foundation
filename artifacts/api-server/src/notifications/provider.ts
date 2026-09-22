import { NotificationProviderError } from "./errors";
import type {
  NotificationContent,
  NotificationProvider,
  NotificationProviderResult,
} from "./types";

export class UnconfiguredNotificationProvider implements NotificationProvider {
  readonly providerId = "unconfigured";
  readonly maxPayloadBytes = 4096;

  async send(_input: {
    readonly pushToken: string;
    readonly content: NotificationContent;
  }): Promise<NotificationProviderResult> {
    throw new NotificationProviderError(
      "CONFIGURATION_MISSING",
      "No approved push provider is configured.",
    );
  }
}

export class DeterministicMockNotificationProvider
  implements NotificationProvider
{
  readonly providerId = "deterministic-mock";
  readonly maxPayloadBytes = 4096;

  constructor(
    private readonly result: NotificationProviderResult = {
      status: "delivered",
      providerMessageId: "mock-message",
    },
  ) {}

  async send(input: {
    readonly pushToken: string;
    readonly content: NotificationContent;
  }): Promise<NotificationProviderResult> {
    if (!input.pushToken || !input.content.title || !input.content.body) {
      throw new NotificationProviderError(
        "MALFORMED_REQUEST",
        "The notification request is invalid.",
      );
    }
    return this.result;
  }
}