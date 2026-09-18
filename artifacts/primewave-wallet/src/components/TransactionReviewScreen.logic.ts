import { encodeFunctionData } from 'viem';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { formatNativeUnits } from '@/src/core/blockchain/gas-fee';
import { parseAssetAmount } from '@/src/core/assets';
import type { AssetIdentity } from '@/src/core/assets';
import type { EvmNetwork } from '@/src/core/networks';
import type {
  TransactionIntent,
  TransactionPreview,
  UnsignedTransaction,
} from '@/src/core/transactions/construction';
import type {
  CreateTransactionSigningAuthorizationInput,
  SignedTransaction,
  TransactionSigningAuthorization,
} from '@/src/core/transactions/signing';
import type {
  BroadcastResult,
  ConfirmationResult,
  TransactionLookupResult,
} from '@/src/core/transactions/broadcast';
import type {
  AuthenticationResult,
  BiometricAvailability,
} from '@/src/core/security';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import type {
  ActivityDraftInput,
  ActivityRecord,
  ActivityService,
} from '@/src/core/activity';
import {
  assetIdentityKey,
  validateRecipient,
  type PublicSendDraft,
} from './WalletSendScreen.logic';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

export interface TransactionConstructionDependency {
  readonly getNetwork: () => EvmNetwork;
  readonly construct: (intent: TransactionIntent) => Promise<TransactionPreview>;
}

export interface TransactionSigningDependency {
  readonly getBiometricAvailability: () => Promise<BiometricAvailability>;
  readonly authenticateWithPin: (pin: string) => Promise<AuthenticationResult>;
  readonly authenticateWithBiometrics: () => Promise<AuthenticationResult>;
  readonly sign: (
    transaction: UnsignedTransaction,
    authorization: TransactionSigningAuthorization,
  ) => Promise<SignedTransaction>;
}

export interface TransactionBroadcastDependency {
  readonly broadcast: (signed: SignedTransaction) => Promise<BroadcastResult>;
  readonly confirm: (broadcast: BroadcastResult) => Promise<ConfirmationResult>;
  readonly lookup: (broadcast: BroadcastResult) => Promise<TransactionLookupResult>;
}

export interface TransactionActivityDependency
  extends Pick<
    ActivityService,
    | 'createDraft'
    | 'recordSigned'
    | 'recordBroadcasting'
    | 'recordBroadcast'
    | 'recordConfirmation'
    | 'recordFailed'
  > {
  readonly createDraft: (input: ActivityDraftInput) => ActivityRecord;
}

export type ReviewErrorCode =
  | 'NETWORK_NOT_FOUND'
  | 'NETWORK_UNAVAILABLE'
  | 'NETWORK_CHANGED'
  | 'CHAIN_ID_MISMATCH'
  | 'ASSET_MISMATCH'
  | 'INVALID_RECIPIENT'
  | 'INVALID_AMOUNT'
  | 'BALANCE_UNAVAILABLE'
  | 'INSUFFICIENT_NATIVE_BALANCE'
  | 'INSUFFICIENT_TOKEN_BALANCE'
  | 'FEE_UNAVAILABLE'
  | 'CONSTRUCTION_FAILED'
  | 'STALE_REVIEW'
  | 'BROADCAST_NETWORK_CHANGED'
  | 'BROADCAST_ACCOUNT_CHANGED'
  | 'BROADCAST_CONTEXT_MISMATCH'
  | 'UNSUPPORTED_STATE';

const REVIEW_MESSAGES: Record<ReviewErrorCode, string> = {
  NETWORK_NOT_FOUND: 'The selected network is no longer registered. Return to Send.',
  NETWORK_UNAVAILABLE: 'This network is unavailable for transaction review. Return to Send.',
  NETWORK_CHANGED: 'The selected network changed. Review the transaction again.',
  CHAIN_ID_MISMATCH: 'The network chain ID could not be verified. Return to Send.',
  ASSET_MISMATCH: 'The selected asset does not belong to this network. Return to Send.',
  INVALID_RECIPIENT: 'The recipient address is no longer valid. Return to Send.',
  INVALID_AMOUNT: 'The amount is no longer valid. Return to Send.',
  BALANCE_UNAVAILABLE: 'The required public balance is unavailable. Return to Send.',
  INSUFFICIENT_NATIVE_BALANCE: 'The native balance does not cover the transfer and maximum network fee.',
  INSUFFICIENT_TOKEN_BALANCE: 'The token balance does not cover this transfer.',
  FEE_UNAVAILABLE: 'Network fee data is unavailable. No review was prepared.',
  CONSTRUCTION_FAILED: 'The unsigned transaction could not be prepared.',
  STALE_REVIEW: 'The reviewed transaction changed. Review it again before confirming.',
  BROADCAST_NETWORK_CHANGED: 'The selected network changed. This transaction was not broadcast.',
  BROADCAST_ACCOUNT_CHANGED: 'The active account changed. This transaction was not broadcast.',
  BROADCAST_CONTEXT_MISMATCH: 'The signed transaction no longer matches the reviewed transaction.',
  UNSUPPORTED_STATE: 'This transaction state is not supported for review.',
};

