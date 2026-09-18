import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssetIcon } from '@/src/core/portfolio';
import {
  createTokenAssetIdentity,
  type AssetIdentity,
  type TokenMetadataStatus,
  type TokenProvenance,
  type TokenVerificationStatus,
} from '@/src/core/assets';
import {
  defaultNetworkRegistry,
  supportedNetworks,
  type EvmNetwork,
  NetworkRegistry,
} from '@/src/core/networks';
import type {
  PortfolioAssetViewModel,
  PortfolioReadModel,
} from '@/src/core/portfolio';
import {
  SwapReviewError,
  SwapReviewService,
  type SwapQuote,
  type SwapReviewInput,
} from '../../index';

const NOW = 2_000_000_000_000;
const sender = '0x1111111111111111111111111111111111111111';
const router = '0x2222222222222222222222222222222222222222';
const native: AssetIdentity = { assetType: 'native', networkId: 'ethereum', assetId: 'native' };
const token = createTokenAssetIdentity('ethereum', '0x3333333333333333333333333333333333333333');
const network = supportedNetworks.find((candidate) => candidate.id === 'ethereum') as EvmNetwork;

function registry(): NetworkRegistry {
  const next = new NetworkRegistry(supportedNetworks);
  next.selectActiveNetwork('ethereum');
  return next;
}

function asset(
  identity: AssetIdentity,
  overrides: Partial<PortfolioAssetViewModel> = {},
): PortfolioAssetViewModel {
  const isNative = identity.assetType === 'native';
  const symbol = isNative ? 'ETH' : 'TKN';
  return {
    identity,
    assetType: identity.assetType,
    networkId: identity.networkId,
    contractAddress: isNative ? null : identity.assetId,
    symbol,
    name: isNative ? 'Ether' : 'Test Token',
    decimals: isNative ? 18 : 6,
    rawBalance: isNative ? 3_000_000_000_000_000_000n : 10_000_000n,
    formattedBalance: isNative ? '3' : '10',
    visibility: 'visible',
    verificationStatus: 'verified' as TokenVerificationStatus,
    metadataStatus: 'complete' as TokenMetadataStatus,
    provenance: (isNative ? ['registry'] : ['user_added']) as readonly TokenProvenance[],
    icon: createAssetIcon(identity, isNative ? 'Ether' : 'Test Token', symbol),
    balanceState: 'positive',
    availabilityState: 'available',
    ...overrides,
  };
}

function portfolio(overrides: Partial<PortfolioReadModel> = {}): PortfolioReadModel {
  return {
    accountId: 'account-1',
    accountAddress: sender,
    networkId: 'ethereum',
    networkName: 'Ethereum',
    chainId: 1,
    generatedAt: NOW,
    totalAssetCount: 2,
    visibleAssetCount: 2,
    assets: [asset(native), asset(token)],
    warnings: [],
    state: 'ready',
    ...overrides,
  };
}

function quote(overrides: Partial<SwapQuote> = {}): SwapQuote {
  return {
    quoteId: 'quote-1',
    providerId: 'test-provider',
    accountId: 'account-1',
    networkId: 'ethereum',
    chainId: 1n,
    sellAsset: native,
    buyAsset: token,
    sellAmount: 1_000_000_000_000_000_000n,
    expectedBuyAmount: 2_000_000n,
    minimumBuyAmount: 1_900_000n,
    slippageBps: 500,
    route: {
      state: 'available',
      hops: [{ inputAsset: native, outputAsset: token, poolOrVenue: 'test-pool', protocol: 'test-protocol' }],
    },
    priceImpact: { state: 'available', bps: 25 },
    gasEstimate: 180_000n,
    gasFee: { amount: 50_000_000_000_000_000n, asset: native },
    protocolFee: null,
    providerFee: null,
    integratorFee: null,
    allowanceRequirement: null,
    providerIssues: [],
    estimatedExecutionTime: 30,
    quotedAt: NOW,
    expiresAt: NOW + 30_000,
    transactionRequest: { from: sender, to: router, value: 1_000_000_000_000_000_000n, data: '0x1234', gasLimit: 220_000n },
    ...overrides,
  };
}

function input(overrides: Partial<SwapReviewInput> = {}): SwapReviewInput {
  const currentQuote = quote();
  const currentPortfolio = portfolio();
  return {
    quote: currentQuote,
    quoteLifecycleState: 'quoted',
    account: { accountId: 'account-1', address: sender },
    network,
    registeredNetwork: network,
    activeNetworkId: 'ethereum',
    sellAsset: currentPortfolio.assets[0],
    buyAsset: currentPortfolio.assets[1],
    portfolio: currentPortfolio,
    ...overrides,
  };
}

function assertReviewCode(callback: () => unknown, code: ConstructorParameters<typeof SwapReviewError>[0]): void {
  assert.throws(callback, (error: unknown) => error instanceof SwapReviewError && error.code === code);
}

test('creates an immutable provider-neutral review with a canonical binding digest', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  const review = service.createReview(input());

  assert.equal(review.status, 'ready');
  assert.equal(review.canApprove, true);
  assert.equal(review.sellAmountDisplay, '1');
  assert.equal(review.expectedBuyAmountDisplay, '2');
  assert.match(review.reviewDigest, /^0x[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(review), true);
  assert.equal(review.approvalRequired, false);
});

test('approves only the same current review context and returns public transaction context', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  const review = service.createReview(input());
  const approval = service.approveReview({ review, current: input() });

  assert.equal(approval.status, 'approved-for-signing');
  assert.equal(approval.reviewDigest, review.reviewDigest);
  assert.equal(approval.transactionRequest.data, '0x1234');
  assert.equal('signedTransaction' in approval, false);
  assert.equal('authorization' in approval, false);
});

