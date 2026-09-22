import { randomUUID } from "node:crypto";
import { AnalyticsRequestError } from "./errors";
import { UnconfiguredAnalyticsProvider } from "./provider";
import type {
  AnalyticsConfig,
  AnalyticsDeliveryState,
  AnalyticsErrorRecord,
  AnalyticsPerformanceRecord,
  AnalyticsProvider,
  AnalyticsRepository,
} from "./types";
import {
  normalizeAnalyticsError,
  normalizeAnalyticsEvent,
  normalizeAnalyticsPerformance,
  type AnalyticsErrorInput,
  type AnalyticsEventInput,
  type AnalyticsPerformanceInput,
} from "./validation";

export class AnalyticsService {
  private readonly provider: AnalyticsProvider;

  constructor(
    private readonly config: AnalyticsConfig,
    private readonly repository: AnalyticsRepository,
    provider: AnalyticsProvider = new UnconfiguredAnalyticsProvider(),
  ) {
    this.provider = provider;
  }

  async ingestEvent(input: AnalyticsEventInput): Promise<{
    readonly accepted: boolean;
    readonly duplicate: boolean;
    readonly delivery: AnalyticsDeliveryState;
  }> {
    if (!this.config.enabled) {
      return { accepted: false, duplicate: false, delivery: "unconfigured" };
    }
    const event = normalizeAnalyticsEvent(
      input,
      new Date(),
      this.config.eventRetentionMs,
    );
    let stored: { readonly inserted: boolean };
    try {
      stored = await this.repository.insertEvent(event);
    } catch {
      return { accepted: false, duplicate: false, delivery: "provider_failed" };
    }
    if (!this.repository.configured) {
      return { accepted: false, duplicate: false, delivery: "unconfigured" };
    }
    if (!stored.inserted) {
      return {
        accepted: true,
        duplicate: true,
        delivery: this.provider.configured ? "persisted" : "unconfigured",
      };
    }
    let delivery: AnalyticsDeliveryState = this.provider.configured
      ? "persisted"
      : "unconfigured";
    try {
      await this.provider.trackEvent(event);
    } catch {
      delivery = "provider_failed";
    }
    return { accepted: true, duplicate: false, delivery };
  }

  async ingestBatch(inputs: readonly AnalyticsEventInput[]) {
    if (inputs.length > this.config.maxBatchEvents) {
      throw new AnalyticsRequestError(
        "BATCH_LIMIT",
        "The analytics batch is too large.",
      );
    }
    const results = [];
    for (const input of inputs) {
      results.push(await this.ingestEvent(input));
    }
    return {
      accepted: results.filter((result) => result.accepted).length,
      duplicates: results.filter((result) => result.duplicate).length,
      rejected: results.filter((result) => !result.accepted).length,
    };
  }

  async recordError(input: AnalyticsErrorInput): Promise<void> {
    if (!this.config.enabled) return;
    const record = normalizeAnalyticsError(
      input,
      new Date(),
      this.config.errorRetentionMs,
    );
    await this.persistAndTrack(
      record,
      () => this.repository.insertError(record),
      () => this.provider.trackError(record),
    );
  }

  async recordPerformance(input: AnalyticsPerformanceInput): Promise<void> {
    if (!this.config.enabled) return;
    const record = normalizeAnalyticsPerformance(
      input,
      new Date(),
      this.config.performanceRetentionMs,
    );
    await this.persistAndTrack(
      record,
      () => this.repository.insertPerformance(record),
      () => this.provider.trackPerformance(record),
    );
  }

  async cleanupExpired(now = new Date()) {
    return this.repository.deleteExpired(now, this.config.cleanupBatchSize);
  }

  private async persistAndTrack(
    _record: AnalyticsErrorRecord | AnalyticsPerformanceRecord,
    persist: () => Promise<{ readonly inserted: boolean }>,
    track: () => Promise<void>,
  ): Promise<void> {
    try {
      await persist();
    } catch {
      return;
    }
    try {
      await track();
    } catch {
      // Analytics failure is deliberately isolated from wallet and API work.
    }
  }

  static safeTelemetryId(): string {
    return randomUUID();
  }
}