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

interface AdmissionBucket {
  count: number;
  resetAt: number;
}

export class AnalyticsService {
  private readonly provider: AnalyticsProvider;
  private readonly identityAdmission = new Map<string, AdmissionBucket>();
  private totalAdmissionCount = 0;
  private totalAdmissionResetAt = 0;

  constructor(
    private readonly config: AnalyticsConfig,
    private readonly repository: AnalyticsRepository,
    provider: AnalyticsProvider = new UnconfiguredAnalyticsProvider(),
    private readonly now: () => Date = () => new Date(),
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
      this.now(),
      this.config.eventRetentionMs,
    );
    this.admitEvent(event.anonymousId, event.receivedAt);
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
      this.now(),
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
      this.now(),
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

  get admissionIdentityCount(): number {
    return this.identityAdmission.size;
  }

  private admitEvent(identity: string, receivedAt: Date): void {
    const now = receivedAt.getTime();
    this.removeExpiredAdmission(now);
    if (this.totalAdmissionResetAt <= now) {
      this.totalAdmissionCount = 0;
      this.totalAdmissionResetAt = now + this.config.abuseWindowMs;
    }
    if (this.totalAdmissionCount >= this.config.maxTotalEvents) {
      throw new AnalyticsRequestError(
        "ADMISSION_LIMIT",
        "Analytics ingestion is temporarily rate limited.",
      );
    }

    const existing = this.identityAdmission.get(identity);
    if (
      !existing &&
      this.identityAdmission.size >= this.config.maxAnonymousIdentities
    ) {
      throw new AnalyticsRequestError(
        "ADMISSION_LIMIT",
        "Analytics identity admission capacity is temporarily full.",
      );
    }
    const bucket = existing ?? {
      count: 0,
      resetAt: now + this.config.abuseWindowMs,
    };
    if (bucket.count >= this.config.maxEventsPerIdentity) {
      throw new AnalyticsRequestError(
        "ADMISSION_LIMIT",
        "Analytics event admission is temporarily rate limited.",
      );
    }
    bucket.count += 1;
    this.identityAdmission.set(identity, bucket);
    this.totalAdmissionCount += 1;
  }

  private removeExpiredAdmission(now: number): void {
    for (const [identity, bucket] of this.identityAdmission) {
      if (bucket.resetAt <= now) this.identityAdmission.delete(identity);
    }
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