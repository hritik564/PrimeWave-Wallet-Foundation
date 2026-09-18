import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData } from 'viem';
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
  NetworkRegistry,
  supportedNetworks,
  type EvmNetwork,
} from '@/src/core/networks';
import type {
  TransactionIntent,
  TransactionPreview,
} from '@/src/core/transactions/construction';
import {
  SwapExecutionError,
  SwapExecutionService,
  SwapReviewService,
  type SwapQuote,
  type SwapReviewInput,
  type SwapReviewSnapshot,
} from '../../index';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';

const NOW = 2_000_000_000_000;
const sender = '0x1111111111111111111111111111111111111111';
const router = '0x2222222222222222222222222222222222222222';
const spender = '0x4444444444444444444444444444444444444444';
const native: AssetIdentity = {
  assetType: 'native',
  networkId: 'ethereum',
  assetId: 'native',
};
const token = createTokenAssetIdentity(
  'ethereum',
  '0x3333333333333333333333333333333333333333',
);
const network = supportedNetworks.find(
  (candidate) => candidate.id === 'ethereum',
) as EvmNetwork;

function registry() {
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

function preview(intent: TransactionIntent, gasLimit = 210_000n): TransactionPreview {
  const normalizedGasLimit = intent.gasLimit === undefined
    ? gasLimit
    : BigInt(intent.gasLimit);
  const data = (intent.data ?? '0x') as `0x${string}`;
  const unsigned = {
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: intent.transactionType ?? 'contract-call',
    from: intent.from,
    to: intent.to,
    value: BigInt(intent.value),
    data,
    nonce: 7n,
    gasLimit: normalizedGasLimit,
    feeModel: 'legacy' as const,
    gasPrice: 1_000_000_000n,
    canonicalRepresentation: `${intent.from}:${intent.to}:${BigInt(intent.value).toString()}:${data}:${normalizedGasLimit.toString()}`,
  };
  return {
    networkName: 'Ethereum',
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: unsigned.transactionType,
    from: unsigned.from,
    to: unsigned.to,
    value: unsigned.value,
    valueDisplay: unsigned.value.toString(),
    data: unsigned.data,
    hasCalldata: unsigned.data !== '0x',
    nonce: unsigned.nonce,
    gasLimit: unsigned.gasLimit,
    symbol: 'ETH',
    decimals: 18,
    estimatedNetworkFee: unsigned.gasLimit * unsigned.gasPrice,
    estimatedNetworkFeeDisplay: '0.00021',
    totalMaximumNativeAmount: unsigned.value + unsigned.gasLimit * unsigned.gasPrice,
    totalMaximumNativeAmountDisplay: '0.00021',
    warnings: [],
    unsignedTransaction: unsigned,
    feeModel: 'legacy',
    gasPrice: unsigned.gasPrice,
  };
}

function nativeQuote(overrides: Partial<SwapQuote> = {}): SwapQuote {
  return {
    quoteId: 'quote-native',
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
    route: { state: 'unavailable', hops: [], reason: 'not-provided' },
    priceImpact: { state: 'unavailable', reason: 'not-provided' },
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
    transactionRequest: {
      from: sender,
      to: router,
      value: 1_000_000_000_000_000_000n,
      data: '0x1234',
      gasLimit: 220_000n,
    },
    ...overrides,
  };
}

function tokenQuote(actualAmount: bigint | null): SwapQuote {
  return {
    ...nativeQuote({
      quoteId: 'quote-token',
      sellAsset: token,
      buyAsset: native,
      sellAmount: 1_000_000n,
      expectedBuyAmount: 900_000_000_000_000_000n,
      minimumBuyAmount: 850_000_000_000_000_000n,
      transactionRequest: {
        from: sender,
        to: router,
        value: 0n,
        data: '0xabcdef',
        gasLimit: null,
      },
    }),
    allowanceRequirement: {
      asset: token,
      spender,
      actualAmount,
      requiredAmount: 700_000n,
    },
  };
}

function input(
  quote: SwapQuote,
  overrides: Partial<SwapReviewInput> = {},
): SwapReviewInput {
  const sell = asset(quote.sellAsset);
  const buy = asset(quote.buyAsset);
  const currentPortfolio: PortfolioReadModel = {
    accountId: 'account-1',
    accountAddress: sender,
    networkId: 'ethereum',
    networkName: 'Ethereum',
    chainId: 1,
    generatedAt: NOW,
    totalAssetCount: 2,
    visibleAssetCount: 2,
    assets: [sell, buy],
    warnings: [],
    state: 'ready',
  };
  return {
    quote,
    quoteLifecycleState: 'quoted',
    account: { accountId: 'account-1', address: sender },
    network,
    registeredNetwork: network,
    activeNetworkId: 'ethereum',
    sellAsset: sell,
    buyAsset: buy,
    portfolio: currentPortfolio,
    ...overrides,
  };
}

function constructionDependency(
  networkForDependency = network,
  mutate?: (preview: TransactionPreview, intent: TransactionIntent) => TransactionPreview,
) {
  const intents: TransactionIntent[] = [];
  return {
    intents,
    getNetwork: () => networkForDependency,
    construct: async (intent: TransactionIntent) => {
      intents.push(intent);
      const next = preview(intent);
      return mutate ? mutate(next, intent) : next;
    },
  };
}

function setup(quote: SwapQuote) {
  const current = input(quote);
  const reviewService = new SwapReviewService(registry(), { now: () => NOW });
  const review = reviewService.createReview(current);
  const approval = reviewService.approveReview({ review, current });
  const dependency = constructionDependency();
  const service = new SwapExecutionService(reviewService);
  return { current, dependency, approval, review, service };
}

function assertExecutionCode(callback: () => Promise<unknown>, code: ConstructorParameters<typeof SwapExecutionError>[0]) {
  return assert.rejects(callback, (error: unknown) =>
    error instanceof SwapExecutionError && error.code === code,
  );
}

test('approved native review prepares exact provider transaction without approval', async () => {
  const { approval, current, dependency, review, service } = setup(nativeQuote());
  const plan = await service.prepare({
    review,
    approval,
    current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: dependency,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.approvalTransaction, null);
  assert.equal(plan.swapTransaction.unsignedTransaction.data, '0x1234');
  assert.equal(dependency.intents.length, 1);
  assert.equal(dependency.intents[0].data, '0x1234');
});

test('insufficient token allowance creates a bounded explicit approval transaction', async () => {
  const { approval, current, dependency, review, service } = setup(tokenQuote(0n));
  const plan = await service.prepare({
    review,
    approval,
    current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: dependency,
  });

  assert.equal(plan.approvalRequired, true);
  assert.ok(plan.approvalTransaction);
  const expectedData = encodeFunctionData({
    abi: [{
      type: 'function',
      name: 'approve',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: 'success', type: 'bool' }],
    }] as const,
    functionName: 'approve',
    args: [spender, 700_000n],
  });
  assert.equal(plan.approvalTransaction.unsignedTransaction.data, expectedData);
  assert.equal(plan.approvalTransaction.unsignedTransaction.to.toLowerCase(), token.assetId.toLowerCase());
  assert.equal(plan.approvalTransaction.unsignedTransaction.value, 0n);
});

