import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';
import { DAppError } from './errors';
import {
  type DAppCapability,
  type DAppIdentity,
  type DAppSessionProposal,
} from './models';

export type DAppApprovalStatus =
  | 'none'
  | 'received'
  | 'reviewing'
  | 'approving'
  | 'rejecting'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'stale'
  | 'failed';

export interface DAppApprovalNetwork {
  readonly networkId: string;
  readonly displayName: string;
  readonly chainId: bigint;
  readonly enabled: boolean;
  readonly configurationStatus: EvmNetwork['configurationStatus'];
}

export interface DAppApprovalViewModel {
  readonly proposalId: string;
  readonly identity: DAppIdentity;
  readonly accountId: string;
  readonly accountAddress: string;
  readonly requestedNetworks: readonly DAppApprovalNetwork[];
  readonly requestedCapabilities: readonly DAppCapability[];
  readonly unsupportedCapabilities: readonly DAppCapability[];
  readonly expiresAt: number | null;
}

export interface DAppApprovalContext {
  readonly accountId: string;
  readonly walletAddress: string;
  readonly networkId: string;
  readonly chainId: bigint;
}

const supportedConnectionCapabilities: readonly DAppCapability[] = [
  'account-access',
  'network-access',
];

export function dappCapabilityLabel(capability: DAppCapability): string {
  switch (capability) {
    case 'account-access':
      return 'View wallet address';
    case 'network-access':
      return 'Access selected network(s)';
    case 'message-signing':
      return 'Message signing (not available in this phase)';
    case 'transaction-signing':
      return 'Transaction signing (not available in this phase)';
  }
}

export function toDAppApprovalViewModel(
  proposal: DAppSessionProposal,
  wallet: Wallet,
  registry: NetworkRegistry,
): DAppApprovalViewModel {
  const account = wallet.accounts.find(
    (entry) => entry.accountId === wallet.accounts[0]?.accountId,
  );
  if (!account) {
    throw new DAppError('ACCOUNT_MISMATCH', 'The wallet account is unavailable.');
  }

  const requestedNetworks = proposal.requestedNetworkIds.map((networkId, index) => {
    const network = registry.getById(networkId);
    const chainId = proposal.requestedChainIds[index];
    if (
      !network ||
      chainId === undefined ||
      !network.enabled ||
      network.configurationStatus !== 'configured' ||
      network.chainId !== Number(chainId)
    ) {
      throw new DAppError(
        'PROVIDER_UNSUPPORTED_CHAIN',
        'The proposal requests an unavailable network.',
      );
    }
    return Object.freeze({
      networkId,
      displayName: network.displayName,
      chainId,
      enabled: network.enabled,
      configurationStatus: network.configurationStatus,
    });
  });

  return Object.freeze({
    proposalId: proposal.proposalId,
    identity: proposal.identity,
    accountId: account.accountId,
    accountAddress: normalizePublicEvmAddress(account.address),
    requestedNetworks: Object.freeze(requestedNetworks),
    requestedCapabilities: proposal.requestedCapabilities,
    unsupportedCapabilities: Object.freeze(
      proposal.requestedCapabilities.filter(
        (capability) => !supportedConnectionCapabilities.includes(capability),
      ),
    ),
    expiresAt: proposal.expiresAt,
  });
}

export function assertDAppApprovalCheckpoint(
  proposal: DAppSessionProposal,
  context: DAppApprovalContext,
  currentContext: DAppApprovalContext,
  now = Date.now(),
): void {
  if (proposal.expiresAt !== null && proposal.expiresAt <= now) {
    throw new DAppError(
      'PROVIDER_SESSION_EXPIRED',
      'This DApp connection request has expired. Request a new connection.',
    );
  }
  if (
    context.accountId !== currentContext.accountId ||
    normalizePublicEvmAddress(context.walletAddress) !==
      normalizePublicEvmAddress(currentContext.walletAddress)
  ) {
    throw new DAppError(
      'ACCOUNT_MISMATCH',
      'The wallet account changed while this request was open.',
    );
  }
  if (
    context.networkId !== currentContext.networkId ||
    context.chainId !== currentContext.chainId
  ) {
    throw new DAppError(
      'NETWORK_MISMATCH',
      'The active wallet network changed while this request was open.',
    );
  }
}