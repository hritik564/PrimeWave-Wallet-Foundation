import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetError,
  createAssetIdentity,
  createTokenAssetIdentity,
  getAssetIdentityKey,
  type ERC20Token,
  type NativeAsset,
} from '@/src/core/assets';
import {
  PortfolioReadModelError,
  PortfolioReadModelService,
  createAssetIcon,
  type Portfolio,
  type PortfolioAsset,
  type PortfolioAggregationReader,
} from '../index';
import type { PortfolioAssetBalance } from '../models';

const ACCOUNT = '0x52908400098527886E0F7030069857D2E4169EE7';
const OTHER_ACCOUNT = '0x1111111111111111111111111111111111111111';
const CONTRACT_A = '0x2222222222222222222222222222222222222222';
const CONTRACT_B = '0x3333333333333333333333333333333333333333';

const native: NativeAsset = {
  assetType: 'native',
  networkId: 'ethereum',
  assetId: 'native',
  chainId: 1,
  name: 'Ether',
  symbol: 'ETH',
  decimals: 18,
  nativeCurrencyIdentifier: 'native',
  enabled: true,
  status: 'available',
};

function token(
  networkId: string,
  contractAddress: string,
  overrides: Partial<ERC20Token> = {},
): ERC20Token {
  const identity = createTokenAssetIdentity(networkId, contractAddress);
  return {
    ...identity,
    chainId: networkId === 'ethereum' ? 1 : 56,
    name: 'Token',
    symbol: 'TKN',
    decimals: 18,
    metadataStatus: 'complete',
    verificationStatus: 'unknown',
    availabilityStatus: 'available',
    ...overrides,
  };
}

function asset(
  value: NativeAsset | ERC20Token,
  options: Omit<Partial<PortfolioAsset>, 'balance'> & {
    readonly balance?: Partial<PortfolioAssetBalance>;
  } = {},
): PortfolioAsset {
  const isNative = value.assetType === 'native';
  const rawAmount =
    options.balance?.rawAmount !== undefined
      ? options.balance.rawAmount
      : 0n;
  const balance: PortfolioAssetBalance = {
    rawAmount,
    decimals:
      options.balance?.decimals !== undefined
        ? options.balance.decimals
        : value.decimals,
    formattedAmount:
      options.balance?.formattedAmount !== undefined
        ? options.balance.formattedAmount
        : rawAmount === null
          ? null
          : rawAmount.toString(),
    hasBalance:
      options.balance?.hasBalance !== undefined
        ? options.balance.hasBalance
        : rawAmount === null
          ? null
          : rawAmount > 0n,
    blockNumber:
      options.balance?.blockNumber !== undefined
        ? options.balance.blockNumber
        : 100n,
    blockHash:
      options.balance?.blockHash !== undefined
        ? options.balance.blockHash
        : '0xblock',
    retrievedAtMs:
      options.balance?.retrievedAtMs !== undefined
        ? options.balance.retrievedAtMs
        : 1_700_000_000_000,
  };
  const { balance: _balanceOverride, ...assetOptions } = options;
  return {
    identity: value,
    networkId: value.networkId,
    accountId: 'account-0',
    asset: value,
    name: value.name,
    symbol: value.symbol,
    decimals: value.decimals,
    metadataStatus: isNative
      ? 'complete'
      : (value.metadataStatus ?? 'complete'),
    verificationStatus: isNative
      ? null
      : (value.verificationStatus ?? 'unknown'),
    discoveryState: null,
    sources: isNative ? ['native'] : ['registry'],
    provenance: isNative ? [] : ['registry'],
    visibility: 'visible',
    status: 'available',
    errorCode: null,
    icon: createAssetIcon(
      value,
      value.name,
      value.symbol,
      isNative ? 'native_currency' : 'asset_initials',
    ),
    balance,
    ...assetOptions,
  };
}

function portfolio(
  assets: readonly PortfolioAsset[],
  options: {
    readonly accountId?: string;
    readonly accountAddress?: string;
    readonly networkId?: string;
    readonly displayName?: string;
    readonly chainId?: number;
  } = {},
): Portfolio {
  const networkId = options.networkId ?? 'ethereum';
  return {
    kind: 'portfolio',
    account: {
      accountId: options.accountId ?? 'account-0',
      address: options.accountAddress ?? ACCOUNT,
    },
    networks: [
      {
        networkId,
        chainId: options.chainId ?? (networkId === 'ethereum' ? 1 : 56),
        displayName: options.displayName ?? networkId,
        nativeCurrencySymbol: networkId === 'ethereum' ? 'ETH' : 'BNB',
      },
    ],
    assets,
    summary: {
      networksRepresented: 1,
      visibleAssetCount: assets.filter((item) => item.visibility === 'visible')
        .length,
      hiddenAssetCount: assets.filter((item) => item.visibility === 'hidden')
        .length,
      assetsWithBalances: assets.filter(
        (item) => item.balance.hasBalance === true,
      ).length,
      nativeAssetCount: assets.filter(
        (item) => item.identity.assetType === 'native',
      ).length,
      fungibleTokenCount: assets.filter(
        (item) => item.identity.assetType === 'fungible_token',
      ).length,
      unavailableAssetCount: assets.filter(
        (item) => item.status !== 'available',
      ).length,
    },
    refreshedAtMs: 1_700_000_000_123,
  };
}

