import { SwapError } from '../../errors';

export const ZEROEX_API_BASE_URL = 'https://api.0x.org';
export const DEFAULT_ZEROEX_TIMEOUT_MS = 10_000;
const MAX_ZEROEX_TIMEOUT_MS = 30_000;

export interface ZeroExHttpResponse {
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

export interface ZeroExHttpRequestInit {
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type ZeroExHttpTransport = (
  url: string,
  init: ZeroExHttpRequestInit,
) => Promise<ZeroExHttpResponse>;

export interface ZeroExQuoteQuery {
  readonly chainId: string;
  readonly buyToken: string;
  readonly sellToken: string;
  readonly sellAmount: string;
  readonly taker: string;
  readonly slippageBps: string;
}

export interface ZeroExClientOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly transport?: ZeroExHttpTransport;
}

function validateTimeout(timeoutMs: number): number {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_ZEROEX_TIMEOUT_MS
  ) {
    throw new SwapError('SWAP_PROVIDER_CONFIGURATION');
  }
  return timeoutMs;
}

async function fetchTransport(
  url: string,
  init: ZeroExHttpRequestInit,
): Promise<ZeroExHttpResponse> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    signal: init.signal,
  });
  return {
    status: response.status,
    json: () => response.json(),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export class ZeroExHttpClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly transport: ZeroExHttpTransport;

  constructor(options: ZeroExClientOptions) {
    if (typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0) {
      throw new SwapError('SWAP_PROVIDER_CONFIGURATION');
    }
    this.apiKey = options.apiKey;
    this.timeoutMs = validateTimeout(
      options.timeoutMs ?? DEFAULT_ZEROEX_TIMEOUT_MS,
    );
    this.transport = options.transport ?? fetchTransport;
  }

  async getQuote(query: ZeroExQuoteQuery): Promise<unknown> {
    const url = new URL(
      '/swap/allowance-holder/quote',
      ZEROEX_API_BASE_URL,
    );
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url.toString(), {
        method: 'GET',
        headers: {
          '0x-api-key': this.apiKey,
          '0x-version': 'v2',
        },
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new SwapError('SWAP_PROVIDER_RATE_LIMITED');
      }
      if (response.status === 408 || response.status >= 500) {
        throw new SwapError('SWAP_QUOTE_UNAVAILABLE');
      }
      if (response.status < 200 || response.status >= 300) {
        throw new SwapError('SWAP_PROVIDER_ERROR');
      }

      try {
        return await response.json();
      } catch {
        throw new SwapError('SWAP_INVALID_QUOTE');
      }
    } catch (error) {
      if (error instanceof SwapError) throw error;
      if (isAbortError(error)) {
        throw new SwapError('SWAP_QUOTE_UNAVAILABLE');
      }
      throw new SwapError('SWAP_QUOTE_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}