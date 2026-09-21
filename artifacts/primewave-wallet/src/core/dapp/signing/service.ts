import { keccak256, stringToHex } from 'viem';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state/address';
import { issueMessageSigningCapability } from '@/src/core/security/message-signing-capability';
import type { NetworkRegistry } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import { secureLogger } from '@/src/core/security/logging';
import { DAppError } from '../errors';
import type {
  DAppMessageSigningAuthorization,
  DAppTypedDataDocument,
  MessageSigningEngineOptions,
  MessageSigningKeyAccess,
} from './models';

function normalizeAddress(value: string): string {
  try {
    return normalizePublicEvmAddress(value);
  } catch {
    throw new DAppError('INVALID_REQUEST', 'The signing address is invalid.');
  }
}

function assertContext(
  registry: NetworkRegistry,
  network: EvmNetwork,
  input: {
    readonly from: string;
    readonly networkId: string;
    readonly chainId: bigint;
  },
  changed = false,
): void {
  const active = registry.getActiveNetwork();
  if (
    !active ||
    active.id !== network.id ||
    active.id !== input.networkId ||
    active.chainId === null ||
    BigInt(active.chainId) !== input.chainId ||
    !active.enabled ||
    active.configurationStatus !== 'configured'
  ) {
    throw new DAppError(
      changed ? 'NETWORK_MISMATCH' : 'NETWORK_MISMATCH',
      changed
        ? 'The active network changed while signing.'
        : 'The signing request network is unavailable.',
    );
  }
}

function assertAuthorization(
  input: {
    readonly from: string;
    readonly accountId: string;
    readonly networkId: string;
    readonly chainId: bigint;
    readonly requestDigest: `0x${string}`;
  },
  authorization: DAppMessageSigningAuthorization,
): void {
  if (
    authorization.approved !== true ||
    authorization.authenticationState !== 'authenticated' ||
    authorization.requestId.length === 0 ||
    authorization.confirmedAt.length === 0 ||
    authorization.accountId !== input.accountId ||
    authorization.from !== input.from ||
    authorization.networkId !== input.networkId ||
    authorization.chainId !== input.chainId ||
    authorization.requestDigest !== input.requestDigest
  ) {
    throw new DAppError(
      'PERMISSION_DENIED',
      'The message signing authorization does not match the request.',
    );
  }
}

function digestPersonal(message: `0x${string}`): `0x${string}` {
  return keccak256(message);
}

function digestTypedData(rawPayload: string): `0x${string}` {
  return keccak256(stringToHex(rawPayload));
}

export class MessageSigningEngine {
  private readonly network: EvmNetwork;
  private readonly accounts: ReadonlyMap<
    string,
    { readonly accountId: string; readonly address: string; readonly index: number }
  >;
  private readonly inFlightAccounts = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly registry: NetworkRegistry,
    private readonly keyAccess: MessageSigningKeyAccess,
    options: MessageSigningEngineOptions,
  ) {
    const network = registry.getActiveNetwork();
    if (!network) {
      throw new DAppError('NETWORK_MISMATCH', 'No active network is selected.');
    }
    this.network = network;
    this.accounts = new Map(
      options.accounts.map((account) => [
        account.accountId,
        {
          accountId: account.accountId,
          address: normalizeAddress(account.address),
          index: account.index ?? 0,
        },
      ]),
    );
    this.authenticator = options.authenticator;
    this.now = options.now ?? Date.now;
  }

  private readonly authenticator: MessageSigningEngineOptions['authenticator'];

  async signPersonalMessage(
    input: {
      readonly requestId: string;
      readonly accountId: string;
      readonly from: string;
      readonly networkId: string;
      readonly chainId: bigint;
      readonly message: `0x${string}`;
      readonly confirmedAt?: string;
    },
  ): Promise<`0x${string}`> {
    const from = normalizeAddress(input.from);
    const account = this.accounts.get(input.accountId);
    const requestDigest = digestPersonal(input.message);
    const authorization: DAppMessageSigningAuthorization = {
      requestId: input.requestId,
      approved: true,
      confirmedAt: input.confirmedAt ?? new Date(this.now()).toISOString(),
      accountId: input.accountId,
      from,
      networkId: input.networkId,
      chainId: input.chainId,
      requestDigest,
      authenticationState: 'authenticated',
    };
    assertAuthorization(
      { ...input, from, requestDigest },
      authorization,
    );
    if (!account || account.address !== from) {
      throw new DAppError('ACCOUNT_MISMATCH', 'The signing account does not match the wallet.');
    }
    assertContext(this.registry, this.network, { ...input, from });
    return this.signWithAuthentication(
      input.accountId,
      requestDigest,
      authorization,
      (capability) =>
        this.keyAccess.signPersonalMessage(
          capability,
          input.accountId,
          input.message,
          requestDigest,
        ),
    );
  }

  async signTypedData(
    input: {
      readonly requestId: string;
      readonly accountId: string;
      readonly from: string;
      readonly networkId: string;
      readonly chainId: bigint;
      readonly rawPayload: string;
      readonly typedData: DAppTypedDataDocument;
      readonly confirmedAt?: string;
    },
  ): Promise<`0x${string}`> {
    const from = normalizeAddress(input.from);
    const account = this.accounts.get(input.accountId);
    const requestDigest = digestTypedData(input.rawPayload);
    const authorization: DAppMessageSigningAuthorization = {
      requestId: input.requestId,
      approved: true,
      confirmedAt: input.confirmedAt ?? new Date(this.now()).toISOString(),
      accountId: input.accountId,
      from,
      networkId: input.networkId,
      chainId: input.chainId,
      requestDigest,
      authenticationState: 'authenticated',
    };
    assertAuthorization({ ...input, from, requestDigest }, authorization);
    if (!account || account.address !== from) {
      throw new DAppError('ACCOUNT_MISMATCH', 'The signing account does not match the wallet.');
    }
    assertContext(this.registry, this.network, { ...input, from });
    return this.signWithAuthentication(
      input.accountId,
      requestDigest,
      authorization,
      (capability) =>
        this.keyAccess.signTypedData(
          capability,
          input.accountId,
          input.typedData,
          requestDigest,
        ),
    );
  }

  private async signWithAuthentication(
    accountId: string,
    requestDigest: `0x${string}`,
    authorization: DAppMessageSigningAuthorization,
    sign: (capability: ReturnType<typeof issueMessageSigningCapability>) => Promise<`0x${string}`>,
  ): Promise<`0x${string}`> {
    if (this.inFlightAccounts.has(accountId)) {
      throw new DAppError('DUPLICATE_REQUEST', 'A signing request is already in progress.');
    }
    this.inFlightAccounts.add(accountId);
    try {
      const authentication = await this.authenticator.unlockWallet();
      if (!authentication.authenticated) {
        throw new DAppError(
          'PERMISSION_DENIED',
          authentication.reason === 'cancelled'
            ? 'Message signing was cancelled.'
            : 'Wallet authentication was not completed.',
        );
      }
      assertContext(this.registry, this.network, authorization);
      const capability = issueMessageSigningCapability({
        accountId,
        requestDigest,
      });
      const signature = await sign(capability);
      assertContext(this.registry, this.network, authorization, true);
      return signature;
    } finally {
      this.inFlightAccounts.delete(accountId);
    }
  }
}
