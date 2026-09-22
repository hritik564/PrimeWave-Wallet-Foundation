import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AnalyticsClientOptions,
  AnalyticsEvent,
  AnalyticsIdentityScope,
  AnalyticsStorage,
  AnalyticsTrackResult,
} from './types';

const INSTALLATION_KEY = '@wavex/analytics-installation-id';
const SESSION_PREFIX = 'session_';
const INSTALLATION_PREFIX = 'installation_';

function randomIdentifier(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
        .toString(36)
        .slice(2)}`;
  return `${prefix}${uuid.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

class AnalyticsIdentity {
  private sessionId = randomIdentifier(SESSION_PREFIX);

  constructor(private readonly storage: AnalyticsStorage) {}

  async installationId(): Promise<string> {
    try {
      const existing = await this.storage.getItem(INSTALLATION_KEY);
      if (existing?.startsWith(INSTALLATION_PREFIX)) return existing;
    } catch {
      // A storage failure falls back to a non-persistent, session-safe identity.
    }
    const created = randomIdentifier(INSTALLATION_PREFIX);
    try {
      await this.storage.setItem(INSTALLATION_KEY, created);
    } catch {
      // A storage failure falls back to a non-persistent, session-safe identity.
    }
    return created;
  }

  session(): string {
    return this.sessionId;
  }

  resetSession(): void {
    this.sessionId = randomIdentifier(SESSION_PREFIX);
  }
}

export class AnalyticsClient {
  private readonly identity: AnalyticsIdentity;
  private readonly maxBatchEvents: number;
  private readonly maxPayloadBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AnalyticsClientOptions) {
    this.identity = new AnalyticsIdentity(options.storage ?? AsyncStorage);
    this.maxBatchEvents = options.maxBatchEvents ?? 20;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 16_384;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async track(event: AnalyticsEvent): Promise<AnalyticsTrackResult> {
    return this.send([event]);
  }

  async trackBatch(events: readonly AnalyticsEvent[]): Promise<AnalyticsTrackResult> {
    if (events.length === 0 || events.length > this.maxBatchEvents) {
      return { accepted: false, reason: 'rejected' };
    }
    return this.send(events);
  }

  resetSession(): void {
    this.identity.resetSession();
  }

  private async send(events: readonly AnalyticsEvent[]): Promise<AnalyticsTrackResult> {
    if (this.options.enabled === false || !this.options.endpoint) {
      return { accepted: false, reason: 'disabled' };
    }
    const installationId = await this.identity.installationId();
    const sessionId = this.identity.session();
    const identityScope: AnalyticsIdentityScope = 'session';
    const payload = {
      events: events.map((event, index) => ({
        eventId: `${sessionId}_${Date.now().toString(36)}_${index}`,
        eventVersion: 1 as const,
        anonymousId: sessionId,
        identityScope,
        timestamp: new Date().toISOString(),
        appVersion: this.options.appVersion,
        platform: this.options.platform,
        environment: this.options.environment,
        eventName: event.eventName,
        properties: event.properties,
      })),
    };
    // Resolve installation identity to keep its lifecycle explicit without
    // transmitting it or creating a cross-session identity graph.
    void installationId;
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > this.maxPayloadBytes) {
      return { accepted: false, reason: 'rejected' };
    }
    try {
      const response = await this.fetchImpl(`${this.options.endpoint}/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!response.ok) return { accepted: false, reason: 'rejected' };
      return { accepted: true, reason: 'accepted' };
    } catch {
      return { accepted: false, reason: 'unavailable' };
    }
  }
}

export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  return new AnalyticsClient(options);
}