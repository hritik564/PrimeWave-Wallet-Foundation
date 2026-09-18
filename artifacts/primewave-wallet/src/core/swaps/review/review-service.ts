import { keccak256, stringToHex } from 'viem';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { getAssetIdentityKey, type AssetIdentity } from '@/src/core/assets';
import type { PortfolioAssetViewModel } from '@/src/core/portfolio';
import type { SwapQuote } from '../models';
import { SwapReviewError } from './errors';
import {
  assetSnapshot,
  DEFAULT_SWAP_REVIEW_MAX_PORTFOLIO_AGE_MS,
  type SwapReviewApproval,
  type SwapReviewBlocker,
  type SwapReviewContext,
  type SwapReviewInput,
  type SwapReviewServiceOptions,
  type SwapReviewSnapshot,
} from './models';
import type { NetworkRegistry } from '@/src/core/networks';

const MAX_CALLDATA_BYTES = 128 * 1024;
const BLOCKING_PROVIDER_ISSUES = new Set(['balance-insufficient', 'simulation-incomplete', 'invalid-sources']);

function fail(code: ConstructorParameters<typeof SwapReviewError>[0]): never {
  throw new SwapReviewError(code);
}

function normalizeAddress(value: string, code: ConstructorParameters<typeof SwapReviewError>[0]): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    return fail(code);
  }
}

function assertAssetMatches(
  asset: PortfolioAssetViewModel | null,
  expected: AssetIdentity,
): asserts asset is PortfolioAssetViewModel {
  if (
    !asset ||
    asset.networkId !== expected.networkId ||
    getAssetIdentityKey(asset.identity) !== getAssetIdentityKey(expected) ||
    asset.identity.assetType !== 'native' && asset.identity.assetType !== 'fungible_token' ||
    asset.availabilityState !== 'available' ||
    asset.decimals === null
  ) {
    fail('SWAP_REVIEW_ASSET_MISMATCH');
  }
  if (
    asset.assetType === 'native' &&
    (asset.contractAddress !== null || asset.identity.assetId !== 'native')
  ) {
    fail('SWAP_REVIEW_ASSET_MISMATCH');
  }
  if (
    asset.assetType === 'fungible_token' &&
    asset.contractAddress === null
  ) {
    fail('SWAP_REVIEW_ASSET_MISMATCH');
  }
}

function assertNetwork(input: SwapReviewInput, networkRegistry: NetworkRegistry): void {
  const { quote, network, registeredNetwork, activeNetworkId } = input;
  if (!network || !registeredNetwork) fail('SWAP_REVIEW_NETWORK_MISMATCH');
  const registryNetwork = networkRegistry.getById(network.id);
  if (
    !registryNetwork ||
    registryNetwork.id !== registeredNetwork.id ||
    registeredNetwork.id !== network.id ||
    activeNetworkId !== network.id ||
    !network.enabled ||
    network.configurationStatus !== 'configured' ||
    network.chainId === null
  ) {
    fail('SWAP_REVIEW_NETWORK_MISMATCH');
  }
  if (quote.networkId !== network.id) fail('SWAP_REVIEW_NETWORK_MISMATCH');
  if (quote.chainId !== BigInt(network.chainId)) fail('SWAP_REVIEW_CHAIN_MISMATCH');
}

