import type { NetworkRegistry } from '@/src/core/networks';
import { SwapError } from '../../errors';
import {
  createSwapQuoteProvider,
  validateSwapQuoteProviderMetadata,
} from '../../provider';
import type {
  SwapQuoteProvider,
  SwapQuoteRequest,
} from '../../models';
import {
  DEFAULT_ZEROEX_TIMEOUT_MS,
  ZeroExHttpClient,
  type ZeroExHttpTransport,
} from './zeroex-client';
import {
  mapZeroExQuote,
  ZEROEX_NATIVE_TOKEN,
} from './zeroex-mapper';

export const ZEROEX_NETWORK_CHAIN_IDS = Object.freeze({
  ethereum: 1,
  'bnb-smart-chain': 56,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
} as const);

export const ZEROEX_SUPPORTED_NETWORKS = Object.freeze(
  Object.keys(ZEROEX_NETWORK_CHAIN_IDS),
);

const ZEROEX_PROVIDER_ID = '0x-swap-api-v2';
const DEFAULT_QUOTE_VALIDITY_MS = 30_000;
const MAX_QUOTE_VALIDITY_MS = 120_000;

export interface ZeroExSwapQuoteProviderOptions {
  readonly apiKey?: string;
  readonly client?: ZeroExHttpClient;
  readonly transport?: ZeroExHttpTransport;
  readonly timeoutMs?: number;
  readonly quoteValidityMs?: number;
  readonly now?: () => number;
  readonly networkRegistry?: NetworkRegistry;
}

function environmentApiKey(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env.ZEROEX_API_KEY;
}

function validateQuoteValidity(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_QUOTE_VALIDITY_MS
  ) {
    throw new SwapError('SWAP_PROVIDER_CONFIGURATION');
  }
  return value;
}

function createClient(options: ZeroExSwapQuoteProviderOptions): ZeroExHttpClient {
  return (
    options.client ??
    new ZeroExHttpClient({
      apiKey: options.apiKey ?? environmentApiKey() ?? '',
      timeoutMs: options.timeoutMs ?? DEFAULT_ZEROEX_TIMEOUT_MS,
      transport: options.transport,
    })
  );
}

export function createZeroExSwapQuoteProvider(
  options: ZeroExSwapQuoteProviderOptions = {},
): SwapQuoteProvider {
  const client = createClient(options);
  const quoteValidityMs = validateQuoteValidity(
    options.quoteValidityMs ?? DEFAULT_QUOTE_VALIDITY_MS,
  );
  const now = options.now ?? (() => Date.now());
  const metadata = validateSwapQuoteProviderMetadata({
    providerId: ZEROEX_PROVIDER_ID,
    displayName: '0x Swap API v2',
    supportedNetworks: ZEROEX_SUPPORTED_NETWORKS,
    supportedCapabilities: [
      'exact-input',
      'multi-hop-route',
      'transaction-request',
    ],
  });

  return createSwapQuoteProvider({
    metadata,
    getQuote: async (request: SwapQuoteRequest) => {
      const expectedChainId =
        ZEROEX_NETWORK_CHAIN_IDS[
          request.networkId as keyof typeof ZEROEX_NETWORK_CHAIN_IDS
        ];
      if (expectedChainId === undefined) {
        throw new SwapError('SWAP_NETWORK_UNSUPPORTED');
      }
      if (BigInt(expectedChainId) !== request.chainId) {
        throw new SwapError('SWAP_CHAIN_MISMATCH');
      }
      if (options.networkRegistry) {
        const network = options.networkRegistry.getById(request.networkId);
        if (
          !network ||
          !network.enabled ||
          network.configurationStatus !== 'configured' ||
          network.chainId === null
        ) {
          throw new SwapError('SWAP_NETWORK_NOT_CONFIGURED');
        }
        if (network.chainId !== expectedChainId) {
          throw new SwapError('SWAP_CHAIN_MISMATCH');
        }
      }
      const response = await client.getQuote({
        chainId: request.chainId.toString(10),
        buyToken:
          request.buyAsset.assetType === 'native'
            ? ZEROEX_NATIVE_TOKEN
            : request.buyAsset.assetId,
        sellToken:
          request.sellAsset.assetType === 'native'
            ? ZEROEX_NATIVE_TOKEN
            : request.sellAsset.assetId,
        sellAmount: request.sellAmount.toString(10),
        taker: request.senderAddress,
        slippageBps: request.slippageBps.toString(10),
      });
      return mapZeroExQuote(response, request, {
        now: now(),
        quoteValidityMs,
      });
    },
  });
}