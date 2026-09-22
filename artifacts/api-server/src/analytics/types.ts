export type AnalyticsIdentityScope = "installation" | "session";
export type AnalyticsPlatform = "ios" | "android" | "web";
export type AnalyticsEnvironment = "development" | "testnet" | "mainnet";
export type AnalyticsDeliveryState = "persisted" | "unconfigured" | "provider_failed";

export interface AnalyticsConfig {
  readonly enabled: boolean;
  readonly maxBatchEvents: number;
  readonly maxEventPayloadBytes: number;
  readonly eventRetentionMs: number;
  readonly errorRetentionMs: number;
  readonly performanceRetentionMs: number;
  readonly cleanupBatchSize: number;
}

export interface AnalyticsEventRecord {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventVersion: number;
  readonly anonymousId: string;
  readonly identityScope: AnalyticsIdentityScope;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly appVersion: string;
  readonly platform: AnalyticsPlatform;
  readonly environment: AnalyticsEnvironment;
  readonly properties: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface AnalyticsErrorRecord {
  readonly telemetryId: string;
  readonly errorCategory: string;
  readonly errorCode: string;
  readonly area: string;
  readonly operation: string;
  readonly platform: AnalyticsPlatform;
  readonly appVersion: string;
  readonly environment: AnalyticsEnvironment;
  readonly durationBucket: string | null;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly expiresAt: Date;
}

export interface AnalyticsPerformanceRecord {
  readonly telemetryId: string;
  readonly metricName: string;
  readonly valueBucket: string;
  readonly area: string;
  readonly operation: string;
  readonly platform: AnalyticsPlatform;
  readonly appVersion: string;
  readonly environment: AnalyticsEnvironment;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly expiresAt: Date;
}

export interface AnalyticsRepository {
  readonly configured: boolean;
  insertEvent(
    event: AnalyticsEventRecord,
  ): Promise<{ readonly inserted: boolean }>;
  insertError(error: AnalyticsErrorRecord): Promise<{ readonly inserted: boolean }>;
  insertPerformance(
    performance: AnalyticsPerformanceRecord,
  ): Promise<{ readonly inserted: boolean }>;
  deleteExpired(
    now: Date,
    limit: number,
  ): Promise<{ readonly events: number; readonly errors: number; readonly performance: number }>;
}

export interface AnalyticsProvider {
  readonly providerId: string;
  readonly configured: boolean;
  trackEvent(event: AnalyticsEventRecord): Promise<void>;
  trackError(error: AnalyticsErrorRecord): Promise<void>;
  trackPerformance(performance: AnalyticsPerformanceRecord): Promise<void>;
}