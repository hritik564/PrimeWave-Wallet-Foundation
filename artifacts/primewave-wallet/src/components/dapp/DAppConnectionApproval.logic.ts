import {
  assertDAppApprovalCheckpoint,
  toDAppApprovalViewModel,
  type DAppApprovalContext,
  type DAppApprovalViewModel,
} from '@/src/core/dapp';
import type {
  DAppIdentity,
  DAppSession,
  DAppSessionProposal,
} from '@/src/core/dapp';
import type { NetworkRegistry } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';

export interface DAppApprovalSnapshot {
  readonly proposal: DAppSessionProposal;
  readonly viewModel: DAppApprovalViewModel;
  readonly context: DAppApprovalContext;
}

export function createDAppApprovalSnapshot(
  proposal: DAppSessionProposal,
  wallet: Wallet,
  networkRegistry: NetworkRegistry,
  context: DAppApprovalContext,
): DAppApprovalSnapshot {
  return Object.freeze({
    proposal,
    viewModel: toDAppApprovalViewModel(proposal, wallet, networkRegistry),
    context: Object.freeze({ ...context }),
  });
}

export function validateDAppApproval(
  snapshot: DAppApprovalSnapshot,
  currentContext: DAppApprovalContext,
  now = Date.now(),
): void {
  assertDAppApprovalCheckpoint(
    snapshot.proposal,
    snapshot.context,
    currentContext,
    now,
  );
}

export function dappIdentityChanged(
  original: DAppIdentity,
  current: DAppIdentity,
): boolean {
  return (
    original.dappId !== current.dappId ||
    original.name !== current.name ||
    original.url !== current.url ||
    original.origin !== current.origin
  );
}

export function connectedNetworks(session: DAppSession): readonly string[] {
  return session.approvedNetworkIds;
}