export class TransactionReviewError extends Error {
  constructor(public readonly code: ReviewErrorCode) {
    super(REVIEW_MESSAGES[code]);
    this.name = 'TransactionReviewError';
  }
}

export interface ReviewPreparationInput {
  readonly draft: PublicSendDraft;
  readonly account: {
    readonly accountId: string;
    readonly address: string;
  };
  readonly network: EvmNetwork | null;
  readonly registeredNetwork: EvmNetwork | undefined;
  readonly activeNetworkId: string | null;
  readonly portfolio: PortfolioReadModel | null;
  readonly constructionEngine: TransactionConstructionDependency | null;
}

export interface PreparedTransactionReview {
  readonly draft: PublicSendDraft;
  readonly asset: PortfolioAssetViewModel;
  readonly preview: TransactionPreview;
  readonly rawAmount: bigint;
  readonly nativeBalance: bigint;
  readonly tokenBalance: bigint | null;
  readonly warnings: readonly string[];
  readonly reviewContextKey: string;
}

export interface PublicReviewConfirmationResult {
  readonly status: 'confirmed-for-signing';
  readonly accountId: string;
  readonly senderPublicAddress: string;
  readonly networkId: string;
  readonly selectedAssetIdentity: AssetIdentity;
  readonly recipient: string;
  readonly amount: string;
  readonly feeModel: TransactionPreview['feeModel'];
  readonly unsignedTransactionIdentity: string;
}

export function createReviewSigningAuthorization(
  review: PreparedTransactionReview,
): CreateTransactionSigningAuthorizationInput {
  return {
    accountId: review.draft.accountId,
    transaction: review.preview.unsignedTransaction,
    requestId: `wavex-review:${review.reviewContextKey}`,
  };
}

export function assertSignedTransactionContext(input: {
  readonly signed: SignedTransaction;
  readonly review: PreparedTransactionReview;
  readonly network: EvmNetwork;
  readonly activeNetworkId: string | null;
}): void {
  const { signed, review, network, activeNetworkId } = input;
  const unsigned = review.preview.unsignedTransaction;
  if (
    activeNetworkId !== network.id ||
    network.configurationStatus !== 'configured' ||
    network.chainId === null ||
    signed.networkId !== network.id ||
    signed.chainId !== BigInt(network.chainId)
  ) {
    throw new TransactionReviewError('BROADCAST_NETWORK_CHANGED');
  }
  if (signed.from.toLowerCase() !== unsigned.from.toLowerCase()) {
    throw new TransactionReviewError('BROADCAST_ACCOUNT_CHANGED');
  }
  if (signed.transactionType !== unsigned.transactionType) {
    throw new TransactionReviewError('BROADCAST_CONTEXT_MISMATCH');
  }
}

