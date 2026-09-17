import {
  AssetError,
  getAssetIdentityKey,
  type AssetIdentity,
  type TokenVerificationStatus,
} from '@/src/core/assets';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type {
  Portfolio,
  PortfolioAsset,
  PortfolioAssetStatus,
} from './index';
import type {
  PortfolioAssetViewModel,
  PortfolioAvailabilityState,
  PortfolioBalanceState,
  PortfolioReadModel,
  PortfolioReadModelQuery,
  PortfolioReadModelState,
  PortfolioReadModelWarning,
} from './read-model';

export type PortfolioReadModelErrorCode =
  | 'READ_MODEL_INVALID_REQUEST'
  | 'READ_MODEL_CONTEXT_MISMATCH'
  | 'READ_MODEL_AGGREGATION_FAILED';

const SAFE_MESSAGES: Record<PortfolioReadModelErrorCode, string> = {
  READ_MODEL_INVALID_REQUEST: 'The portfolio read-model request is invalid.',
  READ_MODEL_CONTEXT_MISMATCH:
    'The portfolio result does not match the requested account or network.',
  READ_MODEL_AGGREGATION_FAILED:
    'The portfolio read-model could not be generated.',
};

export class PortfolioReadModelError extends Error {
  constructor(public readonly code: PortfolioReadModelErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'PortfolioReadModelError';
  }
}

export interface PortfolioAggregationReader {
  getPortfolio(query: {
    readonly accountId: string;
    readonly accountAddress: string;
    readonly networkIds: readonly string[];
    readonly tokenIdentities?: readonly AssetIdentity[];
    readonly includeHidden?: boolean;
  }): Promise<Portfolio>;
}

const availabilityRank: Record<PortfolioAvailabilityState, number> = {
  available: 0,
  stale: 1,
  unavailable: 2,
  invalid: 3,
};

const balanceRank: Record<PortfolioBalanceState, number> = {
  positive: 0,
  zero: 1,
  unavailable: 2,
};

const statusToAvailability: Record<
  PortfolioAssetStatus,
  PortfolioAvailabilityState
> = {
  available: 'available',
  unavailable: 'unavailable',
  metadata_unavailable: 'unavailable',
  balance_unavailable: 'unavailable',
};

function validateQuery(query: PortfolioReadModelQuery): {
  readonly accountId: string;
  readonly accountAddress: string;
  readonly networkId: string;
} {
  if (
    typeof query !== 'object' ||
    query === null ||
    typeof query.accountId !== 'string' ||
    query.accountId.trim().length === 0 ||
    typeof query.networkId !== 'string' ||
    query.networkId.trim().length === 0
  ) {
    throw new PortfolioReadModelError('READ_MODEL_INVALID_REQUEST');
  }
  try {
    return {
      accountId: query.accountId,
      accountAddress: normalizePublicEvmAddress(query.accountAddress),
      networkId: query.networkId,
    };
  } catch {
    throw new PortfolioReadModelError('READ_MODEL_INVALID_REQUEST');
  }
}

function balanceState(rawBalance: bigint | null): PortfolioBalanceState {
  if (rawBalance === null) return 'unavailable';
  return rawBalance > 0n ? 'positive' : 'zero';
}

function contractAddress(asset: PortfolioAsset): string | null {
  return asset.asset.assetType === 'fungible_token'
    ? asset.asset.contractAddress
    : null;
}

function viewModel(asset: PortfolioAsset): PortfolioAssetViewModel {
  const rawBalance = asset.balance.rawAmount;
  return Object.freeze({
    identity: asset.identity,
    assetType: asset.identity.assetType,
    networkId: asset.networkId,
    contractAddress: contractAddress(asset),
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    rawBalance,
    formattedBalance: asset.balance.formattedAmount,
    visibility: asset.visibility,
    verificationStatus: asset.verificationStatus ?? ('unknown' as TokenVerificationStatus),
    metadataStatus: asset.metadataStatus,
    provenance: asset.provenance,
    icon: asset.icon,
    balanceState: balanceState(rawBalance),
    availabilityState: statusToAvailability[asset.status],
  });
}

