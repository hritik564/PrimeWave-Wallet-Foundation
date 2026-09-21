import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { DAppError } from '../../errors';
import {
  DAPP_CAPABILITIES,
  type DAppAuthorizationDecision,
  type DAppCapability,
  type DAppIdentity,
  type DAppSessionProposal,
} from '../../models';
import { validateDAppIdentity } from '../../validation';
import type { NetworkRegistry } from '@/src/core/networks';
import type {
  ProposalTypes,
  SessionTypes,
  SignClientTypes,
} from '@walletconnect/types';

export const WALLETCONNECT_PROVIDER_ID = 'walletconnect';
export const EIP155_NAMESPACE = 'eip155';

const SAFE_EVENTS = new Set(['accountsChanged', 'chainChanged']);
const MESSAGE_SIGNING_METHODS = new Set([
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);
const TRANSACTION_SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
]);

export interface WalletConnectMappedProposal {
  readonly proposal: DAppSessionProposal;
  readonly chains: readonly {
    readonly networkId: string;
    readonly chainId: bigint;
  }[];
  readonly requestedEvents: readonly string[];
}

export interface WalletConnectAccount {
  readonly networkId: string;
  readonly chainId: bigint;
  readonly address: string;
}

function fail(code: DAppError['code'], message: string): never {
  throw new DAppError(code, message);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function parseChainId(value: unknown): bigint {
  if (typeof value !== 'string') {
    return fail(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The WalletConnect proposal contains an invalid chain identifier.',
    );
  }
  const [namespace, rawChainId, ...rest] = value.split(':');
  if (
    namespace !== EIP155_NAMESPACE ||
    rest.length > 0 ||
    !/^[0-9]+$/.test(rawChainId ?? '')
  ) {
    return fail(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The WalletConnect proposal contains an unsupported chain namespace.',
    );
  }
  const chainId = BigInt(rawChainId);
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The WalletConnect proposal contains an unsafe chain identifier.',
    );
  }
  return chainId;
}

function mapMetadata(
  metadata: SignClientTypes.Metadata,
  providerSessionId: string,
  proposalId: number,
): DAppIdentity {
  const url = metadata.url;
  let origin: string | null = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  return validateDAppIdentity({
    dappId: `${WALLETCONNECT_PROVIDER_ID}:${proposalId}`,
    name: metadata.name,
    description: metadata.description || null,
    url,
    iconUrl: metadata.icons?.[0] ?? null,
    origin,
    providerSessionId,
    metadataVersion: 'walletconnect-v2',
  });
}

function mergeNamespace(
  required: ProposalTypes.RequiredNamespace | undefined,
  optional: ProposalTypes.OptionalNamespaces[string] | undefined,
): ProposalTypes.RequiredNamespace {
  return {
    chains: [...new Set([
      ...(required?.chains ?? []),
      ...(optional?.chains ?? []),
    ])],
    methods: [...new Set([
      ...(required?.methods ?? []),
      ...(optional?.methods ?? []),
    ])],
    events: [...new Set([
      ...(required?.events ?? []),
      ...(optional?.events ?? []),
    ])],
  };
}

function requestedCapabilities(methods: readonly string[]): readonly DAppCapability[] {
  const capabilities = new Set<DAppCapability>([
    'account-access',
    'network-access',
  ]);
  if (methods.some((method) => MESSAGE_SIGNING_METHODS.has(method))) {
    capabilities.add('message-signing');
  }
  if (methods.some((method) => TRANSACTION_SIGNING_METHODS.has(method))) {
    capabilities.add('transaction-signing');
  }
  return Object.freeze(
    DAPP_CAPABILITIES.filter((capability) => capabilities.has(capability)),
  );
}