export function createTransactionExplorerUrl(
  network: EvmNetwork,
  transactionHash: string,
): string | null {
  if (
    network.configurationStatus !== 'configured' ||
    network.chainId === null ||
    network.explorer.baseUrl === null ||
    network.explorer.transactionUrlTemplate === null ||
    !/^0x[0-9a-f]{64}$/i.test(transactionHash)
  ) {
    return null;
  }
  try {
    const url = new URL(
      network.explorer.transactionUrlTemplate.replace(
        '{txHash}',
        encodeURIComponent(transactionHash),
      ),
    );
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fail(code: ReviewErrorCode): never {
  throw new TransactionReviewError(code);
}

function normalizedAddress(address: string, code: ReviewErrorCode): string {
  try {
    return normalizePublicEvmAddress(address);
  } catch {
    return fail(code);
  }
}

function reviewContextKey(
  draft: PublicSendDraft,
  account: { readonly accountId: string; readonly address: string },
  network: EvmNetwork,
  asset: PortfolioAssetViewModel,
): string {
  return JSON.stringify({
    accountId: account.accountId,
    sender: normalizedAddress(account.address, 'UNSUPPORTED_STATE'),
    draftAccountId: draft.accountId,
    draftSender: draft.senderPublicAddress,
    networkId: network.id,
    chainId: network.chainId,
    asset: assetIdentityKey(asset.identity),
    contractAddress: asset.contractAddress,
    recipient: draft.recipient,
    amount: draft.amount,
  });
}

function findReviewAsset(
  draft: PublicSendDraft,
  network: EvmNetwork,
  portfolio: PortfolioReadModel | null,
): PortfolioAssetViewModel {
  const asset = portfolio?.assets.find(
    (candidate) =>
      assetIdentityKey(candidate.identity) ===
      assetIdentityKey(draft.selectedAssetIdentity),
  );
  if (!asset || asset.networkId !== network.id || asset.identity.networkId !== network.id) {
    return fail('ASSET_MISMATCH');
  }

  if (asset.assetType === 'native') {
    if (
      asset.identity.assetId !== 'native' ||
      asset.contractAddress !== null ||
      asset.symbol !== network.nativeCurrency.symbol ||
      asset.decimals !== network.nativeCurrency.decimals
    ) {
      return fail('ASSET_MISMATCH');
    }
  } else if (
    asset.assetType !== 'fungible_token' ||
    asset.contractAddress === null ||
    draft.tokenContractAddress !== asset.contractAddress
  ) {
    return fail('ASSET_MISMATCH');
  }

  if (asset.availabilityState !== 'available' || asset.decimals === null) {
    return fail('ASSET_MISMATCH');
  }
  return asset;
}

function buildIntent(
  draft: PublicSendDraft,
  account: { readonly accountId: string; readonly address: string },
  network: EvmNetwork,
  asset: PortfolioAssetViewModel,
): { readonly intent: TransactionIntent; readonly rawAmount: bigint; readonly recipient: string } {
  if (draft.accountId !== account.accountId) return fail('NETWORK_CHANGED');
  const sender = normalizedAddress(account.address, 'UNSUPPORTED_STATE');
  if (normalizedAddress(draft.senderPublicAddress, 'UNSUPPORTED_STATE') !== sender) {
    return fail('STALE_REVIEW');
  }

  const recipientState = validateRecipient(draft.recipient);
  if (!recipientState.normalized) return fail('INVALID_RECIPIENT');
  let rawAmount: bigint;
  try {
    rawAmount = parseAssetAmount(draft.amount, asset.decimals ?? 0);
  } catch {
    return fail('INVALID_AMOUNT');
  }
  if (rawAmount === 0n) return fail('INVALID_AMOUNT');

  if (asset.assetType === 'native') {
    return {
      rawAmount,
      recipient: recipientState.normalized,
      intent: {
        networkId: network.id,
        from: sender,
        to: recipientState.normalized,
        value: rawAmount,
        transactionType: 'native-transfer',
      },
    };
  }

  if (!asset.contractAddress) return fail('ASSET_MISMATCH');
  return {
    rawAmount,
    recipient: recipientState.normalized,
    intent: {
      networkId: network.id,
      from: sender,
      to: asset.contractAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [recipientState.normalized as `0x${string}`, rawAmount],
      }),
      transactionType: 'contract-call',
    },
  };
}

function mapConstructionError(error: unknown): TransactionReviewError {
  if (error instanceof TransactionReviewError) return error;
  const code = error instanceof Error && 'code' in error
    ? String((error as Error & { code?: unknown }).code)
    : '';
  if (code.includes('FEE') || code.includes('GAS') || code.includes('RPC')) {
    return new TransactionReviewError('FEE_UNAVAILABLE');
  }
  if (code.includes('CHAIN')) return new TransactionReviewError('CHAIN_ID_MISMATCH');
  if (code.includes('NETWORK')) return new TransactionReviewError('NETWORK_CHANGED');
  return new TransactionReviewError('CONSTRUCTION_FAILED');
}

function assertConstructedPreview(
  preview: TransactionPreview,
  intent: TransactionIntent,
  network: EvmNetwork,
): void {
  const unsigned = preview.unsignedTransaction;
  const expectedValue = typeof intent.value === 'bigint' ? intent.value : parseAssetAmount(String(intent.value), 0);
  if (
    preview.networkId !== network.id ||
    preview.chainId !== BigInt(network.chainId as number) ||
    unsigned.networkId !== network.id ||
    unsigned.chainId !== BigInt(network.chainId as number) ||
    unsigned.from.toLowerCase() !== String(intent.from).toLowerCase() ||
    unsigned.to.toLowerCase() !== String(intent.to).toLowerCase() ||
    unsigned.value !== expectedValue ||
    (intent.transactionType ?? 'native-transfer') !== unsigned.transactionType ||
    (intent.data ?? '0x').toLowerCase() !== unsigned.data.toLowerCase()
  ) {
    fail('CHAIN_ID_MISMATCH');
  }
}