function assertQuoteContext(input: SwapReviewInput, now: number): void {
  const { quote, account, sellAsset, buyAsset } = input;
  if (input.quoteLifecycleState !== 'quoted') {
    if (input.quoteLifecycleState === 'expired' || now >= quote.expiresAt) {
      fail('SWAP_REVIEW_QUOTE_EXPIRED');
    }
    fail('SWAP_REVIEW_QUOTE_STALE');
  }
  if (now >= quote.expiresAt) fail('SWAP_REVIEW_QUOTE_EXPIRED');
  if (quote.accountId !== account.accountId) fail('SWAP_REVIEW_ACCOUNT_MISMATCH');
  const sender = normalizeAddress(account.address, 'SWAP_REVIEW_SENDER_MISMATCH');
  if (normalizeAddress(quote.transactionRequest.from, 'SWAP_REVIEW_SENDER_MISMATCH') !== sender) {
    fail('SWAP_REVIEW_SENDER_MISMATCH');
  }
  if (!sellAsset || !buyAsset) fail('SWAP_REVIEW_ASSET_MISMATCH');
  if (getAssetIdentityKey(quote.sellAsset) !== getAssetIdentityKey(sellAsset.identity)) {
    fail('SWAP_REVIEW_ASSET_MISMATCH');
  }
  if (getAssetIdentityKey(quote.buyAsset) !== getAssetIdentityKey(buyAsset.identity)) {
    fail('SWAP_REVIEW_ASSET_MISMATCH');
  }
  if (quote.sellAmount <= 0n) fail('SWAP_REVIEW_AMOUNT_MISMATCH');
  if (!Number.isSafeInteger(quote.slippageBps) || quote.slippageBps < 0 || quote.slippageBps > 5000) {
    fail('SWAP_REVIEW_SLIPPAGE_MISMATCH');
  }
}

function assertTransactionRequest(input: SwapReviewInput): void {
  const sender = normalizeAddress(input.account.address, 'SWAP_REVIEW_SENDER_MISMATCH');
  const transaction = input.quote.transactionRequest;
  if (normalizeAddress(transaction.from, 'SWAP_REVIEW_TRANSACTION_INVALID') !== sender) {
    fail('SWAP_REVIEW_SENDER_MISMATCH');
  }
  try {
    normalizePublicEvmAddress(transaction.to);
  } catch {
    fail('SWAP_REVIEW_TRANSACTION_TARGET_INVALID');
  }
  if (
    typeof transaction.data !== 'string' ||
    !/^0x[0-9a-f]*$/i.test(transaction.data) ||
    (transaction.data.length - 2) % 2 !== 0 ||
    (transaction.data.length - 2) / 2 > MAX_CALLDATA_BYTES
  ) {
    fail('SWAP_REVIEW_CALLDATA_INVALID');
  }
  if (typeof transaction.value !== 'bigint' || transaction.value < 0n) {
    fail('SWAP_REVIEW_TRANSACTION_INVALID');
  }
}

function assertFeeContext(input: SwapReviewInput): void {
  const fees = [
    input.quote.gasFee,
    input.quote.protocolFee,
    input.quote.providerFee,
    input.quote.integratorFee,
  ];
  for (const fee of fees) {
    if (!fee) continue;
    if (
      fee.amount < 0n ||
      fee.asset.networkId !== input.quote.networkId ||
      (fee.asset.assetType !== 'native' && fee.asset.assetType !== 'fungible_token')
    ) {
      fail('SWAP_REVIEW_TRANSACTION_INVALID');
    }
  }
  const allowance = input.quote.allowanceRequirement;
  if (!allowance) return;
  if (
    getAssetIdentityKey(allowance.asset) !== getAssetIdentityKey(input.quote.sellAsset) ||
    allowance.requiredAmount <= 0n ||
    (allowance.actualAmount !== null && allowance.actualAmount < 0n)
  ) {
    fail('SWAP_REVIEW_ALLOWANCE_UNSUPPORTED');
  }
  try {
    normalizePublicEvmAddress(allowance.spender);
  } catch {
    fail('SWAP_REVIEW_ALLOWANCE_UNSUPPORTED');
  }
}

function portfolioAsset(
  input: SwapReviewInput,
  identity: AssetIdentity,
): PortfolioAssetViewModel {
  const asset = input.portfolio?.assets.find(
    (candidate) => getAssetIdentityKey(candidate.identity) === getAssetIdentityKey(identity),
  );
  if (!asset) fail('SWAP_REVIEW_BALANCE_UNAVAILABLE');
  return asset;
}

