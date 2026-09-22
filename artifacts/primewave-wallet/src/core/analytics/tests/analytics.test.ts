import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsClient } from '../client';
import type { AnalyticsStorage } from '../types';

class MemoryStorage implements AnalyticsStorage {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

class FailingStorage implements AnalyticsStorage {
  async getItem(): Promise<string | null> {
    throw new Error('storage unavailable');
  }

  async setItem(): Promise<void> {
    throw new Error('storage unavailable');
  }
}

const options = {
  endpoint: 'https://example.invalid/api/v1/analytics/events',
  appVersion: '1.0.0',
  platform: 'ios' as const,
  environment: 'testnet' as const,
  storage: new MemoryStorage(),
};

test('analytics client generates session-scoped anonymous IDs without wallet context', async () => {
  const requestBody: { value: Record<string, unknown> | null } = { value: null };
  const client = new AnalyticsClient({
    ...options,
    fetchImpl: async (_input, init) => {
      requestBody.value = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ data: { accepted: true } }), { status: 202 });
    },
  });
  const result = await client.track({ eventName: 'app_opened', properties: {} });
  assert.deepEqual(result, { accepted: true, reason: 'accepted' });
  const events = requestBody.value?.events as Array<Record<string, unknown>>;
  assert.equal(events.length, 1);
  assert.equal(String(events[0]?.anonymousId).startsWith('session_'), true);
  assert.equal('walletAddress' in events[0]!, false);
  assert.equal('transactionHash' in events[0]!, false);
});

test('analytics client is fail-safe and does not block when disabled or unavailable', async () => {
  const disabled = new AnalyticsClient({ ...options, enabled: false });
  assert.deepEqual(
    await disabled.track({ eventName: 'settings_opened', properties: {} }),
    { accepted: false, reason: 'disabled' },
  );
  const unavailable = new AnalyticsClient({
    ...options,
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
  });
  assert.deepEqual(
    await unavailable.track({ eventName: 'settings_opened', properties: {} }),
    { accepted: false, reason: 'unavailable' },
  );
  const storageUnavailable = new AnalyticsClient({
    ...options,
    storage: new FailingStorage(),
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { accepted: true } }), { status: 202 }),
  });
  assert.deepEqual(
    await storageUnavailable.track({ eventName: 'settings_opened', properties: {} }),
    { accepted: true, reason: 'accepted' },
  );
});

test('analytics client bounds batches and payloads', async () => {
  const client = new AnalyticsClient({
    ...options,
    maxBatchEvents: 1,
    maxPayloadBytes: 8,
  });
  assert.deepEqual(
    await client.trackBatch([
      { eventName: 'app_opened', properties: {} },
      { eventName: 'settings_opened', properties: {} },
    ]),
    { accepted: false, reason: 'rejected' },
  );
  assert.deepEqual(
    await client.track({ eventName: 'app_opened', properties: {} }),
    { accepted: false, reason: 'rejected' },
  );
});