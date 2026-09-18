import type { EvmNetwork } from '@/src/core/networks';
import type {
  TransactionPreview,
  TransactionIntent,
} from '@/src/core/transactions/construction';
import type {
  TransactionSigningAuthorization,
  SignedTransaction,
} from '@/src/core/transactions/signing';
import type {
  BroadcastResult,
  ConfirmationResult,
} from '@/src/core/transactions/broadcast';
import type {
  SwapAllowanceState,
} from '../models';
import type {
  SwapReviewApproval,
  SwapReviewInput,
  SwapReviewSnapshot,
} from '../review';

export interface SwapExecutionConstructionDependency {
  readonly getNetwork: () => EvmNetwork;
  readonly construct: (intent: TransactionIntent) => Promise<TransactionPreview>;
}

export interface SwapExecutionSigningDependency {
  readonly sign: (
    transaction: TransactionPreview['unsignedTransaction'],
    authorization: TransactionSigningAuthorization,
  ) => Promise<SignedTransaction>;
}

export interface SwapExecutionBroadcastDependency {
  readonly broadcast: (signed: SignedTransaction) => Promise<BroadcastResult>;
  readonly confirm: (broadcast: BroadcastResult) => Promise<ConfirmationResult>;
}

export interface SwapExecutionInput {
  readonly review: SwapReviewSnapshot;
  readonly approval: SwapReviewApproval;
  readonly current: SwapReviewInput;
  readonly accountId: string;
  readonly network: EvmNetwork;
  readonly activeNetworkId: string | null;
  readonly constructionEngine: SwapExecutionConstructionDependency;
  readonly previewMode?: boolean;
}

export interface SwapExecutionPlan {
  readonly review: SwapReviewSnapshot;
  readonly approval: SwapReviewApproval;
  readonly allowanceState: SwapAllowanceState;
  readonly approvalRequired: boolean;
  readonly approvalTransaction: TransactionPreview | null;
  readonly swapTransaction: TransactionPreview;
}