function assertPortfolio(input: SwapReviewInput, now: number, maxPortfolioAgeMs: number): {
  readonly sellAsset: PortfolioAssetViewModel;
  readonly buyAsset: PortfolioAssetViewModel;
} {
  const portfolio = input.portfolio;
  if (
    !portfolio ||
    portfolio.accountId !== input.account.accountId ||
    portfolio.networkId !== input.network?.id ||
    portfolio.chainId !== input.network?.chainId
  ) {
    fail('SWAP_REVIEW_BALANCE_UNAVAILABLE');
  }
  if (portfolio.state === 'unavailable' || portfolio.state === 'invalid') {
    fail('SWAP_REVIEW_BALANCE_UNAVAILABLE');
  }
  if (
    !Number.isSafeInteger(portfolio.generatedAt) ||
    portfolio.generatedAt > now ||
    now - portfolio.generatedAt > maxPortfolioAgeMs
  ) {
    fail('SWAP_REVIEW_PORTFOLIO_STALE');
  }
  const sellAsset = portfolioAsset(input, input.quote.sellAsset);
  const buyAsset = portfolioAsset(input, input.quote.buyAsset);
  assertAssetMatches(sellAsset, input.quote.sellAsset);
  assertAssetMatches(buyAsset, input.quote.buyAsset);
  return { sellAsset, buyAsset };
}

function feeIsNativeNetworkFee(input: SwapReviewInput): boolean {
  const fee = input.quote.gasFee;
  return fee !== null &&
    fee.asset.assetType === 'native' &&
    fee.asset.networkId === input.network?.id &&
    fee.asset.assetId === 'native';
}

function blocker(code: SwapReviewBlocker['code']): SwapReviewBlocker {
  const message = new SwapReviewError(code).message;
  return Object.freeze({ code, message });
}

function approvalBlockers(
  input: SwapReviewInput,
  sellAsset: PortfolioAssetViewModel,
): readonly SwapReviewBlocker[] {
  const blockers: SwapReviewBlocker[] = [];
  const quote = input.quote;
  if (!feeIsNativeNetworkFee(input)) {
    blockers.push(blocker('SWAP_REVIEW_FEE_UNAVAILABLE'));
  }
  if (sellAsset.rawBalance === null || sellAsset.balanceState === 'unavailable') {
    blockers.push(blocker('SWAP_REVIEW_BALANCE_UNAVAILABLE'));
  } else if (sellAsset.assetType === 'native') {
    const total = quote.sellAmount + (quote.gasFee?.amount ?? 0n);
    if (sellAsset.rawBalance < total) blockers.push(blocker('SWAP_REVIEW_INSUFFICIENT_BALANCE'));
  } else if (sellAsset.rawBalance < quote.sellAmount) {
    blockers.push(blocker('SWAP_REVIEW_INSUFFICIENT_BALANCE'));
  }
  for (const issue of quote.providerIssues) {
    if (BLOCKING_PROVIDER_ISSUES.has(issue.code)) {
      blockers.push(blocker('SWAP_REVIEW_PROVIDER_ISSUE'));
    }
  }
  return Object.freeze([...new Map(blockers.map((item) => [item.code, item])).values()]);
}

function serializable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  }
  return value;
}

function bindingContext(snapshot: SwapReviewSnapshot): SwapReviewContext {
  return {
    quoteId: snapshot.quoteId,
    providerId: snapshot.providerId,
    accountId: snapshot.accountId,
    senderAddress: snapshot.senderAddress,
    networkId: snapshot.networkId,
    chainId: snapshot.chainId,
    sellAsset: snapshot.sellAsset,
    buyAsset: snapshot.buyAsset,
    sellAmount: snapshot.sellAmount,
    expectedBuyAmount: snapshot.expectedBuyAmount,
    minimumBuyAmount: snapshot.minimumBuyAmount,
    slippageBps: snapshot.slippageBps,
    route: snapshot.route,
    priceImpact: snapshot.priceImpact,
    gasEstimate: snapshot.gasEstimate,
    gasFee: snapshot.gasFee,
    protocolFee: snapshot.protocolFee,
    providerFee: snapshot.providerFee,
    integratorFee: snapshot.integratorFee,
    allowanceRequirement: snapshot.allowanceRequirement,
    providerIssues: snapshot.providerIssues,
    transactionRequest: snapshot.transactionRequest,
  };
}

function reviewDigest(context: SwapReviewContext): `0x${string}` {
  const canonical = JSON.stringify(serializable(context));
  return keccak256(stringToHex(canonical));
}

export class SwapReviewService {
  private readonly now: () => number;
  private readonly maxPortfolioAgeMs: number;

