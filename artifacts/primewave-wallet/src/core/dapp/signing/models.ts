import type { MessageSigningCapability, WalletAuthenticator } from '@/src/core/security';

export interface DAppTypedDataField {
  readonly name: string;
  readonly type: string;
}

export interface DAppTypedDataDocument {
  readonly domain: Record<string, unknown>;
  readonly types: Record<string, readonly DAppTypedDataField[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
}

export interface DAppMessageSigningAuthorization {
  readonly requestId: string;
  readonly approved: true;
  readonly confirmedAt: string;
  readonly accountId: string;
  readonly from: string;
  readonly networkId: string;
  readonly chainId: bigint;
  readonly requestDigest: `0x${string}`;
  readonly authenticationState: 'authenticated';
}

export interface MessageSigningKeyAccess {
  signPersonalMessage(
    capability: MessageSigningCapability,
    accountId: string,
    message: `0x${string}`,
    requestDigest: `0x${string}`,
  ): Promise<`0x${string}`>;
  signTypedData(
    capability: MessageSigningCapability,
    accountId: string,
    typedData: DAppTypedDataDocument,
    requestDigest: `0x${string}`,
  ): Promise<`0x${string}`>;
}

export interface MessageSigningEngineOptions {
  readonly authenticator: Pick<WalletAuthenticator, 'unlockWallet'>;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly address: string;
    readonly index?: number;
  }[];
  readonly now?: () => number;
}
