import { createAssetIdentity, createTokenAssetIdentity, getAssetIdentityKey } from '@/src/core/assets';
import type { AssetIdentity } from '@/src/core/assets';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type { NetworkRegistry } from '@/src/core/networks';
import type {
  SwapFeeAmount,
  SwapPriceImpact,
  SwapQuote,
  SwapQuoteProviderMetadata,
  SwapQuoteRequest,
  SwapRoute,
  SwapRouteHop,
  SwapTransactionRequest,
} from './models';
import { SwapError, type SwapErrorCode } from './errors';

export const MAX_SWAP_SLIPPAGE_BPS = 5000;

export interface ValidatedSwapQuoteRequest extends SwapQuoteRequest {
  readonly senderAddress: string;
  readonly sellAsset: AssetIdentity;
  readonly buyAsset: AssetIdentity;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: SwapErrorCode): never {
  throw new SwapError(code);
}

function nonEmptyString(value: unknown, code: SwapErrorCode): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fail(code);
  return value;
}

function exactNonNegativeBigint(
  value: unknown,
  code: SwapErrorCode,
): bigint {
  if (typeof value !== 'bigint' || value < 0n) return fail(code);
  return value;
}

function exactTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('SWAP_INVALID_QUOTE');
  }
  return value as number;
}

function normalizeAddressOrFail(
  value: unknown,
  code: 'SWAP_SENDER_INVALID' | 'SWAP_INVALID_TRANSACTION_REQUEST',
): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    return fail(code);
  }
}

function normalizeChainId(value: unknown): bigint {
  return exactNonNegativeBigint(value, 'SWAP_CHAIN_MISMATCH');
}

function parseAssetIdentity(
  value: unknown,
  expectedNetworkId?: string,
): AssetIdentity {
  if (!isRecord(value)) return fail('SWAP_ASSET_INVALID');
  const assetType = value.assetType;
  const networkId = nonEmptyString(value.networkId, 'SWAP_ASSET_INVALID');
  if (expectedNetworkId !== undefined && networkId !== expectedNetworkId) {
    return fail('SWAP_ASSET_MISMATCH');
  }

  if (assetType === 'native') {
    if (
      value.assetId !== 'native' ||
      (value.contractAddress !== undefined && value.contractAddress !== null)
    ) {
      return fail('SWAP_ASSET_INVALID');
    }
    return createAssetIdentity('native', networkId, 'native');
  }

  if (assetType === 'fungible_token') {
    const assetId = value.assetId;
    const contractAddress = value.contractAddress ?? assetId;
    if (typeof assetId !== 'string' || typeof contractAddress !== 'string') {
      return fail('SWAP_ASSET_INVALID');
    }
    try {
      const normalized = createTokenAssetIdentity(networkId, contractAddress);
      if (assetId !== contractAddress) {
        const normalizedAssetId = normalizePublicEvmAddress(assetId);
        if (normalizedAssetId !== normalized.assetId) {
          return fail('SWAP_ASSET_INVALID');
        }
      }
      return normalized;
    } catch {
      return fail('SWAP_ASSET_INVALID');
    }
  }

  if (assetType === 'nft') return fail('SWAP_ASSET_UNSUPPORTED');
  return fail('SWAP_ASSET_INVALID');
}

function validateNetwork(
  registry: NetworkRegistry,
  networkId: string,
  chainId: bigint,
): void {
  const network = registry.getById(networkId);
  if (!network) fail('SWAP_NETWORK_UNSUPPORTED');
  if (!network.enabled) fail('SWAP_NETWORK_DISABLED');
  if (network.configurationStatus !== 'configured' || network.chainId === null) {
    fail('SWAP_NETWORK_NOT_CONFIGURED');
  }
  if (BigInt(network.chainId) !== chainId) fail('SWAP_CHAIN_MISMATCH');
}

function validateSlippage(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('SWAP_INVALID_SLIPPAGE');
  }
  if ((value as number) > MAX_SWAP_SLIPPAGE_BPS) {
    return fail('SWAP_EXCESSIVE_SLIPPAGE');
  }
  return value as number;
}