export async function prepareTransactionReview(
  input: ReviewPreparationInput,
): Promise<PreparedTransactionReview> {
  const { draft, account, network, registeredNetwork, activeNetworkId, portfolio, constructionEngine } = input;
  if (!registeredNetwork) return fail('NETWORK_NOT_FOUND');
  if (!network) return fail('NETWORK_UNAVAILABLE');
  if (
    draft.networkId !== network.id ||
    registeredNetwork.id !== network.id ||
    activeNetworkId !== network.id
  ) {
    return fail('NETWORK_CHANGED');
  }
  if (!network.enabled || network.configurationStatus !== 'configured' || network.chainId === null) {
    return fail('NETWORK_UNAVAILABLE');
  }
  if (!portfolio || portfolio.networkId !== network.id || portfolio.accountId !== account.accountId) {
    return fail('BALANCE_UNAVAILABLE');
  }
  if (!constructionEngine) return fail('NETWORK_UNAVAILABLE');
  const engineNetwork = constructionEngine.getNetwork();
  if (
    engineNetwork.id !== network.id ||
    engineNetwork.chainId === null ||
    engineNetwork.chainId !== network.chainId
  ) {
    return fail('CHAIN_ID_MISMATCH');
  }

  const asset = findReviewAsset(draft, network, portfolio);
  const { intent, rawAmount, recipient } = buildIntent(draft, account, network, asset);
  const nativeAsset = portfolio.assets.find(
    (candidate) =>
      candidate.assetType === 'native' &&
      candidate.networkId === network.id &&
      candidate.identity.networkId === network.id,
  );
  if (!nativeAsset || nativeAsset.rawBalance === null) return fail('BALANCE_UNAVAILABLE');
  if (asset.rawBalance === null) return fail('BALANCE_UNAVAILABLE');
  if (asset.assetType === 'fungible_token' && rawAmount > asset.rawBalance) {
    return fail('INSUFFICIENT_TOKEN_BALANCE');
  }

  let preview: TransactionPreview;
  try {
    preview = await constructionEngine.construct(intent);
  } catch (error) {
    throw mapConstructionError(error);
  }
  assertConstructedPreview(preview, intent, network);

  if (
    asset.assetType === 'native'
      ? preview.totalMaximumNativeAmount > nativeAsset.rawBalance
      : preview.totalMaximumNativeAmount > nativeAsset.rawBalance
  ) {
    return fail('INSUFFICIENT_NATIVE_BALANCE');
  }

  const warnings = [
    ...preview.warnings,
    'Recipient syntax is valid, but the destination has not been independently verified.',
    ...(asset.assetType === 'fungible_token' && asset.verificationStatus !== 'verified'
      ? ['This token is not independently verified.']
      : []),
  ];
  return Object.freeze({
    draft,
    asset,
    preview,
    rawAmount,
    nativeBalance: nativeAsset.rawBalance,
    tokenBalance: asset.assetType === 'fungible_token' ? asset.rawBalance : null,
    warnings: Object.freeze([...new Set(warnings)]),
    reviewContextKey: reviewContextKey(draft, account, network, asset),
  });
}

export function assertReviewStillCurrent({
  review,
  draft,
  account,
  network,
  activeNetworkId,
  asset,
}: {
  readonly review: PreparedTransactionReview;
  readonly draft: PublicSendDraft;
  readonly account: { readonly accountId: string; readonly address: string };
  readonly network: EvmNetwork | null;
  readonly activeNetworkId: string | null;
  readonly asset: PortfolioAssetViewModel | undefined;
}): void {
  if (
    !network ||
    !asset ||
    activeNetworkId !== network.id ||
    draft.networkId !== network.id ||
    draft.accountId !== account.accountId ||
    normalizedAddress(draft.senderPublicAddress, 'STALE_REVIEW') !==
      normalizedAddress(account.address, 'STALE_REVIEW') ||
    assetIdentityKey(asset.identity) !== assetIdentityKey(review.asset.identity) ||
    reviewContextKey(draft, account, network, asset) !== review.reviewContextKey
  ) {
    return fail('STALE_REVIEW');
  }
}

export function createPublicReviewConfirmation(
  review: PreparedTransactionReview,
): PublicReviewConfirmationResult {
  return Object.freeze({
    status: 'confirmed-for-signing',
    accountId: review.draft.accountId,
    senderPublicAddress: review.draft.senderPublicAddress,
    networkId: review.draft.networkId,
    selectedAssetIdentity: review.draft.selectedAssetIdentity,
    recipient: review.draft.recipient,
    amount: review.draft.amount,
    feeModel: review.preview.feeModel,
    unsignedTransactionIdentity: review.preview.unsignedTransaction.canonicalRepresentation,
  });
}

export function displayFeePerGas(preview: TransactionPreview): string {
  return formatNativeUnits(
    preview.feeModel === 'legacy'
      ? preview.gasPrice
      : preview.maxFeePerGas,
    preview.decimals,
  );
}