import {
  createAssetIdentity,
  createTokenAssetIdentity,
  getAssetIdentityKey,
} from '@/src/core/assets';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { SwapError } from '../../errors';
import type {
  SwapAllowanceRequirement,
  SwapFeeAmount,
  SwapPriceImpact,
  SwapProviderIssue,
  SwapQuoteRequest,
  SwapRoute,
  SwapRouteHop,
} from '../../models';

export const ZEROEX_NATIVE_TOKEN =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

type RecordValue = Record<string, unknown>;

export interface ZeroExQuoteMappingOptions {
  readonly now: number;
  readonly quoteValidityMs: number;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new SwapError('SWAP_INVALID_QUOTE');
}

function requiredString(
  value: unknown,
  code:
    | 'SWAP_INVALID_QUOTE'
    | 'SWAP_INVALID_TRANSACTION_REQUEST' = 'SWAP_INVALID_QUOTE',
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SwapError(code);
  }
  return value;
}

function decimalBigint(
  value: unknown,
  code:
    | 'SWAP_INVALID_QUOTE'
    | 'SWAP_INVALID_TRANSACTION_REQUEST' = 'SWAP_INVALID_QUOTE',
): bigint {
  const text = requiredString(value, code);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new SwapError(code);
  try {
    return BigInt(text);
  } catch {
    throw new SwapError(code);
  }
}

function optionalDecimalBigint(
  value: unknown,
  code:
    | 'SWAP_INVALID_QUOTE'
    | 'SWAP_INVALID_TRANSACTION_REQUEST' = 'SWAP_INVALID_QUOTE',
): bigint | null {
  return value === null || value === undefined
    ? null
    : decimalBigint(value, code);
}

function normalizedAddress(
  value: unknown,
  code:
    | 'SWAP_INVALID_QUOTE'
    | 'SWAP_INVALID_TRANSACTION_REQUEST' = 'SWAP_INVALID_QUOTE',
): string {
  try {
    return normalizePublicEvmAddress(requiredString(value, code));
  } catch {
    throw new SwapError(code);
  }
}

function tokenToAsset(value: unknown, networkId: string) {
  const address = normalizedAddress(value);
  if (address.toLowerCase() === ZEROEX_NATIVE_TOKEN.toLowerCase()) {
    return createAssetIdentity('native', networkId, 'native');
  }
  try {
    return createTokenAssetIdentity(networkId, address);
  } catch {
    return fail();
  }
}

function feeAmount(
  value: unknown,
  networkId: string,
): SwapFeeAmount | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return fail();
  try {
    return Object.freeze({
      amount: decimalBigint(value.amount),
      asset: Object.freeze(tokenToAsset(value.token, networkId)),
    });
  } catch (error) {
    if (error instanceof SwapError) {
      throw new SwapError('SWAP_INVALID_FEE');
    }
    throw error;
  }
}

function mapPriceImpact(response: RecordValue): SwapPriceImpact {
  if (response.priceImpactBps === undefined || response.priceImpactBps === null) {
    return Object.freeze({ state: 'unavailable', reason: 'not-provided' });
  }
  const raw = response.priceImpactBps;
  const bps =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 1_000_000) {
    throw new SwapError('SWAP_INVALID_PRICE_IMPACT');
  }
  return Object.freeze({ state: 'available', bps });
}

function mapRoute(
  response: RecordValue,
  request: SwapQuoteRequest,
): SwapRoute {
  const route = response.route;
  if (!isRecord(route) || !Array.isArray(route.fills) || route.fills.length === 0) {
    return Object.freeze({
      state: 'unavailable',
      hops: Object.freeze([]) as readonly [],
      reason: 'not-provided',
    });
  }

  const hops: SwapRouteHop[] = [];
  for (const fill of route.fills) {
    if (!isRecord(fill)) return fail();
    const source = requiredString(fill.source);
    const inputAsset = tokenToAsset(fill.from, request.networkId);
    const outputAsset = tokenToAsset(fill.to, request.networkId);
    const proportionBps =
      fill.proportionBps === undefined || fill.proportionBps === null
        ? undefined
        : Number(decimalBigint(fill.proportionBps));
    if (
      proportionBps !== undefined &&
      (!Number.isSafeInteger(proportionBps) ||
        proportionBps < 0 ||
        proportionBps > 10_000)
    ) {
      return fail();
    }
    hops.push(
      Object.freeze({
        inputAsset,
        outputAsset,
        poolOrVenue: source,
        protocol: '0x',
        ...(proportionBps === undefined ? {} : { proportionBps }),
      }),
    );
  }

  if (
    getAssetIdentityKey(hops[0].inputAsset) !==
      getAssetIdentityKey(request.sellAsset) ||
    getAssetIdentityKey(hops[hops.length - 1].outputAsset) !==
      getAssetIdentityKey(request.buyAsset)
  ) {
    return Object.freeze({
      state: 'unavailable',
      hops: Object.freeze([]) as readonly [],
      reason: 'unavailable',
    });
  }
  for (let index = 1; index < hops.length; index += 1) {
    if (
      getAssetIdentityKey(hops[index - 1].outputAsset) !==
      getAssetIdentityKey(hops[index].inputAsset)
    ) {
      return Object.freeze({
        state: 'unavailable',
        hops: Object.freeze([]) as readonly [],
        reason: 'unavailable',
      });
    }
  }
  return Object.freeze({ state: 'available', hops: Object.freeze(hops) });
}

