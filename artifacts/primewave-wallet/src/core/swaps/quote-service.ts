import type { NetworkRegistry } from '@/src/core/networks';
import { SwapError, normalizeSwapError } from './errors';
import {
  validateSwapQuoteRequest,
  validateSwapQuoteResponse,
  type ValidatedSwapQuoteRequest,
} from './validation';
import {
  type SwapQuote,
  type SwapQuoteLifecycle,
  type SwapQuoteProvider,
  type SwapQuoteRequest,
} from './models';
import { createSwapQuoteProvider } from './provider';

export interface SwapQuoteServiceOptions {
  readonly now?: () => number;
}

export class SwapQuoteService {
  private readonly provider: SwapQuoteProvider;
  private readonly now: () => number;
  private lifecycle: SwapQuoteLifecycle = Object.freeze({
    state: 'idle',
    quote: null,
    errorCode: null,
  });

  constructor(
    private readonly networkRegistry: NetworkRegistry,
    provider: SwapQuoteProvider,
    options: SwapQuoteServiceOptions = {},
  ) {
    this.provider = createSwapQuoteProvider(provider);
    this.now = options.now ?? (() => Date.now());
  }

  getLifecycle(): SwapQuoteLifecycle {
    if (
      this.lifecycle.state === 'quoted' &&
      this.lifecycle.quote !== null &&
      this.now() >= this.lifecycle.quote.expiresAt
    ) {
      return Object.freeze({
        state: 'expired',
        quote: this.lifecycle.quote,
        errorCode: null,
      });
    }
    return this.lifecycle;
  }

  clear(): void {
    this.lifecycle = Object.freeze({
      state: 'idle',
      quote: null,
      errorCode: null,
    });
  }

  isQuoteActive(quote: SwapQuote): boolean {
    return this.now() < quote.expiresAt;
  }

  async getQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    let validated: ValidatedSwapQuoteRequest;
    try {
      validated = validateSwapQuoteRequest(request, this.networkRegistry);
      if (!this.provider.metadata.supportedNetworks.includes(validated.networkId)) {
        throw new SwapError('SWAP_NETWORK_UNSUPPORTED');
      }
      this.lifecycle = Object.freeze({
        state: 'requesting',
        quote: null,
        errorCode: null,
      });

      const response = await this.provider.getQuote(validated);
      const quote = validateSwapQuoteResponse(
        response,
        validated,
        this.provider.metadata,
        this.now(),
      );
      this.lifecycle = Object.freeze({
        state: 'quoted',
        quote,
        errorCode: null,
      });
      return quote;
    } catch (error) {
      const normalized = normalizeSwapError(error);
      this.lifecycle = Object.freeze({
        state: normalized.code === 'SWAP_QUOTE_EXPIRED' ? 'expired' : 'failed',
        quote: null,
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }
}