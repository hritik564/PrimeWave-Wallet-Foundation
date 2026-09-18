import { encodeFunctionData } from 'viem';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type { EvmNetwork } from '@/src/core/networks';
import {
  computeSwapReviewDigest,
  SwapReviewError,
  SwapReviewService,
  type SwapReviewApproval,
  type SwapReviewInput,
  type SwapReviewSnapshot,
} from '../review';
import {
  getSwapAllowanceState,
  type SwapAllowanceRequirement,
} from '../models';
import type { TransactionPreview } from '@/src/core/transactions/construction';
import { SwapExecutionError } from './errors';
import type {
  SwapExecutionConstructionDependency,
  SwapExecutionInput,
  SwapExecutionPlan,
} from './models';

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

function fail(code: ConstructorParameters<typeof SwapExecutionError>[0]): never {
  throw new SwapExecutionError(code);
}

function safeAddress(value: string): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    return fail('SWAP_EXECUTION_APPROVAL_TARGET_INVALID');
  }
}

function mapReviewError(error: unknown): SwapExecutionError {
  if (error instanceof SwapExecutionError) return error;
  if (error instanceof SwapReviewError) {
    if (error.code === 'SWAP_REVIEW_QUOTE_EXPIRED') {
      return new SwapExecutionError('SWAP_EXECUTION_QUOTE_EXPIRED');
    }
    if (
      error.code === 'SWAP_REVIEW_NETWORK_MISMATCH' ||
      error.code === 'SWAP_REVIEW_CHAIN_MISMATCH'
    ) {
      return new SwapExecutionError('SWAP_EXECUTION_NETWORK_CHANGED');
    }
    if (error.code === 'SWAP_REVIEW_ACCOUNT_MISMATCH' || error.code === 'SWAP_REVIEW_SENDER_MISMATCH') {
      return new SwapExecutionError('SWAP_EXECUTION_ACCOUNT_MISMATCH');
    }
    if (error.code === 'SWAP_REVIEW_ALLOWANCE_UNSUPPORTED' || error.code === 'SWAP_REVIEW_ALLOWANCE_UNAVAILABLE') {
      return new SwapExecutionError('SWAP_EXECUTION_ALLOWANCE_UNAVAILABLE');
    }
    return new SwapExecutionError('SWAP_EXECUTION_REVIEW_STALE');
  }
  return new SwapExecutionError('SWAP_EXECUTION_CONSTRUCTION_FAILED');
}

function comparable(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

function assertExecutionContext(input: SwapExecutionInput): void {
  const { review, approval, current, accountId, network, activeNetworkId } = input;
  if (activeNetworkId !== network.id) fail('SWAP_EXECUTION_NETWORK_CHANGED');
  if (network.chainId === null || review.networkId !== network.id || review.chainId !== BigInt(network.chainId)) {
    fail('SWAP_EXECUTION_CHAIN_MISMATCH');
  }
  if (review.accountId !== accountId || approval.accountId !== accountId || current.account.accountId !== accountId) {
    fail('SWAP_EXECUTION_ACCOUNT_MISMATCH');
  }
  if (review.reviewDigest !== computeSwapReviewDigest(review)) {
    fail('SWAP_EXECUTION_REVIEW_STALE');
  }
  if (
    approval.reviewDigest !== review.reviewDigest ||
    approval.quoteId !== review.quoteId ||
    approval.providerId !== review.providerId ||
    approval.senderAddress !== review.senderAddress ||
    approval.networkId !== review.networkId ||
    approval.chainId !== review.chainId ||
    approval.sellAmount !== review.sellAmount ||
    approval.expectedBuyAmount !== review.expectedBuyAmount ||
    approval.minimumBuyAmount !== review.minimumBuyAmount ||
    approval.slippageBps !== review.slippageBps ||
    comparable(approval.sellAsset) !== comparable(review.sellAsset.identity) ||
    comparable(approval.buyAsset) !== comparable(review.buyAsset.identity) ||
    comparable(approval.transactionRequest) !== comparable(review.transactionRequest) ||
    comparable(approval.allowanceRequirement) !== comparable(review.allowanceRequirement) ||
    approval.allowanceState !== review.allowanceState
  ) {
    fail('SWAP_EXECUTION_REVIEW_STALE');
  }
}

function assertProviderTransaction(
  preview: TransactionPreview,
  review: SwapReviewSnapshot,
  network: EvmNetwork,
): void {
  const request = review.transactionRequest;
  const unsigned = preview.unsignedTransaction;
  if (
    preview.networkId !== network.id ||
    preview.chainId !== BigInt(network.chainId as number) ||
    unsigned.networkId !== network.id ||
    unsigned.chainId !== BigInt(network.chainId as number) ||
    unsigned.from.toLowerCase() !== review.senderAddress.toLowerCase() ||
    unsigned.to.toLowerCase() !== request.to.toLowerCase() ||
    unsigned.value !== request.value ||
    unsigned.data !== request.data ||
    (request.gasLimit !== null && unsigned.gasLimit !== request.gasLimit)
  ) {
    fail('SWAP_EXECUTION_PROVIDER_TRANSACTION_CHANGED');
  }
}

function approvalRequirement(review: SwapReviewSnapshot): SwapAllowanceRequirement {
  const requirement = review.allowanceRequirement;
  if (
    !requirement ||
    review.sellAsset.assetType !== 'fungible_token' ||
    !review.sellAsset.contractAddress
  ) {
    return fail('SWAP_EXECUTION_APPROVAL_TARGET_INVALID');
  }
  safeAddress(requirement.spender);
  if (requirement.requiredAmount <= 0n) {
    return fail('SWAP_EXECUTION_APPROVAL_AMOUNT_INVALID');
  }
  if (requirement.asset.networkId !== review.networkId || requirement.asset.assetId !== review.sellAsset.identity.assetId) {
    return fail('SWAP_EXECUTION_APPROVAL_TARGET_INVALID');
  }
  return requirement;
}

async function constructSwapTransaction(
  review: SwapReviewSnapshot,
  dependency: SwapExecutionConstructionDependency,
): Promise<TransactionPreview> {
  try {
    const preview = await dependency.construct({
      networkId: review.networkId,
      from: review.senderAddress,
      to: review.transactionRequest.to,
      value: review.transactionRequest.value,
      data: review.transactionRequest.data,
      gasLimit: review.transactionRequest.gasLimit ?? undefined,
      transactionType: 'contract-call',
    });
    assertProviderTransaction(preview, review, dependency.getNetwork());
    return preview;
  } catch (error) {
    if (error instanceof SwapExecutionError) throw error;
    throw mapReviewError(error);
  }
}

async function constructApprovalTransaction(
  review: SwapReviewSnapshot,
  dependency: SwapExecutionConstructionDependency,
): Promise<TransactionPreview> {
  const requirement = approvalRequirement(review);
  const tokenContract = safeAddress(review.sellAsset.contractAddress as string);
  const spender = safeAddress(requirement.spender);
  try {
    return await dependency.construct({
      networkId: review.networkId,
      from: review.senderAddress,
      to: tokenContract,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [spender as `0x${string}`, requirement.requiredAmount],
      }),
      transactionType: 'contract-call',
    });
  } catch (error) {
    if (error instanceof SwapExecutionError) throw error;
    throw new SwapExecutionError('SWAP_EXECUTION_CONSTRUCTION_FAILED');
  }
}