export function mapWalletConnectProposal(
  proposal: ProposalTypes.Struct,
  registry: NetworkRegistry,
  now = Date.now(),
): WalletConnectMappedProposal {
  if (!Number.isSafeInteger(proposal.id) || proposal.id < 1) {
    return fail(
      'PROVIDER_MALFORMED_PROPOSAL',
      'The WalletConnect proposal identifier is invalid.',
    );
  }

  const requiredNamespaces = proposal.requiredNamespaces ?? {};
  const optionalNamespaces = proposal.optionalNamespaces ?? {};
  const unsupportedRequiredNamespace = Object.keys(requiredNamespaces).find(
    (namespace) => namespace !== EIP155_NAMESPACE,
  );
  if (unsupportedRequiredNamespace) {
    return fail(
      'PROVIDER_UNSUPPORTED_NAMESPACE',
      'The WalletConnect proposal requires an unsupported namespace.',
    );
  }

  const eip155 = mergeNamespace(
    requiredNamespaces[EIP155_NAMESPACE],
    optionalNamespaces[EIP155_NAMESPACE],
  );
  const chainValues = eip155.chains ?? [];
  if (chainValues.length === 0) {
    return fail(
      'PROVIDER_UNSUPPORTED_CHAIN',
      'The WalletConnect proposal does not contain a concrete EVM chain.',
    );
  }

  const chains = chainValues.map((chainValue) => {
    const chainId = parseChainId(chainValue);
    const network = registry.getByChainId(Number(chainId));
    if (
      !network ||
      !network.enabled ||
      network.configurationStatus !== 'configured'
    ) {
      return fail(
        'PROVIDER_UNSUPPORTED_CHAIN',
        'The WalletConnect proposal requests a network that is unavailable.',
      );
    }
    return Object.freeze({ networkId: network.id, chainId });
  });

  const expiresAt =
    Number.isSafeInteger(proposal.expiryTimestamp) &&
    proposal.expiryTimestamp * 1_000 > now
      ? proposal.expiryTimestamp * 1_000
      : null;
  if (expiresAt === null) {
    return fail(
      'PROVIDER_SESSION_EXPIRED',
      'The WalletConnect proposal has expired.',
    );
  }

  const identity = mapMetadata(
    proposal.proposer.metadata,
    proposal.pairingTopic,
    proposal.id,
  );
  const requestedCapabilities = requestedCapabilitiesForNamespace(eip155.methods);
  return {
    proposal: Object.freeze({
      proposalId: String(proposal.id),
      providerId: WALLETCONNECT_PROVIDER_ID,
      identity,
      requestedNetworkIds: uniqueStrings(chains.map((chain) => chain.networkId)),
      requestedChainIds: Object.freeze(
        [...new Set(chains.map((chain) => chain.chainId))],
      ),
      requestedCapabilities,
      expiresAt,
    }),
    chains: Object.freeze(chains),
    requestedEvents: Object.freeze(
      eip155.events.filter((event) => SAFE_EVENTS.has(event)),
    ),
  };
}

function requestedCapabilitiesForNamespace(
  methods: readonly string[],
): readonly DAppCapability[] {
  return requestedCapabilities(methods);
}

export function buildApprovedNamespaces(
  mapped: WalletConnectMappedProposal,
  decision: Extract<DAppAuthorizationDecision, { decision: 'approved' }>,
  registry: NetworkRegistry,
): SessionTypes.Namespaces {
  if (
    decision.approvedNetworkIds.length === 0 ||
    decision.approvedNetworkIds.length !== decision.approvedChainIds.length ||
    !decision.approvedNetworkIds.includes(decision.networkId) ||
    !decision.approvedChainIds.includes(decision.chainId)
  ) {
    return fail(
      'NETWORK_MISMATCH',
      'The authorization decision does not contain a coherent network scope.',
    );
  }

  const requested = new Map(
    mapped.chains.map((chain) => [chain.networkId, chain.chainId]),
  );
  const approvedChains = decision.approvedNetworkIds.map((networkId, index) => {
    const chainId = decision.approvedChainIds[index];
    const registered = registry.getById(networkId);
    if (
      !registered ||
      !registered.enabled ||
      registered.configurationStatus !== 'configured' ||
      registered.chainId === null ||
      registered.chainId !== Number(chainId) ||
      requested.get(networkId) !== chainId
    ) {
      return fail(
        'PROVIDER_UNSUPPORTED_CHAIN',
        'The authorization decision contains an unavailable network.',
      );
    }
    return Object.freeze({ networkId, chainId });
  });

  const approvedCapabilities = new Set(decision.approvedCapabilities);
  if (
    [...approvedCapabilities].some(
      (capability) =>
        capability === 'message-signing' || capability === 'transaction-signing',
    )
  ) {
    return fail(
      'PROVIDER_UNSUPPORTED_REQUEST',
      'Signing capabilities are not available in this wallet transport phase.',
    );
  }

  const address = normalizePublicEvmAddress(decision.walletAddress);
  return {
    [EIP155_NAMESPACE]: {
      accounts: approvedChains.map(
        ({ chainId }) => `${EIP155_NAMESPACE}:${chainId}:${address}`,
      ),
      methods: [],
      events: [...mapped.requestedEvents],
    },
  };
}

export function readWalletConnectAccounts(
  session: SessionTypes.Struct,
  registry: NetworkRegistry,
): readonly WalletConnectAccount[] {
  const namespace = session.namespaces[EIP155_NAMESPACE];
  if (!namespace) {
    return fail(
      'PROVIDER_UNSUPPORTED_NAMESPACE',
      'The WalletConnect session does not contain the EVM namespace.',
    );
  }
  return Object.freeze(
    namespace.accounts.map((account) => {
      const [namespaceName, rawChainId, address, ...rest] = account.split(':');
      if (
        namespaceName !== EIP155_NAMESPACE ||
        rest.length > 0 ||
        !rawChainId ||
        !address
      ) {
        return fail(
          'PROVIDER_MALFORMED_PROPOSAL',
          'The WalletConnect session contains an invalid account scope.',
        );
      }
      const chainId = parseChainId(`${namespaceName}:${rawChainId}`);
      const network = registry.getByChainId(Number(chainId));
      if (
        !network ||
        !network.enabled ||
        network.configurationStatus !== 'configured'
      ) {
        return fail(
          'PROVIDER_UNSUPPORTED_CHAIN',
          'The WalletConnect session contains an unavailable network.',
        );
      }
      return Object.freeze({
        networkId: network.id,
        chainId,
        address: normalizePublicEvmAddress(address),
      });
    }),
  );
}