export function validateSwapQuoteRequest(
  request: unknown,
  networkRegistry: NetworkRegistry,
): ValidatedSwapQuoteRequest {
  if (!isRecord(request)) return fail('SWAP_INVALID_REQUEST');

  const accountId = nonEmptyString(request.accountId, 'SWAP_ACCOUNT_INVALID');
  const networkId = nonEmptyString(
    request.networkId,
    'SWAP_NETWORK_UNSUPPORTED',
  );
  const chainId = normalizeChainId(request.chainId);
  validateNetwork(networkRegistry, networkId, chainId);

  const senderAddress = normalizeAddressOrFail(
    request.senderAddress,
    'SWAP_SENDER_INVALID',
  );
  const sellAsset = parseAssetIdentity(request.sellAsset);
  const buyAsset = parseAssetIdentity(request.buyAsset);

  if (sellAsset.networkId !== buyAsset.networkId) {
    return fail('SWAP_CROSS_CHAIN_UNSUPPORTED');
  }
  if (
    sellAsset.networkId !== networkId ||
    buyAsset.networkId !== networkId
  ) {
    return fail('SWAP_ASSET_MISMATCH');
  }
  if (getAssetIdentityKey(sellAsset) === getAssetIdentityKey(buyAsset)) {
    return fail('SWAP_SAME_ASSET');
  }

  const sellAmount = exactNonNegativeBigint(
    request.sellAmount,
    'SWAP_INVALID_AMOUNT',
  );
  if (sellAmount === 0n) fail('SWAP_INVALID_AMOUNT');

  const slippageBps = validateSlippage(request.slippageBps);
  return Object.freeze({
    accountId,
    senderAddress,
    networkId,
    chainId,
    sellAsset: Object.freeze(sellAsset),
    buyAsset: Object.freeze(buyAsset),
    sellAmount,
    slippageBps,
  });
}

function normalizeProviderAsset(value: unknown): AssetIdentity {
  return parseAssetIdentity(value);
}

function normalizeRoute(
  value: unknown,
  request: ValidatedSwapQuoteRequest,
): SwapRoute {
  if (!isRecord(value) || !Array.isArray(value.hops) || value.hops.length === 0) {
    return fail('SWAP_INVALID_ROUTE');
  }
  const hops: SwapRouteHop[] = [];
  for (const rawHop of value.hops) {
    if (!isRecord(rawHop)) return fail('SWAP_INVALID_ROUTE');
    const inputAsset = normalizeProviderAsset(rawHop.inputAsset);
    const outputAsset = normalizeProviderAsset(rawHop.outputAsset);
    if (
      inputAsset.networkId !== request.networkId ||
      outputAsset.networkId !== request.networkId
    ) {
      return fail('SWAP_INVALID_ROUTE');
    }
    hops.push(
      Object.freeze({
        inputAsset,
        outputAsset,
        poolOrVenue: nonEmptyString(rawHop.poolOrVenue, 'SWAP_INVALID_ROUTE'),
        protocol: nonEmptyString(rawHop.protocol, 'SWAP_INVALID_ROUTE'),
      }),
    );
  }
  if (
    getAssetIdentityKey(hops[0].inputAsset) !==
      getAssetIdentityKey(request.sellAsset) ||
    getAssetIdentityKey(hops[hops.length - 1].outputAsset) !==
      getAssetIdentityKey(request.buyAsset)
  ) {
    return fail('SWAP_INVALID_ROUTE');
  }
  return Object.freeze({ hops: Object.freeze(hops) });
}

function normalizePriceImpact(value: unknown): SwapPriceImpact {
  if (!isRecord(value)) return fail('SWAP_INVALID_PRICE_IMPACT');
  if (value.state === 'unavailable') {
    if (value.reason !== 'not-provided' && value.reason !== 'unavailable') {
      return fail('SWAP_INVALID_PRICE_IMPACT');
    }
    return Object.freeze({
      state: 'unavailable' as const,
      reason: value.reason,
    });
  }
  if (
    value.state !== 'available' ||
    !Number.isSafeInteger(value.bps) ||
    (value.bps as number) < 0 ||
    (value.bps as number) > 1_000_000
  ) {
    return fail('SWAP_INVALID_PRICE_IMPACT');
  }
  return Object.freeze({ state: 'available' as const, bps: value.bps as number });
}

function normalizeFee(
  value: unknown,
  request: ValidatedSwapQuoteRequest,
): SwapFeeAmount | null {
  if (value === null) return null;
  if (!isRecord(value)) return fail('SWAP_INVALID_FEE');
  const asset = normalizeProviderAsset(value.asset);
  if (asset.networkId !== request.networkId) return fail('SWAP_INVALID_FEE');
  return Object.freeze({
    amount: exactNonNegativeBigint(value.amount, 'SWAP_INVALID_FEE'),
    asset: Object.freeze(asset),
  });
}

function normalizeTransactionRequest(
  value: unknown,
  request: ValidatedSwapQuoteRequest,
): SwapTransactionRequest {
  if (!isRecord(value)) return fail('SWAP_INVALID_TRANSACTION_REQUEST');
  const from = normalizeAddressOrFail(
    value.from,
    'SWAP_INVALID_TRANSACTION_REQUEST',
  );
  const to = normalizeAddressOrFail(
    value.to,
    'SWAP_INVALID_TRANSACTION_REQUEST',
  );
  if (from !== request.senderAddress) {
    return fail('SWAP_INVALID_TRANSACTION_REQUEST');
  }
  if (
    typeof value.data !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(value.data) ||
    (value.data.length - 2) % 2 !== 0
  ) {
    return fail('SWAP_INVALID_TRANSACTION_REQUEST');
  }
  const gasLimit =
    value.gasLimit === null || value.gasLimit === undefined
      ? null
      : exactNonNegativeBigint(
          value.gasLimit,
          'SWAP_INVALID_TRANSACTION_REQUEST',
        );
  if (gasLimit === 0n) return fail('SWAP_INVALID_TRANSACTION_REQUEST');
  return Object.freeze({
    from,
    to,
    value: exactNonNegativeBigint(
      value.value,
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ),
    data: value.data.toLowerCase() as `0x${string}`,
    gasLimit,
  });
}

