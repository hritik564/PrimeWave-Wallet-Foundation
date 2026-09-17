import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import type {
  TransactionIntent,
  TransactionPreview,
  UnsignedTransaction,
} from '@/src/core/transactions/construction';
import {
  assertSignedTransactionContext,
  assertReviewStillCurrent,
  createReviewSigningAuthorization,
  createPublicReviewConfirmation,
  createTransactionExplorerUrl,
  displayFeePerGas,
  prepareTransactionReview,
  TransactionReviewError,
} from '../TransactionReviewScreen.logic';
import type { PublicSendDraft } from '../WalletSendScreen.logic';

const network: EvmNetwork = {
  id: 'review-network',
  displayName: 'Review Network',
  chainId: 777,
  nativeCurrency: { name: 'Review Prime', symbol: 'PRM', decimals: 18 },
  rpc: { endpoints: [{ id: 'review-rpc', url: 'https://rpc.review.invalid', priority: 0 }] },
  explorer: {
    name: 'Review Explorer',
    baseUrl: 'https://explorer.review.invalid',
    addressUrlTemplate: 'https://explorer.review.invalid/address/{address}',
    transactionUrlTemplate: 'https://explorer.review.invalid/tx/{txHash}',
  },
  environment: 'testnet',
  isPrimary: true,
  enabled: true,
  configurationStatus: 'configured',
};

const sender = '0x0000000000000000000000000000000000000003';
const recipient = '0x0000000000000000000000000000000000000001';
const tokenContract = '0x0000000000000000000000000000000000000002';

function asset(overrides: Partial<PortfolioAssetViewModel> = {}): PortfolioAssetViewModel {
  return {
    identity: { assetType: 'native', networkId: network.id, assetId: 'native' },
    assetType: 'native',
    networkId: network.id,
    contractAddress: null,
    symbol: 'PRM',
    name: 'Review Prime',
    decimals: 18,
    rawBalance: 10_000_000_000_000_000_000n,
    formattedBalance: '10',
    visibility: 'visible',
    verificationStatus: 'unknown',
    metadataStatus: 'complete',
    provenance: [],
    icon: {
      source: 'none',
      status: 'unavailable',
      reference: null,
      dimensions: null,
      provenance: 'none',
      fallback: { type: 'native_currency', initials: 'PRM', deterministicId: '0x1234' },
    },
    balanceState: 'positive',
    availabilityState: 'available',
    ...overrides,
  };
}

const token = asset({
  identity: { assetType: 'fungible_token', networkId: network.id, assetId: tokenContract },
  assetType: 'fungible_token',
  contractAddress: tokenContract,
  symbol: 'WAVE',
  name: 'Wave Token',
  decimals: 6,
  rawBalance: 5_000_000n,
  formattedBalance: '5',
  verificationStatus: 'unverified',
});

function portfolio(assets: readonly PortfolioAssetViewModel[]): PortfolioReadModel {
  return {
    accountId: 'account-1',
    accountAddress: sender,
    networkId: network.id,
    networkName: network.displayName,
    chainId: network.chainId as number,
    generatedAt: 1,
    totalAssetCount: assets.length,
    visibleAssetCount: assets.length,
    assets,
    warnings: [],
    state: 'ready',
  };
}

function draft(overrides: Partial<PublicSendDraft> = {}): PublicSendDraft {
  return {
    accountId: 'account-1',
    senderPublicAddress: sender,
    networkId: network.id,
    selectedAssetIdentity: { assetType: 'native', networkId: network.id, assetId: 'native' },
    recipient,
    amount: '1',
    ...overrides,
  };
}

