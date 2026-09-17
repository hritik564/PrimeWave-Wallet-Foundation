import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';
import { AssetError } from '../errors';
import type {
  ERC20Token,
  TokenAssetIdentity,
  TokenAvailabilityStatus,
} from '../models';
import { AssetRegistry, getAssetIdentityKey } from '../registry';

function networkStatus(
  registry: AssetRegistry,
  networkId: string,
): TokenAvailabilityStatus {
  return registry.getNativeAssetStatus(networkId).status;
}

export function createTokenAssetIdentity(
  networkId: string,
  contractAddress: unknown,
): TokenAssetIdentity {
  if (typeof networkId !== 'string' || networkId.trim().length === 0) {
    throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
  }
  let normalizedAddress: string;
  try {
    normalizedAddress = normalizePublicEvmAddress(contractAddress);
  } catch {
    throw new AssetError('TOKEN_INVALID_ADDRESS');
  }
  return Object.freeze({
    assetType: 'fungible_token',
    networkId,
    assetId: normalizedAddress,
    contractAddress: normalizedAddress,
  });
}

export class TokenRegistry {
  private readonly tokens = new Map<string, ERC20Token>();

  constructor(private readonly assets: AssetRegistry) {}

  resolveIdentity(
    networkId: string,
    contractAddress: unknown,
  ): TokenAssetIdentity {
    const status = networkStatus(this.assets, networkId);
    if (status === 'unsupported') {
      throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
    if (status === 'disabled') {
      throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
    if (status === 'unconfigured') {
      throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
    return createTokenAssetIdentity(networkId, contractAddress);
  }

  register(token: ERC20Token): ERC20Token {
    const identity = this.resolveIdentity(
      token.networkId,
      token.contractAddress,
    );
    const key = getAssetIdentityKey(identity);
    if (this.tokens.has(key)) {
      throw new AssetError('TOKEN_DUPLICATE_IDENTITY');
    }
    if (
      token.assetType !== 'fungible_token' ||
      token.assetId !== identity.assetId ||
      token.contractAddress !== identity.contractAddress
    ) {
      throw new AssetError('TOKEN_INVALID_ADDRESS');
    }
    this.tokens.set(key, token);
    return token;
  }

  get(identity: TokenAssetIdentity): ERC20Token | undefined {
    return this.tokens.get(getAssetIdentityKey(identity));
  }
}