function validateProviderMetadata(
  metadata: SwapQuoteProviderMetadata,
): void {
  nonEmptyString(metadata.providerId, 'SWAP_PROVIDER_ID_MISMATCH');
  nonEmptyString(metadata.displayName, 'SWAP_PROVIDER_ERROR');
  if (
    !Array.isArray(metadata.supportedNetworks) ||
    metadata.supportedNetworks.length === 0 ||
    metadata.supportedNetworks.some(
      (networkId) => typeof networkId !== 'string' || networkId.trim().length === 0,
    )
  ) {
    fail('SWAP_PROVIDER_ERROR');
  }
}

export function validateSwapQuoteResponse(
  response: unknown,
  request: ValidatedSwapQuoteRequest,
  providerMetadata: SwapQuoteProviderMetadata,
  now = Date.now(),
): SwapQuote {
  validateProviderMetadata(providerMetadata);
  if (!providerMetadata.supportedNetworks.includes(request.networkId)) {
    return fail('SWAP_NETWORK_UNSUPPORTED');
  }
  if (!isRecord(response)) return fail('SWAP_INVALID_QUOTE');

  const quoteId = nonEmptyString(response.quoteId, 'SWAP_INVALID_QUOTE');
  const providerId = nonEmptyString(
    response.providerId,
    'SWAP_PROVIDER_ID_MISMATCH',
  );
  if (providerId !== providerMetadata.providerId) {
    return fail('SWAP_PROVIDER_ID_MISMATCH');
  }
  if (response.accountId !== request.accountId) {
    return fail('SWAP_INVALID_QUOTE');
  }
  if (response.networkId !== request.networkId) {
    return fail('SWAP_NETWORK_MISMATCH');
  }
  const chainId = normalizeChainId(response.chainId);
  if (chainId !== request.chainId) return fail('SWAP_CHAIN_MISMATCH');

  const sellAsset = normalizeProviderAsset(response.sellAsset);
  const buyAsset = normalizeProviderAsset(response.buyAsset);
  if (
    getAssetIdentityKey(sellAsset) !== getAssetIdentityKey(request.sellAsset) ||
    getAssetIdentityKey(buyAsset) !== getAssetIdentityKey(request.buyAsset)
  ) {
    return fail('SWAP_ASSET_MISMATCH');
  }

  const sellAmount = exactNonNegativeBigint(
    response.sellAmount,
    'SWAP_AMOUNT_MISMATCH',
  );
  if (sellAmount !== request.sellAmount) return fail('SWAP_AMOUNT_MISMATCH');
  const expectedBuyAmount = exactNonNegativeBigint(
    response.expectedBuyAmount,
    'SWAP_INVALID_QUOTE',
  );
  const minimumBuyAmount = exactNonNegativeBigint(
    response.minimumBuyAmount,
    'SWAP_INVALID_QUOTE',
  );
  if (expectedBuyAmount === 0n || minimumBuyAmount > expectedBuyAmount) {
    return fail('SWAP_INVALID_QUOTE');
  }
  const slippageBps = validateSlippage(response.slippageBps);
  if (slippageBps !== request.slippageBps) {
    return fail('SWAP_INVALID_QUOTE');
  }

  const quotedAt = exactTimestamp(response.quotedAt);
  const expiresAt = exactTimestamp(response.expiresAt);
  if (expiresAt <= quotedAt) return fail('SWAP_INVALID_QUOTE');
  if (now >= expiresAt) return fail('SWAP_QUOTE_EXPIRED');

  const gasEstimate =
    response.gasEstimate === null
      ? null
      : exactNonNegativeBigint(response.gasEstimate, 'SWAP_INVALID_QUOTE');
  const estimatedExecutionTime =
    response.estimatedExecutionTime === null
      ? null
      : exactTimestamp(response.estimatedExecutionTime);

  return Object.freeze({
    quoteId,
    providerId,
    accountId: request.accountId,
    networkId: request.networkId,
    chainId,
    sellAsset: Object.freeze(sellAsset),
    buyAsset: Object.freeze(buyAsset),
    sellAmount,
    expectedBuyAmount,
    minimumBuyAmount,
    slippageBps,
    route: normalizeRoute(response.route, request),
    priceImpact: normalizePriceImpact(response.priceImpact),
    gasEstimate,
    gasFee: normalizeFee(response.gasFee, request),
    protocolFee: normalizeFee(response.protocolFee, request),
    providerFee: normalizeFee(response.providerFee, request),
    estimatedExecutionTime,
    quotedAt,
    expiresAt,
    transactionRequest: normalizeTransactionRequest(
      response.transactionRequest,
      request,
    ),
  });
}