function compareAssets(
  left: PortfolioAssetViewModel,
  right: PortfolioAssetViewModel,
): number {
  const visibility =
    (left.visibility === 'visible' ? 0 : 1) -
    (right.visibility === 'visible' ? 0 : 1);
  if (visibility !== 0) return visibility;

  const availability =
    availabilityRank[left.availabilityState] -
    availabilityRank[right.availabilityState];
  if (availability !== 0) return availability;

  const balance = balanceRank[left.balanceState] - balanceRank[right.balanceState];
  if (balance !== 0) return balance;

  const assetType =
    (left.assetType === 'native' ? 0 : 1) -
    (right.assetType === 'native' ? 0 : 1);
  if (assetType !== 0) return assetType;

  const leftKey = getAssetIdentityKey(left.identity);
  const rightKey = getAssetIdentityKey(right.identity);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function warningsFor(
  asset: PortfolioAssetViewModel,
): readonly PortfolioReadModelWarning[] {
  const warnings: PortfolioReadModelWarning[] = [];
  if (asset.balanceState === 'unavailable') {
    warnings.push({
      code: 'ASSET_BALANCE_UNAVAILABLE',
      assetIdentity: asset.identity,
      message: 'The asset balance is unavailable.',
    });
  }
  if (asset.metadataStatus !== 'complete') {
    warnings.push({
      code: 'ASSET_METADATA_INCOMPLETE',
      assetIdentity: asset.identity,
      message: 'The asset metadata is incomplete or unavailable.',
    });
  }
  return warnings;
}

function readModelState(
  assets: readonly PortfolioAssetViewModel[],
  warnings: readonly PortfolioReadModelWarning[],
): PortfolioReadModelState {
  if (assets.some((asset) => asset.availabilityState === 'invalid')) {
    return 'invalid';
  }
  if (assets.length > 0 && assets.every((asset) => asset.availabilityState !== 'available')) {
    return 'unavailable';
  }
  return warnings.length > 0 ? 'partial' : 'ready';
}

function assertResultContext(
  portfolio: Portfolio,
  query: {
    readonly accountId: string;
    readonly accountAddress: string;
    readonly networkId: string;
  },
): {
  readonly network: Portfolio['networks'][number];
  readonly assets: readonly PortfolioAsset[];
} {
  let accountAddress: string;
  try {
    accountAddress = normalizePublicEvmAddress(portfolio.account.address);
  } catch {
    throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
  }
  if (
    portfolio.account.accountId !== query.accountId ||
    accountAddress !== query.accountAddress ||
    portfolio.networks.length !== 1 ||
    portfolio.networks[0]?.networkId !== query.networkId
  ) {
    throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
  }
  const network = portfolio.networks[0];
  if (!network) {
    throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
  }
  const keys = new Set<string>();
  for (const asset of portfolio.assets) {
    if (
      asset.accountId !== query.accountId ||
      asset.networkId !== query.networkId ||
      asset.identity.networkId !== query.networkId ||
      keys.has(getAssetIdentityKey(asset.identity))
    ) {
      throw new PortfolioReadModelError('READ_MODEL_CONTEXT_MISMATCH');
    }
    keys.add(getAssetIdentityKey(asset.identity));
  }
  return { network, assets: portfolio.assets };
}

export class PortfolioReadModelService {
  constructor(private readonly aggregation: PortfolioAggregationReader) {}

  async getPortfolio(
    query: PortfolioReadModelQuery,
  ): Promise<PortfolioReadModel> {
    const validated = validateQuery(query);
    let portfolio: Portfolio;
    try {
      portfolio = await this.aggregation.getPortfolio({
        accountId: validated.accountId,
        accountAddress: validated.accountAddress,
        networkIds: [validated.networkId],
        tokenIdentities: query.tokenIdentities,
        includeHidden: query.includeHidden,
      });
    } catch (error) {
      if (error instanceof AssetError) throw error;
      throw new PortfolioReadModelError('READ_MODEL_AGGREGATION_FAILED');
    }

    const { network, assets } = assertResultContext(portfolio, validated);
    const viewAssets = assets.map(viewModel).sort(compareAssets);
    const warnings = viewAssets
      .flatMap((asset) => warningsFor(asset))
      .sort((left, right) => {
        const identity =
          getAssetIdentityKey(left.assetIdentity) <
          getAssetIdentityKey(right.assetIdentity)
            ? -1
            : getAssetIdentityKey(left.assetIdentity) >
                getAssetIdentityKey(right.assetIdentity)
              ? 1
              : 0;
        if (identity !== 0) return identity;
        return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
      });

    return Object.freeze({
      accountId: validated.accountId,
      accountAddress: validated.accountAddress,
      networkId: network.networkId,
      networkName: network.displayName,
      chainId: network.chainId,
      generatedAt: portfolio.refreshedAtMs,
      totalAssetCount: viewAssets.length,
      visibleAssetCount: viewAssets.filter(
        (asset) => asset.visibility === 'visible',
      ).length,
      assets: Object.freeze(viewAssets),
      warnings: Object.freeze(warnings),
      state: readModelState(viewAssets, warnings),
    });
  }
}