test('keeps the approval binding stable across immediate revalidation', () => {
  let clock = NOW;
  const service = new SwapReviewService(registry(), { now: () => clock });
  const review = service.createReview(input());
  clock += 1_000;

  const approval = service.approveReview({ review, current: input() });

  assert.equal(approval.status, 'approved-for-signing');
  assert.equal(approval.reviewDigest, review.reviewDigest);
});

test('rejects account, sender, network, asset, slippage, and expired quote mismatches', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  assertReviewCode(() => service.createReview(input({ account: { accountId: 'other', address: sender } })), 'SWAP_REVIEW_ACCOUNT_MISMATCH');
  assertReviewCode(() => service.createReview(input({ account: { accountId: 'account-1', address: '0x4444444444444444444444444444444444444444' } })), 'SWAP_REVIEW_SENDER_MISMATCH');
  assertReviewCode(() => service.createReview(input({ activeNetworkId: 'polygon' })), 'SWAP_REVIEW_NETWORK_MISMATCH');
  assertReviewCode(() => service.createReview(input({ quote: quote({ sellAsset: token }) })), 'SWAP_REVIEW_ASSET_MISMATCH');
  assertReviewCode(() => service.createReview(input({ quote: quote({ slippageBps: 6000 }) })), 'SWAP_REVIEW_SLIPPAGE_MISMATCH');
  assertReviewCode(() => service.createReview(input({ quote: quote({ expiresAt: NOW }) })), 'SWAP_REVIEW_QUOTE_EXPIRED');
});

test('rejects malformed provider transaction targets and calldata', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  assertReviewCode(
    () => service.createReview(input({ quote: quote({ transactionRequest: { ...quote().transactionRequest, to: '0xnot-an-address' } }) })),
    'SWAP_REVIEW_TRANSACTION_TARGET_INVALID',
  );
  assertReviewCode(
    () => service.createReview(input({ quote: quote({ transactionRequest: { ...quote().transactionRequest, data: '0x123' } }) })),
    'SWAP_REVIEW_CALLDATA_INVALID',
  );
});

test('keeps review visible but blocks approval when native amount plus fee exceeds balance', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  const lowBalance = portfolio({ assets: [asset(native, { rawBalance: 1_010_000_000_000_000_000n }), asset(token)] });
  const review = service.createReview(input({ portfolio: lowBalance, sellAsset: lowBalance.assets[0], buyAsset: lowBalance.assets[1] }));

  assert.equal(review.canApprove, false);
  assert.equal(review.blockers[0]?.code, 'SWAP_REVIEW_INSUFFICIENT_BALANCE');
  assertReviewCode(() => service.approveReview({ review, current: input({ portfolio: lowBalance, sellAsset: lowBalance.assets[0], buyAsset: lowBalance.assets[1] }) }), 'SWAP_REVIEW_INSUFFICIENT_BALANCE');
});

test('blocks unavailable or stale public balances and blocking provider issues', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  const stale = portfolio({ generatedAt: NOW - 121_000 });
  assertReviewCode(() => service.createReview(input({ portfolio: stale, sellAsset: stale.assets[0], buyAsset: stale.assets[1] })), 'SWAP_REVIEW_PORTFOLIO_STALE');

  const unavailable = portfolio({ assets: [asset(native, { rawBalance: null, balanceState: 'unavailable' }), asset(token)] });
  const unavailableReview = service.createReview(input({ portfolio: unavailable, sellAsset: unavailable.assets[0], buyAsset: unavailable.assets[1] }));
  assert.equal(unavailableReview.canApprove, false);
  assert.equal(unavailableReview.blockers[0]?.code, 'SWAP_REVIEW_BALANCE_UNAVAILABLE');

  const providerIssue = quote({ providerIssues: [{ code: 'simulation-incomplete' }] });
  const issueReview = service.createReview(input({ quote: providerIssue }));
  assert.equal(issueReview.canApprove, false);
  assert.equal(issueReview.blockers.some((blocker) => blocker.code === 'SWAP_REVIEW_PROVIDER_ISSUE'), true);
});

test('requires network fee context but preserves allowance metadata without executing it', () => {
  const service = new SwapReviewService(registry(), { now: () => NOW });
  const allowanceQuote = quote({
    sellAsset: token,
    buyAsset: native,
    gasFee: null,
    allowanceRequirement: {
      asset: token,
      spender: router,
      actualAmount: 0n,
      requiredAmount: 1_000_000n,
    },
  });
  const currentPortfolio = portfolio({ assets: [asset(native), asset(token)] });
  const review = service.createReview(input({
    quote: allowanceQuote,
    sellAsset: currentPortfolio.assets[1],
    buyAsset: currentPortfolio.assets[0],
    portfolio: currentPortfolio,
  }));
  assert.equal(review.approvalRequired, true);
  assert.equal(review.allowanceRequirement?.requiredAmount, 1_000_000n);
  assert.equal(review.canApprove, false);
  assert.equal(review.blockers[0]?.code, 'SWAP_REVIEW_FEE_UNAVAILABLE');
});

test('uses the configured portfolio age policy rather than silently refreshing data', () => {
  const customAge = new SwapReviewService(registry(), { now: () => NOW, maxPortfolioAgeMs: 10_000 });
  const old = portfolio({ generatedAt: NOW - 10_001 });
  assertReviewCode(() => customAge.createReview(input({ portfolio: old, sellAsset: old.assets[0], buyAsset: old.assets[1] })), 'SWAP_REVIEW_PORTFOLIO_STALE');
});