test('sufficient token allowance skips approval entirely', async () => {
  const { approval, current, dependency, review, service } = setup(tokenQuote(700_000n));
  const plan = await service.prepare({
    review,
    approval,
    current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: dependency,
  });

  assert.equal(plan.allowanceState, 'sufficient');
  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.approvalTransaction, null);
  assert.equal(dependency.intents.length, 1);
});

test('missing token allowance data blocks execution instead of assuming sufficiency', async () => {
  const quote = tokenQuote(0n);
  const reviewInput = input({
    ...quote,
    allowanceRequirement: null,
  });
  const reviewService = new SwapReviewService(registry(), { now: () => NOW });
  const review = reviewService.createReview(reviewInput);
  assert.equal(review.allowanceState, 'unavailable');
  assert.equal(review.canApprove, false);
  assert.equal(review.approvalRequired, false);
  assert.equal(review.blockers[0]?.code, 'SWAP_REVIEW_ALLOWANCE_UNAVAILABLE');
  await assert.rejects(
    () =>
      new SwapExecutionService(reviewService).prepare({
        review,
        approval: {
          status: 'approved-for-signing',
          approvedAt: NOW,
          reviewDigest: review.reviewDigest,
          quoteId: review.quoteId,
          providerId: review.providerId,
          accountId: review.accountId,
          senderAddress: review.senderAddress,
          networkId: review.networkId,
          chainId: review.chainId,
          sellAsset: review.sellAsset.identity,
          buyAsset: review.buyAsset.identity,
          sellAmount: review.sellAmount,
          expectedBuyAmount: review.expectedBuyAmount,
          minimumBuyAmount: review.minimumBuyAmount,
          slippageBps: review.slippageBps,
          transactionRequest: review.transactionRequest,
          allowanceRequirement: null,
          allowanceState: 'unavailable',
        },
        current: reviewInput,
        accountId: 'account-1',
        network,
        activeNetworkId: 'ethereum',
        constructionEngine: constructionDependency(),
      }),
    (error: unknown) =>
      error instanceof SwapExecutionError &&
      error.code === 'SWAP_EXECUTION_ALLOWANCE_UNAVAILABLE',
  );
});