export class SwapExecutionService {
  constructor(private readonly reviewService: SwapReviewService) {}

  async prepare(input: SwapExecutionInput): Promise<SwapExecutionPlan> {
    try {
      if (input.previewMode) {
        fail('SWAP_EXECUTION_PREVIEW_BLOCKED');
      }
      assertExecutionContext(input);
      const refreshedApproval = this.reviewService.approveReview({
        review: input.review,
        current: input.current,
      });
      if (refreshedApproval.reviewDigest !== input.approval.reviewDigest) {
        fail('SWAP_EXECUTION_REVIEW_STALE');
      }
      const allowanceState = getSwapAllowanceState(
        input.review.sellAsset.identity,
        input.review.allowanceRequirement,
      );
      if (allowanceState === 'unavailable') {
        fail('SWAP_EXECUTION_ALLOWANCE_UNAVAILABLE');
      }
      const approvalRequired = allowanceState === 'insufficient';
      const swapTransaction = await constructSwapTransaction(
        input.review,
        input.constructionEngine,
      );
      const approvalTransaction = approvalRequired
        ? await constructApprovalTransaction(input.review, input.constructionEngine)
        : null;
      return Object.freeze({
        review: input.review,
        approval: input.approval,
        allowanceState,
        approvalRequired,
        approvalTransaction,
        swapTransaction,
      });
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  assertApprovalStillBound(
    plan: SwapExecutionPlan,
    approvalTransaction: TransactionPreview,
  ): void {
    const requirement = approvalRequirement(plan.review);
    const unsigned = approvalTransaction.unsignedTransaction;
    const expected = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [
        safeAddress(requirement.spender) as `0x${string}`,
        requirement.requiredAmount,
      ],
    });
    if (
      plan.allowanceState !== 'insufficient' ||
      unsigned.from.toLowerCase() !== plan.review.senderAddress.toLowerCase() ||
      unsigned.to.toLowerCase() !== safeAddress(plan.review.sellAsset.contractAddress as string).toLowerCase() ||
      unsigned.value !== 0n ||
      unsigned.data !== expected
    ) {
      fail('SWAP_EXECUTION_APPROVAL_TRANSACTION_MISMATCH');
    }
  }

  assertSwapStillBound(
    plan: SwapExecutionPlan,
    swapTransaction: TransactionPreview,
  ): void {
    assertProviderTransaction(
      swapTransaction,
      plan.review,
      {
        ...({} as EvmNetwork),
        id: plan.review.networkId,
        chainId: Number(plan.review.chainId),
      },
    );
  }
}