function previewFor(intent: TransactionIntent, feeModel: 'legacy' | 'eip1559' = 'eip1559'): TransactionPreview {
  const value = intent.value as bigint;
  const data = (intent.data ?? '0x') as `0x${string}`;
  const unsigned: UnsignedTransaction = feeModel === 'legacy'
    ? {
        networkId: network.id,
        chainId: BigInt(network.chainId as number),
        transactionType: intent.transactionType ?? (data === '0x' ? 'native-transfer' : 'contract-call'),
        from: sender,
        to: intent.to,
        value,
        data,
        nonce: 4n,
        gasLimit: 21_000n,
        feeModel: 'legacy',
        gasPrice: 2n,
        canonicalRepresentation: `legacy:${intent.to}:${value}:${data}`,
      }
    : {
        networkId: network.id,
        chainId: BigInt(network.chainId as number),
        transactionType: intent.transactionType ?? (data === '0x' ? 'native-transfer' : 'contract-call'),
        from: sender,
        to: intent.to,
        value,
        data,
        nonce: 4n,
        gasLimit: 21_000n,
        feeModel: 'eip1559',
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        canonicalRepresentation: `eip1559:${intent.to}:${value}:${data}`,
      };
  return feeModel === 'legacy'
    ? {
        networkName: network.displayName,
        networkId: network.id,
        chainId: BigInt(network.chainId as number),
        transactionType: unsigned.transactionType,
        from: sender,
        to: intent.to,
        value,
        valueDisplay: value.toString(),
        data,
        hasCalldata: data !== '0x',
        nonce: 4n,
        gasLimit: 21_000n,
        symbol: network.nativeCurrency.symbol,
        decimals: network.nativeCurrency.decimals,
        estimatedNetworkFee: 42_000_000_000_000n,
        estimatedNetworkFeeDisplay: '0.000042',
        totalMaximumNativeAmount: value + 42_000_000_000_000n,
        totalMaximumNativeAmountDisplay: '1.000042',
        warnings: ['Legacy fee fallback: EIP-1559 fee data was unavailable.'],
        unsignedTransaction: unsigned,
        feeModel: 'legacy',
        gasPrice: 2n,
      }
    : {
        networkName: network.displayName,
        networkId: network.id,
        chainId: BigInt(network.chainId as number),
        transactionType: unsigned.transactionType,
        from: sender,
        to: intent.to,
        value,
        valueDisplay: value.toString(),
        data,
        hasCalldata: data !== '0x',
        nonce: 4n,
        gasLimit: 21_000n,
        symbol: network.nativeCurrency.symbol,
        decimals: network.nativeCurrency.decimals,
        estimatedNetworkFee: 42_000_000_000_000n,
        estimatedNetworkFeeDisplay: '0.000042',
        totalMaximumNativeAmount: value + 42_000_000_000_000n,
        totalMaximumNativeAmountDisplay: '1.000042',
        warnings: [],
        unsignedTransaction: unsigned,
        feeModel: 'eip1559',
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
      };
}

function engine(options: {
  readonly network?: EvmNetwork;
  readonly feeModel?: 'legacy' | 'eip1559';
  readonly onConstruct?: (intent: TransactionIntent) => void;
} = {}) {
  return {
    getNetwork: () => options.network ?? network,
    construct: async (intent: TransactionIntent) => {
      options.onConstruct?.(intent);
      return previewFor(intent, options.feeModel);
    },
  };
}

const commonInput = {
  draft: draft(),
  account: { accountId: 'account-1', address: sender },
  network,
  registeredNetwork: network,
  activeNetworkId: network.id,
  portfolio: portfolio([asset()]),
  constructionEngine: engine(),
};

test('native review validates the public draft and delegates exact intent construction', async () => {
  let received: TransactionIntent | undefined;
  const prepared = await prepareTransactionReview({
    ...commonInput,
    draft: draft({ amount: '1.25' }),
    constructionEngine: engine({ onConstruct: (intent) => { received = intent; } }),
  });
  assert.ok(received);
  assert.equal(received.transactionType, 'native-transfer');
  assert.equal(received.value, 1_250_000_000_000_000_000n);
  assert.equal(received.to, recipient);
  assert.equal(prepared.preview.transactionType, 'native-transfer');
  assert.equal(prepared.nativeBalance, 10_000_000_000_000_000_000n);
});

test('ERC-20 review creates a contract call and keeps fee currency native', async () => {
  let received: TransactionIntent | undefined;
  const prepared = await prepareTransactionReview({
    ...commonInput,
    draft: draft({
      amount: '1.25',
      selectedAssetIdentity: token.identity,
      tokenContractAddress: token.contractAddress ?? undefined,
    }),
    portfolio: portfolio([asset(), token]),
    constructionEngine: engine({ onConstruct: (intent) => { received = intent; } }),
  });
  assert.ok(received);
  assert.equal(received.transactionType, 'contract-call');
  assert.equal(received.to, tokenContract);
  assert.equal(received.value, 0n);
  assert.notEqual(received.data, '0x');
  assert.equal(prepared.tokenBalance, 5_000_000n);
  assert.equal(prepared.preview.symbol, 'PRM');
  assert.match(prepared.warnings.join(' '), /not independently verified/);
});

test('network and asset identity changes are rejected before construction', async () => {
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      draft: draft({ networkId: 'other-network' }),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'NETWORK_CHANGED',
  );
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      draft: draft({ selectedAssetIdentity: { assetType: 'native', networkId: 'other-network', assetId: 'native' } }),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'ASSET_MISMATCH',
  );
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      network: { ...network, configurationStatus: 'placeholder' },
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'NETWORK_UNAVAILABLE',
  );
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      constructionEngine: engine({ network: { ...network, chainId: 778 } }),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'CHAIN_ID_MISMATCH',
  );
});

test('balance safety rejects insufficient native, token, and unavailable balances', async () => {
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      draft: draft({ amount: '10' }),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'INSUFFICIENT_NATIVE_BALANCE',
  );
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      draft: draft({
        amount: '6',
        selectedAssetIdentity: token.identity,
        tokenContractAddress: token.contractAddress ?? undefined,
      }),
      portfolio: portfolio([asset(), token]),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'INSUFFICIENT_TOKEN_BALANCE',
  );
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      portfolio: portfolio([asset({ rawBalance: null, formattedBalance: null })]),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'BALANCE_UNAVAILABLE',
  );
});