  constructor(
    private readonly networkRegistry: NetworkRegistry,
    options: SwapReviewServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.maxPortfolioAgeMs = options.maxPortfolioAgeMs ?? DEFAULT_SWAP_REVIEW_MAX_PORTFOLIO_AGE_MS;
  }

  createReview(input: SwapReviewInput): SwapReviewSnapshot {
    const now = this.now();
    assertNetwork(input, this.networkRegistry);
    assertQuoteContext(input, now);
    assertTransactionRequest(input);
    assertFeeContext(input);
    const { sellAsset, buyAsset } = assertPortfolio(input, now, this.maxPortfolioAgeMs);
    const blockers = approvalBlockers(input, sellAsset);
    const sellDecimals = sellAsset.decimals;
    const buyDecimals = buyAsset.decimals;
    if (sellDecimals === null || buyDecimals === null) fail('SWAP_REVIEW_ASSET_MISMATCH');
    const snapshot = {
      status: 'ready' as const,
      createdAt: now,
      quoteId: input.quote.quoteId,
      providerId: input.quote.providerId,
      accountId: input.account.accountId,
      senderAddress: normalizeAddress(input.account.address, 'SWAP_REVIEW_SENDER_MISMATCH'),
      networkId: input.network?.id as string,
      chainId: input.quote.chainId,
      sellAsset: assetSnapshot(sellAsset),
      buyAsset: assetSnapshot(buyAsset),
      sellAmount: input.quote.sellAmount,
      sellAmountDisplay: formatAmount(input.quote.sellAmount, sellDecimals),
      expectedBuyAmount: input.quote.expectedBuyAmount,
      expectedBuyAmountDisplay: formatAmount(input.quote.expectedBuyAmount, buyDecimals),
      minimumBuyAmount: input.quote.minimumBuyAmount,
      minimumBuyAmountDisplay: formatAmount(input.quote.minimumBuyAmount, buyDecimals),
      slippageBps: input.quote.slippageBps,
      route: input.quote.route,
      priceImpact: input.quote.priceImpact,
      gasEstimate: input.quote.gasEstimate,
      gasFee: input.quote.gasFee,
      protocolFee: input.quote.protocolFee,
      providerFee: input.quote.providerFee,
      integratorFee: input.quote.integratorFee,
      allowanceRequirement: input.quote.allowanceRequirement,
      providerIssues: input.quote.providerIssues,
      transactionRequest: input.quote.transactionRequest,
      portfolioGeneratedAt: input.portfolio?.generatedAt ?? 0,
      approvalRequired: input.quote.allowanceRequirement !== null,
      blockers,
      canApprove: blockers.length === 0,
      reviewDigest: '0x' as `0x${string}`,
    };
    const digest = reviewDigest(bindingContext(snapshot as SwapReviewSnapshot));
    return Object.freeze({ ...snapshot, reviewDigest: digest });
  }

  approveReview(input: {
    readonly review: SwapReviewSnapshot;
    readonly current: SwapReviewInput;
  }): SwapReviewApproval {
    const current = this.createReview(input.current);
    if (current.reviewDigest !== input.review.reviewDigest) {
      fail('SWAP_REVIEW_QUOTE_STALE');
    }
    if (!current.canApprove) {
      const first = current.blockers[0];
      if (first) fail(first.code);
      fail('SWAP_REVIEW_PROVIDER_ISSUE');
    }
    return Object.freeze({
      status: 'approved-for-signing',
      approvedAt: this.now(),
      reviewDigest: input.review.reviewDigest,
      quoteId: current.quoteId,
      providerId: current.providerId,
      accountId: current.accountId,
      senderAddress: current.senderAddress,
      networkId: current.networkId,
      chainId: current.chainId,
      sellAsset: current.sellAsset.identity,
      buyAsset: current.buyAsset.identity,
      sellAmount: current.sellAmount,
      expectedBuyAmount: current.expectedBuyAmount,
      minimumBuyAmount: current.minimumBuyAmount,
      slippageBps: current.slippageBps,
      transactionRequest: current.transactionRequest,
    });
  }
}

export function formatAmount(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  if (decimals === 0) return whole.toString();
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}