test('preview mode blocks before construction and never fabricates execution', async () => {
  const { approval, current, dependency, review, service } = setup(nativeQuote());
  await assertExecutionCode(() => service.prepare({
    review,
    approval,
    current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: dependency,
    previewMode: true,
  }), 'SWAP_EXECUTION_PREVIEW_BLOCKED');
  assert.equal(dependency.intents.length, 0);
});

test('digest, allowance, network, expiry, and provider transaction changes block before signing', async () => {
  const prepared = setup(tokenQuote(0n));
  const tamperedReview = {
    ...prepared.review,
    transactionRequest: {
      ...prepared.review.transactionRequest,
      data: '0xdead',
    },
  } as SwapReviewSnapshot;
  await assertExecutionCode(() => prepared.service.prepare({
    review: tamperedReview,
    approval: prepared.approval,
    current: prepared.current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: prepared.dependency,
  }), 'SWAP_EXECUTION_REVIEW_STALE');

  const changedAllowance = input(tokenQuote(700_000n));
  await assertExecutionCode(() => prepared.service.prepare({
    review: prepared.review,
    approval: prepared.approval,
    current: changedAllowance,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: prepared.dependency,
  }), 'SWAP_EXECUTION_REVIEW_STALE');

  await assertExecutionCode(() => prepared.service.prepare({
    review: prepared.review,
    approval: prepared.approval,
    current: prepared.current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'polygon',
    constructionEngine: prepared.dependency,
  }), 'SWAP_EXECUTION_NETWORK_CHANGED');

  const expiredService = new SwapExecutionService(
    new SwapReviewService(registry(), { now: () => NOW + 31_000 }),
  );
  await assertExecutionCode(() => expiredService.prepare({
    review: prepared.review,
    approval: prepared.approval,
    current: prepared.current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: prepared.dependency,
  }), 'SWAP_EXECUTION_QUOTE_EXPIRED');

  const changedProvider = setup(tokenQuote(0n));
  const mutatedDependency = constructionDependency(
    network,
    (transaction) => ({
      ...transaction,
      unsignedTransaction: {
        ...transaction.unsignedTransaction,
        data: '0x01',
      },
      data: '0x01',
    }),
  );
  await assertExecutionCode(() => changedProvider.service.prepare({
    review: changedProvider.review,
    approval: changedProvider.approval,
    current: changedProvider.current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: mutatedDependency,
  }), 'SWAP_EXECUTION_PROVIDER_TRANSACTION_CHANGED');
});

test('approval and swap transaction bindings reject mutations', async () => {
  const setupValue = setup(tokenQuote(0n));
  const plan = await setupValue.service.prepare({
    review: setupValue.review,
    approval: setupValue.approval,
    current: setupValue.current,
    accountId: 'account-1',
    network,
    activeNetworkId: 'ethereum',
    constructionEngine: setupValue.dependency,
  });
  assert.ok(plan.approvalTransaction);
  const mutatedApproval = {
    ...plan.approvalTransaction,
    unsignedTransaction: {
      ...plan.approvalTransaction.unsignedTransaction,
      value: 1n,
    },
  } as TransactionPreview;
  assert.throws(
    () => setupValue.service.assertApprovalStillBound(plan, mutatedApproval),
    (error: unknown) =>
      error instanceof SwapExecutionError &&
      error.code === 'SWAP_EXECUTION_APPROVAL_TRANSACTION_MISMATCH',
  );
});