test('fee model display preserves EIP-1559, Legacy, and fallback warnings', async () => {
  const eip = await prepareTransactionReview({ ...commonInput, constructionEngine: engine({ feeModel: 'eip1559' }), draft: draft() });
  const legacy = await prepareTransactionReview({ ...commonInput, constructionEngine: engine({ feeModel: 'legacy' }), draft: draft() });
  assert.equal(eip.preview.feeModel, 'eip1559');
  assert.equal(legacy.preview.feeModel, 'legacy');
  assert.equal(displayFeePerGas(legacy.preview), '0.000000000000000002');
  assert.match(legacy.warnings.join(' '), /Legacy fee fallback/);
  assert.equal(legacy.preview.totalMaximumNativeAmount > legacy.nativeBalance, false);
});

test('stale review invalidation checks recipient, amount, asset, network, and account context', async () => {
  const review = await prepareTransactionReview({ ...commonInput, draft: draft() });
  assert.throws(
    () => assertReviewStillCurrent({
      review,
      draft: draft({ amount: '2' }),
      account: commonInput.account,
      network,
      activeNetworkId: network.id,
      asset: asset(),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'STALE_REVIEW',
  );
  assert.throws(
    () => assertReviewStillCurrent({
      review,
      draft: draft({ recipient: '0x0000000000000000000000000000000000000004' }),
      account: commonInput.account,
      network,
      activeNetworkId: network.id,
      asset: asset(),
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'STALE_REVIEW',
  );
});

test('confirmation is public-only and contains no authorization or broadcast state', async () => {
  const review = await prepareTransactionReview({ ...commonInput, draft: draft() });
  const result = createPublicReviewConfirmation(review);
  assert.equal(result.status, 'confirmed-for-signing');
  assert.equal('privateKey' in result, false);
  assert.equal('mnemonic' in result, false);
  assert.equal('pin' in result, false);
  assert.equal('signingCapability' in result, false);
  assert.equal('transactionHash' in result, false);
});

test('signing authorization is derived from the exact reviewed unsigned transaction', async () => {
  const review = await prepareTransactionReview({ ...commonInput, draft: draft() });
  const input = createReviewSigningAuthorization(review);
  assert.equal(input.accountId, 'account-1');
  assert.equal(input.transaction, review.preview.unsignedTransaction);
  assert.match(input.requestId, /^wavex-review:/);
  assert.equal(
    input.transaction.canonicalRepresentation,
    review.preview.unsignedTransaction.canonicalRepresentation,
  );
});

test('pre-broadcast context rejects network and sender changes', async () => {
  const review = await prepareTransactionReview({ ...commonInput, draft: draft() });
  const signed = {
    kind: 'signed-transaction' as const,
    rawTransaction: '0x00' as `0x${string}`,
    transactionHash: `0x${'1'.repeat(64)}` as `0x${string}`,
    networkId: network.id,
    chainId: BigInt(network.chainId as number),
    transactionType: review.preview.unsignedTransaction.transactionType,
    from: sender,
  };

  assert.doesNotThrow(() =>
    assertSignedTransactionContext({
      signed,
      review,
      network,
      activeNetworkId: network.id,
    }),
  );
  assert.throws(
    () =>
      assertSignedTransactionContext({
        signed,
        review,
        network,
        activeNetworkId: 'other-network',
      }),
    (error: unknown) =>
      error instanceof TransactionReviewError &&
      error.code === 'BROADCAST_NETWORK_CHANGED',
  );
  assert.throws(
    () =>
      assertSignedTransactionContext({
        signed: { ...signed, from: recipient },
        review,
        network,
        activeNetworkId: network.id,
      }),
    (error: unknown) =>
      error instanceof TransactionReviewError &&
      error.code === 'BROADCAST_ACCOUNT_CHANGED',
  );
});

test('explorer links use only configured transaction URL templates', () => {
  const hash = `0x${'a'.repeat(64)}`;
  assert.equal(
    createTransactionExplorerUrl(network, hash),
    `https://explorer.review.invalid/tx/${hash}`,
  );
  assert.equal(
    createTransactionExplorerUrl(
      { ...network, configurationStatus: 'placeholder', chainId: null },
      hash,
    ),
    null,
  );
  assert.equal(createTransactionExplorerUrl(network, '0xnot-a-hash'), null);
});

test('construction and fee failures are sanitized', async () => {
  const failingEngine = {
    getNetwork: () => network,
    construct: async () => { throw new Error('https://secret-rpc.invalid/raw-stack'); },
  };
  await assert.rejects(
    prepareTransactionReview({
      ...commonInput,
      constructionEngine: failingEngine,
    }),
    (error: unknown) =>
      error instanceof TransactionReviewError &&
      error.code === 'CONSTRUCTION_FAILED' &&
      !error.message.includes('secret-rpc'),
  );
});