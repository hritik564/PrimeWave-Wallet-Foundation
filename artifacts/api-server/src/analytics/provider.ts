import { AnalyticsRequestError } from "./errors";
import type {
  AnalyticsErrorRecord,
  AnalyticsEventRecord,
  AnalyticsPerformanceRecord,
  AnalyticsProvider,
} from "./types";

export class UnconfiguredAnalyticsProvider implements AnalyticsProvider {
  readonly providerId = "unconfigured";
  readonly configured = false;

  async trackEvent(): Promise<void> {
    throw new AnalyticsRequestError(
      "PERSISTENCE_FAILURE",
      "No analytics provider is configured.",
    );
  }

  async trackError(): Promise<void> {
    throw new AnalyticsRequestError(
      "PERSISTENCE_FAILURE",
      "No analytics provider is configured.",
    );
  }

  async trackPerformance(): Promise<void> {
    throw new AnalyticsRequestError(
      "PERSISTENCE_FAILURE",
      "No analytics provider is configured.",
    );
  }
}

export class DeterministicMockAnalyticsProvider implements AnalyticsProvider {
  readonly providerId = "deterministic-mock";
  readonly configured = true;
  readonly events: AnalyticsEventRecord[] = [];
  readonly errors: AnalyticsErrorRecord[] = [];
  readonly performance: AnalyticsPerformanceRecord[] = [];

  async trackEvent(event: AnalyticsEventRecord): Promise<void> {
    this.events.push(event);
  }

  async trackError(error: AnalyticsErrorRecord): Promise<void> {
    this.errors.push(error);
  }

  async trackPerformance(performance: AnalyticsPerformanceRecord): Promise<void> {
    this.performance.push(performance);
  }
}