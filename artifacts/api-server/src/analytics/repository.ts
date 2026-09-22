import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  analyticsErrorsTable,
  analyticsEventsTable,
  analyticsPerformanceTable,
} from "@workspace/db/schema";
import type { ServerConfig } from "../config";
import type {
  AnalyticsErrorRecord,
  AnalyticsEventRecord,
  AnalyticsPerformanceRecord,
  AnalyticsRepository,
} from "./types";

export class EmptyAnalyticsRepository implements AnalyticsRepository {
  readonly configured = false;
  async insertEvent(): Promise<{ readonly inserted: boolean }> {
    return { inserted: false };
  }

  async insertError(): Promise<{ readonly inserted: boolean }> {
    return { inserted: false };
  }

  async insertPerformance(): Promise<{ readonly inserted: boolean }> {
    return { inserted: false };
  }

  async deleteExpired(): Promise<{
    readonly events: number;
    readonly errors: number;
    readonly performance: number;
  }> {
    return { events: 0, errors: 0, performance: 0 };
  }
}

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  readonly configured: boolean = true;
  readonly events = new Map<string, AnalyticsEventRecord>();
  readonly errors = new Map<string, AnalyticsErrorRecord>();
  readonly performance = new Map<string, AnalyticsPerformanceRecord>();

  async insertEvent(event: AnalyticsEventRecord): Promise<{ readonly inserted: boolean }> {
    if (this.events.has(event.eventId)) return { inserted: false };
    this.events.set(event.eventId, event);
    return { inserted: true };
  }

  async insertError(error: AnalyticsErrorRecord): Promise<{ readonly inserted: boolean }> {
    if (this.errors.has(error.telemetryId)) return { inserted: false };
    this.errors.set(error.telemetryId, error);
    return { inserted: true };
  }

  async insertPerformance(
    performance: AnalyticsPerformanceRecord,
  ): Promise<{ readonly inserted: boolean }> {
    if (this.performance.has(performance.telemetryId)) return { inserted: false };
    this.performance.set(performance.telemetryId, performance);
    return { inserted: true };
  }

  async deleteExpired(now: Date, limit: number) {
    const remove = <T extends { readonly expiresAt: Date }>(
      records: Map<string, T>,
      recordLimit: number,
    ): number => {
      let remaining = Math.max(0, recordLimit);
      let deleted = 0;
      for (const [id, record] of records) {
        if (remaining <= 0) break;
        if (record.expiresAt <= now) {
          records.delete(id);
          remaining -= 1;
          deleted += 1;
        }
      }
      return deleted;
    };
    const events = remove(this.events, limit);
    const errors = remove(this.errors, limit);
    const performance = remove(this.performance, limit);
    return { events, errors, performance };
  }
}

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  readonly configured: boolean = true;
  private async database() {
    return import("@workspace/db").then(({ db }) => db);
  }

  async insertEvent(event: AnalyticsEventRecord) {
    const db = await this.database();
    const rows = await db
      .insert(analyticsEventsTable)
      .values({
        eventId: event.eventId,
        eventName: event.eventName,
        eventVersion: event.eventVersion,
        anonymousId: event.anonymousId,
        identityScope: event.identityScope,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
        appVersion: event.appVersion,
        platform: event.platform,
        environment: event.environment,
        properties: event.properties,
        expiresAt: event.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ eventId: analyticsEventsTable.eventId });
    return { inserted: rows.length === 1 };
  }

  async insertError(error: AnalyticsErrorRecord) {
    const db = await this.database();
    const rows = await db
      .insert(analyticsErrorsTable)
      .values({
        telemetryId: error.telemetryId,
        errorCategory: error.errorCategory,
        errorCode: error.errorCode,
        area: error.area,
        operation: error.operation,
        platform: error.platform,
        appVersion: error.appVersion,
        environment: error.environment,
        durationBucket: error.durationBucket,
        occurredAt: error.occurredAt,
        receivedAt: error.receivedAt,
        expiresAt: error.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ telemetryId: analyticsErrorsTable.telemetryId });
    return { inserted: rows.length === 1 };
  }

  async insertPerformance(performance: AnalyticsPerformanceRecord) {
    const db = await this.database();
    const rows = await db
      .insert(analyticsPerformanceTable)
      .values({
        telemetryId: performance.telemetryId,
        metricName: performance.metricName,
        valueBucket: performance.valueBucket,
        area: performance.area,
        operation: performance.operation,
        platform: performance.platform,
        appVersion: performance.appVersion,
        environment: performance.environment,
        occurredAt: performance.occurredAt,
        receivedAt: performance.receivedAt,
        expiresAt: performance.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ telemetryId: analyticsPerformanceTable.telemetryId });
    return { inserted: rows.length === 1 };
  }

  async deleteExpired(now: Date, limit: number) {
    const db = await this.database();
    const deleteExpiredRows = async (
      table:
        | typeof analyticsEventsTable
        | typeof analyticsErrorsTable
        | typeof analyticsPerformanceTable,
      idColumn:
        | typeof analyticsEventsTable.eventId
        | typeof analyticsErrorsTable.telemetryId
        | typeof analyticsPerformanceTable.telemetryId,
    ): Promise<number> => {
      const rows = await db
        .select({ id: idColumn })
        .from(table)
        .where(lte(table.expiresAt, now))
        .orderBy(asc(table.expiresAt))
        .limit(limit);
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      const deleted = await db.delete(table).where(inArray(idColumn, ids)).returning({
        id: idColumn,
      });
      return deleted.length;
    };
    const events = await deleteExpiredRows(analyticsEventsTable, analyticsEventsTable.eventId);
    const errors = await deleteExpiredRows(analyticsErrorsTable, analyticsErrorsTable.telemetryId);
    const performance = await deleteExpiredRows(
      analyticsPerformanceTable,
      analyticsPerformanceTable.telemetryId,
    );
    return { events, errors, performance };
  }
}

export function createAnalyticsRepository(config: ServerConfig): AnalyticsRepository {
  return config.databaseUrl
    ? new PostgresAnalyticsRepository()
    : new EmptyAnalyticsRepository();
}