function reader(result: Portfolio | Error): {
  readonly aggregation: PortfolioAggregationReader;
  readonly queries: unknown[];
} {
  const queries: unknown[] = [];
  return {
    queries,
    aggregation: {
      async getPortfolio(query) {
        queries.push(query);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

test('transforms public aggregation data into a stable read model', async () => {
  const nativeAsset = asset(native, {
    balance: {
      rawAmount: 9_000_000_000_000_000_001n,
      formattedAmount: '9.000000000000000001',
    },
  });
  const tokenAsset = asset(token('ethereum', CONTRACT_A), {
    balance: {
      rawAmount: 123456789012345678901234567890n,
      formattedAmount: '123456789012.34567890123456789',
    },
  });
  const fixture = reader(portfolio([tokenAsset, nativeAsset]));
  const model = await new PortfolioReadModelService(fixture.aggregation).getPortfolio({
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkId: 'ethereum',
  });

  assert.equal(model.accountId, 'account-0');
  assert.equal(model.accountAddress, ACCOUNT);
  assert.equal(model.networkId, 'ethereum');
  assert.equal(model.networkName, 'ethereum');
  assert.equal(model.chainId, 1);
  assert.equal(model.generatedAt, 1_700_000_000_123);
  assert.equal(model.totalAssetCount, 2);
  assert.equal(model.visibleAssetCount, 2);
  assert.equal(model.state, 'ready');
  assert.deepEqual(
    model.assets.map((item) => item.assetType),
    ['native', 'fungible_token'],
  );
  assert.equal(model.assets[0]?.rawBalance, 9_000_000_000_000_000_001n);
  assert.equal(model.assets[1]?.rawBalance, 123456789012345678901234567890n);
  assert.equal(model.assets[1]?.formattedBalance, '123456789012.34567890123456789');
  assert.equal(model.assets[0]?.icon.fallback.type, 'native_currency');
  assert.equal(fixture.queries.length, 1);
});

test('preserves visibility, metadata, verification, provenance, and explicit states', async () => {
  const hidden = asset(token('ethereum', CONTRACT_A), {
    visibility: 'hidden',
    verificationStatus: 'unverified',
    provenance: ['user_added', 'discovered'],
  });
  const partial = asset(token('ethereum', CONTRACT_B, {
    name: null,
    symbol: null,
    decimals: null,
    metadataStatus: 'partial',
    verificationStatus: 'verified',
  }), {
    status: 'metadata_unavailable',
    metadataStatus: 'partial',
    balance: {
      rawAmount: null,
      decimals: null,
      formattedAmount: null,
      hasBalance: null,
      blockNumber: null,
      blockHash: null,
      retrievedAtMs: null,
    },
  });
  const fixture = reader(portfolio([partial, hidden]));
  const model = await new PortfolioReadModelService(fixture.aggregation).getPortfolio({
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkId: 'ethereum',
  });

  const hiddenView = model.assets.find((item) => item.contractAddress === CONTRACT_A);
  const partialView = model.assets.find((item) => item.contractAddress === CONTRACT_B);
  assert.equal(hiddenView?.visibility, 'hidden');
  assert.equal(hiddenView?.verificationStatus, 'unverified');
  assert.deepEqual(hiddenView?.provenance, ['user_added', 'discovered']);
  assert.equal(partialView?.metadataStatus, 'partial');
  assert.equal(partialView?.verificationStatus, 'verified');
  assert.equal(partialView?.balanceState, 'unavailable');
  assert.equal(partialView?.availabilityState, 'unavailable');
  assert.equal(model.visibleAssetCount, 1);
  assert.equal(model.state, 'partial');
  assert.deepEqual(
    model.warnings.map((warning) => warning.code),
    ['ASSET_BALANCE_UNAVAILABLE', 'ASSET_METADATA_INCOMPLETE'],
  );
});

test('orders visible, available, positive, native assets deterministically', async () => {
  const visibleZeroToken = asset(token('ethereum', CONTRACT_B), {
    balance: { rawAmount: 0n, formattedAmount: '0' },
  });
  const hiddenPositiveNative = asset(native, {
    visibility: 'hidden',
    balance: { rawAmount: 2n, formattedAmount: '0.000000000000000002' },
  });
  const unavailableVisible = asset(token('ethereum', CONTRACT_A), {
    status: 'balance_unavailable',
    balance: {
      rawAmount: null,
      decimals: null,
      formattedAmount: null,
      hasBalance: null,
      blockNumber: null,
      blockHash: null,
      retrievedAtMs: null,
    },
  });
  const visiblePositiveToken = asset(token('ethereum', '0x4444444444444444444444444444444444444444'), {
    balance: { rawAmount: 1n, formattedAmount: '0.000000000000000001' },
  });
  const fixture = reader(
    portfolio([
      hiddenPositiveNative,
      unavailableVisible,
      visibleZeroToken,
      visiblePositiveToken,
    ]),
  );
  const model = await new PortfolioReadModelService(fixture.aggregation).getPortfolio({
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkId: 'ethereum',
  });

  assert.deepEqual(
    model.assets.map((item) => item.identity.assetId),
    [
      '0x4444444444444444444444444444444444444444',
      CONTRACT_B,
      CONTRACT_A,
      'native',
    ],
  );
});

test('keeps same-address assets isolated by network and delegates one read', async () => {
  const ethereumToken = token('ethereum', CONTRACT_A);
  const bnbToken = token('bnb', CONTRACT_A);
  const ethereumReader = reader(
    portfolio([asset(ethereumToken)], { networkId: 'ethereum' }),
  );
  const bnbReader = reader(
    portfolio([asset(bnbToken)], {
      networkId: 'bnb',
      displayName: 'BNB Smart Chain',
      chainId: 56,
    }),
  );
  const ethereumModel = await new PortfolioReadModelService(
    ethereumReader.aggregation,
  ).getPortfolio({
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkId: 'ethereum',
  });
  const bnbModel = await new PortfolioReadModelService(
    bnbReader.aggregation,
  ).getPortfolio({
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkId: 'bnb',
  });

  assert.notEqual(
    getAssetIdentityKey(ethereumModel.assets[0]!.identity),
    getAssetIdentityKey(bnbModel.assets[0]!.identity),
  );
  assert.equal(ethereumReader.queries.length, 1);
  assert.equal(bnbReader.queries.length, 1);
  assert.deepEqual(ethereumReader.queries[0], {
    accountId: 'account-0',
    accountAddress: ACCOUNT,
    networkIds: ['ethereum'],
    tokenIdentities: undefined,
    includeHidden: undefined,
  });
});

test('rejects malformed or cross-account/cross-network results safely', async () => {
  const result = reader(
    portfolio([asset(native)], {
      accountId: 'other-account',
      accountAddress: OTHER_ACCOUNT,
    }),
  );
  await assert.rejects(
    () =>
      new PortfolioReadModelService(result.aggregation).getPortfolio({
        accountId: 'account-0',
        accountAddress: ACCOUNT,
        networkId: 'ethereum',
      }),
    (error: unknown) =>
      error instanceof PortfolioReadModelError &&
      error.code === 'READ_MODEL_CONTEXT_MISMATCH',
  );

  await assert.rejects(
    () =>
      new PortfolioReadModelService(result.aggregation).getPortfolio({
        accountId: 'account-0',
        accountAddress: 'not-an-address',
        networkId: 'ethereum',
      }),
    (error: unknown) =>
      error instanceof PortfolioReadModelError &&
      error.code === 'READ_MODEL_INVALID_REQUEST',
  );
});

test('normalizes unexpected aggregation failures without leaking details', async () => {
  const fixture = reader(new Error('private provider URL and stack must not leak'));
  await assert.rejects(
    () =>
      new PortfolioReadModelService(fixture.aggregation).getPortfolio({
        accountId: 'account-0',
        accountAddress: ACCOUNT,
        networkId: 'ethereum',
      }),
    (error: unknown) =>
      error instanceof PortfolioReadModelError &&
      error.code === 'READ_MODEL_AGGREGATION_FAILED' &&
      error.message === 'The portfolio read-model could not be generated.',
  );

  const assetFailure = reader(new AssetError('PORTFOLIO_NETWORK_UNAVAILABLE'));
  await assert.rejects(
    () =>
      new PortfolioReadModelService(assetFailure.aggregation).getPortfolio({
        accountId: 'account-0',
        accountAddress: ACCOUNT,
        networkId: 'ethereum',
      }),
    (error: unknown) =>
      error instanceof AssetError &&
      error.code === 'PORTFOLIO_NETWORK_UNAVAILABLE',
  );
});