function mapAllowance(
  issues: RecordValue | null,
  request: SwapQuoteRequest,
): SwapAllowanceRequirement | null {
  const allowance = issues?.allowance;
  if (allowance === undefined || allowance === null) return null;
  if (
    request.sellAsset.assetType !== 'fungible_token' ||
    !isRecord(allowance)
  ) {
    return fail();
  }
  return Object.freeze({
    asset: Object.freeze(request.sellAsset),
    spender: normalizedAddress(allowance.spender),
    actualAmount: optionalDecimalBigint(allowance.actual),
    requiredAmount: request.sellAmount,
  });
}

function mapProviderIssues(
  issues: RecordValue | null,
): readonly SwapProviderIssue[] {
  if (issues === null) return Object.freeze([]);
  const mapped: SwapProviderIssue[] = [];
  if (issues.allowance !== undefined && issues.allowance !== null) {
    mapped.push({ code: 'allowance-required' });
  }
  if (issues.balance !== undefined && issues.balance !== null) {
    if (!isRecord(issues.balance)) return fail();
    mapped.push({ code: 'balance-insufficient' });
  }
  if (issues.simulationIncomplete !== undefined) {
    if (typeof issues.simulationIncomplete !== 'boolean') return fail();
    if (issues.simulationIncomplete) mapped.push({ code: 'simulation-incomplete' });
  }
  if (issues.invalidSourcesPassed !== undefined) {
    if (
      !Array.isArray(issues.invalidSourcesPassed) ||
      issues.invalidSourcesPassed.some((item) => typeof item !== 'string')
    ) {
      return fail();
    }
    if (issues.invalidSourcesPassed.length > 0) {
      mapped.push({ code: 'invalid-sources' });
    }
  }
  return Object.freeze(mapped.map((issue) => Object.freeze(issue)));
}

export function mapZeroExQuote(
  value: unknown,
  request: SwapQuoteRequest,
  options: ZeroExQuoteMappingOptions,
): Record<string, unknown> {
  if (!isRecord(value)) return fail();
  if (value.liquidityAvailable === false) {
    throw new SwapError('SWAP_QUOTE_UNAVAILABLE');
  }

  const chainId =
    value.chainId === undefined ? request.chainId : decimalBigint(value.chainId);
  if (chainId !== request.chainId) {
    throw new SwapError('SWAP_CHAIN_MISMATCH');
  }
  const sellAsset = tokenToAsset(value.sellToken, request.networkId);
  const buyAsset = tokenToAsset(value.buyToken, request.networkId);
  if (
    getAssetIdentityKey(sellAsset) !== getAssetIdentityKey(request.sellAsset) ||
    getAssetIdentityKey(buyAsset) !== getAssetIdentityKey(request.buyAsset)
  ) {
    throw new SwapError('SWAP_ASSET_MISMATCH');
  }
  const sellAmount = decimalBigint(value.sellAmount);
  if (sellAmount !== request.sellAmount) {
    throw new SwapError('SWAP_AMOUNT_MISMATCH');
  }

  const transaction = value.transaction;
  if (!isRecord(transaction)) {
    throw new SwapError('SWAP_INVALID_TRANSACTION_REQUEST');
  }
  const transactionFrom =
    transaction.from === undefined
      ? request.senderAddress
      : normalizedAddress(
          transaction.from,
          'SWAP_INVALID_TRANSACTION_REQUEST',
        );
  if (transactionFrom !== request.senderAddress) {
    throw new SwapError('SWAP_INVALID_TRANSACTION_REQUEST');
  }
  const fees = isRecord(value.fees) ? value.fees : null;
  const gasFee =
    feeAmount(fees?.gasFee, request.networkId) ??
    (value.totalNetworkFee === null || value.totalNetworkFee === undefined
      ? null
      : {
          amount: decimalBigint(value.totalNetworkFee),
          asset: request.sellAsset.assetType === 'native'
            ? request.sellAsset
            : createAssetIdentity('native', request.networkId, 'native'),
        });
  return {
    quoteId: requiredString(value.zid),
    providerId: '0x-swap-api-v2',
    accountId: request.accountId,
    networkId: request.networkId,
    chainId,
    sellAsset,
    buyAsset,
    sellAmount,
    expectedBuyAmount: decimalBigint(value.buyAmount),
    minimumBuyAmount: decimalBigint(value.minBuyAmount),
    slippageBps: request.slippageBps,
    route: mapRoute(value, request),
    priceImpact: mapPriceImpact(value),
    gasEstimate: optionalDecimalBigint(
      transaction.gas,
      'SWAP_INVALID_TRANSACTION_REQUEST',
    ),
    gasFee,
    protocolFee: null,
    providerFee: feeAmount(fees?.zeroExFee, request.networkId),
    integratorFee: feeAmount(fees?.integratorFee, request.networkId),
    allowanceRequirement: mapAllowance(
      isRecord(value.issues) ? value.issues : null,
      request,
    ),
    providerIssues: mapProviderIssues(
      isRecord(value.issues) ? value.issues : null,
    ),
    estimatedExecutionTime: null,
    quotedAt: options.now,
    expiresAt: options.now + options.quoteValidityMs,
    transactionRequest: {
      from: request.senderAddress,
      to: normalizedAddress(
        transaction.to,
        'SWAP_INVALID_TRANSACTION_REQUEST',
      ),
      value: decimalBigint(
        transaction.value,
        'SWAP_INVALID_TRANSACTION_REQUEST',
      ),
      data: requiredString(
        transaction.data,
        'SWAP_INVALID_TRANSACTION_REQUEST',
      ).toLowerCase(),
      gasLimit: optionalDecimalBigint(
        transaction.gas,
        'SWAP_INVALID_TRANSACTION_REQUEST',
      ),
    },
  };
}