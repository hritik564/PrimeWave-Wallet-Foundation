import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { AssetError, formatAssetAmount, parseAssetAmount } from '@/src/core/assets';
import type { AssetIdentity } from '@/src/core/assets';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel } from '@/src/core/portfolio';

export type RecipientValidation =
  | { readonly state: 'empty'; readonly message: null; readonly normalized: null }
  | { readonly state: 'typing'; readonly message: null; readonly normalized: null }
  | { readonly state: 'valid' | 'normalized'; readonly message: null; readonly normalized: string }
  | { readonly state: 'invalid'; readonly message: string; readonly normalized: null };

export type AmountValidation =
  | { readonly state: 'empty'; readonly message: string; readonly rawAmount: null }
  | { readonly state: 'valid'; readonly message: null; readonly rawAmount: bigint }
  | { readonly state: 'invalid'; readonly message: string; readonly rawAmount: null };

export interface PublicSendDraft {
  readonly accountId: string;
  readonly senderPublicAddress: string;
  readonly networkId: string;
  readonly selectedAssetIdentity: AssetIdentity;
  readonly recipient: string;
  readonly amount: string;
  readonly tokenContractAddress?: string;
}

export function assetIdentityKey(identity: AssetIdentity): string {
  return `${identity.networkId}:${identity.assetType}:${identity.assetId}`;
}

export function isSendableAsset(
  asset: PortfolioAssetViewModel,
  network: EvmNetwork,
): boolean {
  return (
    asset.networkId === network.id &&
    asset.identity.networkId === network.id &&
    (asset.assetType === 'native' || asset.assetType === 'fungible_token')
  );
}

export function getSendableAssets(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
): readonly PortfolioAssetViewModel[] {
  return assets.filter((asset) => isSendableAsset(asset, network));
}

export function selectDefaultSendAsset(
  assets: readonly PortfolioAssetViewModel[],
  network: EvmNetwork,
): PortfolioAssetViewModel | null {
  const sendable = getSendableAssets(assets, network);
  return (
    sendable.find((asset) => asset.assetType === 'native') ??
    sendable[0] ??
    null
  );
}

export function validateRecipient(input: string): RecipientValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { state: 'empty', message: null, normalized: null };
  }
  if (trimmed.length < 42) {
    return { state: 'typing', message: null, normalized: null };
  }
  try {
    const normalized = normalizePublicEvmAddress(trimmed);
    return {
      state: normalized === trimmed ? 'valid' : 'normalized',
      message: null,
      normalized,
    };
  } catch {
    return {
      state: 'invalid',
      message: 'Enter a valid EVM address.',
      normalized: null,
    };
  }
}

export function validateAmount(
  input: string,
  decimals: number | null,
  availableBalance: bigint | null,
): AmountValidation {
  if (input.length === 0) {
    return { state: 'empty', message: 'Enter an amount.', rawAmount: null };
  }
  if (decimals === null || availableBalance === null) {
    return {
      state: 'invalid',
      message: 'The selected balance is unavailable.',
      rawAmount: null,
    };
  }
  try {
    const rawAmount = parseAssetAmount(input, decimals);
    if (rawAmount === 0n) {
      return { state: 'invalid', message: 'Amount must be greater than zero.', rawAmount: null };
    }
    if (rawAmount > availableBalance) {
      return { state: 'invalid', message: 'Amount exceeds the available balance.', rawAmount: null };
    }
    return { state: 'valid', message: null, rawAmount };
  } catch (error) {
    if (error instanceof AssetError && error.code === 'DECIMAL_OVERFLOW') {
      return { state: 'invalid', message: `Use no more than ${decimals} decimal places.`, rawAmount: null };
    }
    return { state: 'invalid', message: 'Enter a valid amount.', rawAmount: null };
  }
}

export function validateSendForm({
  network,
  asset,
  recipient,
  amount,
}: {
  readonly network: EvmNetwork;
  readonly asset: PortfolioAssetViewModel | null;
  readonly recipient: string;
  readonly amount: string;
}): {
  readonly recipient: RecipientValidation;
  readonly amount: AmountValidation;
  readonly message: string | null;
  readonly canReview: boolean;
} {
  const recipientResult = validateRecipient(recipient);
  const networkAvailable =
    network.enabled &&
    network.configurationStatus === 'configured' &&
    network.chainId !== null;
  const assetAvailable =
    asset !== null &&
    isSendableAsset(asset, network) &&
    asset.availabilityState === 'available' &&
    asset.rawBalance !== null &&
    asset.decimals !== null;
  const amountResult = validateAmount(
    amount,
    asset?.decimals ?? null,
    asset?.rawBalance ?? null,
  );

  let message: string | null = null;
  if (!networkAvailable) message = 'This network is unavailable for sending.';
  else if (!asset) message = 'Select an asset to continue.';
  else if (!assetAvailable) message = 'The selected asset is unavailable.';
  else if (recipientResult.state === 'empty') message = 'Enter a recipient address.';
  else if (recipientResult.state === 'invalid') message = recipientResult.message;
  else if (recipientResult.state === 'typing') message = 'Finish entering the recipient address.';
  else if (amountResult.state !== 'valid') message = amountResult.message;

  return {
    recipient: recipientResult,
    amount: amountResult,
    message,
    canReview:
      message === null &&
      recipientResult.normalized !== null &&
      amountResult.state === 'valid',
  };
}

export function createPublicSendDraft({
  accountId,
  senderPublicAddress,
  network,
  asset,
  recipient,
  amount,
}: {
  readonly accountId: string;
  readonly senderPublicAddress: string;
  readonly network: EvmNetwork;
  readonly asset: PortfolioAssetViewModel;
  readonly recipient: string;
  readonly amount: string;
}): PublicSendDraft {
  const validation = validateSendForm({ network, asset, recipient, amount });
  if (!validation.canReview || !validation.recipient.normalized) {
    throw new Error('SEND_DRAFT_INVALID');
  }
  const draft: PublicSendDraft = {
    accountId,
    senderPublicAddress,
    networkId: network.id,
    selectedAssetIdentity: asset.identity,
    recipient: validation.recipient.normalized,
    amount,
    ...(asset.contractAddress !== null
      ? { tokenContractAddress: asset.contractAddress }
      : {}),
  };
  return Object.freeze(draft);
}

export function formatMaxAmount(asset: PortfolioAssetViewModel | null): string {
  if (asset?.rawBalance === null || asset?.rawBalance === undefined || asset.decimals === null) {
    return '';
  }
  return formatAssetAmount(asset.rawBalance, asset.decimals);
}