export type AnalyticsPlatform = 'ios' | 'android' | 'web';
export type AnalyticsEnvironment = 'development' | 'testnet' | 'mainnet';
export type AnalyticsIdentityScope = 'installation' | 'session';

export type AnalyticsEvent =
  | { eventName: 'app_opened'; properties: Record<string, never> }
  | { eventName: 'onboarding_started'; properties: Record<string, never> }
  | { eventName: 'onboarding_completed'; properties: Record<string, never> }
  | { eventName: 'wallet_created_completed'; properties: Record<string, never> }
  | { eventName: 'wallet_import_completed'; properties: Record<string, never> }
  | {
      eventName: 'screen_viewed';
      properties: {
        screenCategory:
          | 'home'
          | 'activity'
          | 'asset'
          | 'receive'
          | 'send'
          | 'transaction_review'
          | 'swap_review'
          | 'swap_execution'
          | 'dapp_connection'
          | 'dapp_sessions'
          | 'settings'
          | 'onboarding';
      };
    }
  | { eventName: 'asset_search_used'; properties: Record<string, never> }
  | { eventName: 'receive_screen_opened'; properties: Record<string, never> }
  | {
      eventName: 'send_review_opened' | 'transaction_reviewed' | 'transaction_broadcast_started';
      properties: {
        transactionTypeCategory:
          | 'native_transfer'
          | 'token_transfer'
          | 'contract_interaction';
        networkCategory: 'mainnet' | 'testnet' | 'development';
      };
    }
  | {
      eventName: 'transaction_completed';
      properties: {
        transactionTypeCategory:
          | 'native_transfer'
          | 'token_transfer'
          | 'contract_interaction';
        networkCategory: 'mainnet' | 'testnet' | 'development';
        outcomeCategory: 'success' | 'failure' | 'unknown';
        durationBucket: 'under_1s' | '1_5s' | '5_30s' | 'over_30s';
      };
    }
  | {
      eventName: 'swap_review_opened';
      properties: {
        networkCategory: 'mainnet' | 'testnet' | 'development';
        providerCategory: 'aggregator' | 'router' | 'unconfigured';
      };
    }
  | {
      eventName: 'swap_completed';
      properties: {
        networkCategory: 'mainnet' | 'testnet' | 'development';
        providerCategory: 'aggregator' | 'router' | 'unconfigured';
        outcomeCategory: 'success' | 'failure' | 'unknown';
        durationBucket: 'under_1s' | '1_5s' | '5_30s' | 'over_30s';
      };
    }
  | {
      eventName: 'dapp_connection_started' | 'dapp_connection_completed';
      properties: {
        dappCategory: 'defi' | 'gaming' | 'marketplace' | 'utility' | 'other';
      };
    }
  | { eventName: 'settings_opened'; properties: Record<string, never> };

export interface AnalyticsClientOptions {
  readonly endpoint: string | null;
  readonly appVersion: string;
  readonly platform: AnalyticsPlatform;
  readonly environment: AnalyticsEnvironment;
  readonly enabled?: boolean;
  readonly maxBatchEvents?: number;
  readonly maxPayloadBytes?: number;
  readonly storage?: AnalyticsStorage;
  readonly fetchImpl?: typeof fetch;
}

export interface AnalyticsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export interface AnalyticsTrackResult {
  readonly accepted: boolean;
  readonly reason: 'accepted' | 'disabled' | 'unavailable' | 'rejected';
}