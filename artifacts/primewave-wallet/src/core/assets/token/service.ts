import {
  AccountStateError,
  normalizePublicEvmAddress,
  type ContractCodeState,
} from '@/src/core/blockchain/account-state';
import {
  RpcProviderError,
} from '@/src/core/blockchain/rpc';
import {
  decodeFunctionResult,
  encodeFunctionData,
  hexToString,
  type Address,
  type Hex,
} from 'viem';
import { AssetError } from '../errors';
import { formatAssetAmount, validateAssetDecimals } from '../amount';
import type {
  ERC20Token,
  NetworkBoundTokenReadService,
  TokenAssetIdentity,
  TokenBalance,
  TokenBalanceRequest,
  TokenMetadataStatus,
  TokenRequest,
  TokenServiceOptions,
} from '../models';
import { AssetRegistry } from '../registry';
import {
  ERC20_BYTES32_TEXT_ABI,
  ERC20_READ_ABI,
} from './abi';
import {
  TokenRegistry,
  createTokenAssetIdentity,
} from './registry';

const MAX_TOKEN_NAME_LENGTH = 256;
const MAX_TOKEN_SYMBOL_LENGTH = 64;
const TOKEN_DECIMALS_MAX = 36;

type TextFunctionName = 'name' | 'symbol';
type MetadataField<T> = {
  readonly value: T | null;
  readonly failure: 'unavailable' | 'invalid' | null;
};

function mapTokenError(error: unknown, fallback: AssetErrorCodeForStage): AssetError {
  if (error instanceof AssetError) {
    return error;
  }
  if (error instanceof AccountStateError) {
    switch (error.code) {
      case 'INVALID_ADDRESS':
        return new AssetError('TOKEN_INVALID_ADDRESS');
      case 'NETWORK_CHANGED':
        return new AssetError('TOKEN_NETWORK_CHANGED');
      case 'CONFIGURATION_ERROR':
        return new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
  }
  if (error instanceof RpcProviderError) {
    switch (error.code) {
      case 'CHAIN_ID_MISMATCH':
        return new AssetError('TOKEN_CHAIN_MISMATCH');
      case 'NETWORK_UNAVAILABLE':
      case 'TIMEOUT':
      case 'ENDPOINT_UNAVAILABLE':
        return new AssetError('TOKEN_NETWORK_UNAVAILABLE');
      case 'JSON_RPC_ERROR':
      case 'INVALID_RESPONSE':
      case 'MALFORMED_RESPONSE':
      case 'HTTP_FAILURE':
        return new AssetError(fallback);
      case 'CONFIGURATION_ERROR':
      case 'PROVIDER_NOT_INITIALIZED':
        return new AssetError('TOKEN_NETWORK_UNAVAILABLE');
      default:
        return new AssetError('TOKEN_RPC_ERROR');
    }
  }
  return new AssetError(fallback);
}

type AssetErrorCodeForStage =
  | 'TOKEN_CONTRACT_CALL_FAILED'
  | 'TOKEN_BALANCE_UNAVAILABLE'
  | 'TOKEN_NETWORK_CHANGED'
  | 'TOKEN_RPC_ERROR';

function validateMetadataText(
  value: string,
  maxLength: number,
): string {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value.trim().length === 0 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    }) ||
    value.includes('\ufffd')
  ) {
    throw new AssetError('TOKEN_METADATA_INVALID');
  }
  return value;
}

function decodeStandardText(
  data: Hex,
  functionName: TextFunctionName,
): string {
  const decoded = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName,
    data,
  }) as unknown;
  if (typeof decoded !== 'string') {
    throw new AssetError('TOKEN_METADATA_INVALID');
  }
  return validateMetadataText(
    decoded,
    functionName === 'name'
      ? MAX_TOKEN_NAME_LENGTH
      : MAX_TOKEN_SYMBOL_LENGTH,
  );
}

function decodeBytes32Text(
  data: Hex,
  functionName: TextFunctionName,
): string {
  const decoded = decodeFunctionResult({
    abi: ERC20_BYTES32_TEXT_ABI,
    functionName,
    data,
  }) as unknown;
  if (
    typeof decoded !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(decoded)
  ) {
    throw new AssetError('TOKEN_METADATA_INVALID');
  }
  return validateMetadataText(
    hexToString(decoded as Hex, { size: 32 }),
    functionName === 'name'
      ? MAX_TOKEN_NAME_LENGTH
      : MAX_TOKEN_SYMBOL_LENGTH,
  );
}

function decodeText(
  data: Hex,
  functionName: TextFunctionName,
): string {
  try {
    return decodeStandardText(data, functionName);
  } catch (standardError) {
    try {
      return decodeBytes32Text(data, functionName);
    } catch {
      if (standardError instanceof AssetError) {
        throw standardError;
      }
      throw new AssetError('TOKEN_METADATA_INVALID');
    }
  }
}

function decodeUint256(data: Hex): bigint {
  const decoded = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName: 'decimals',
    data,
  }) as unknown;
  if (
    typeof decoded !== 'bigint' ||
    decoded < 0n
  ) {
    throw new AssetError('TOKEN_METADATA_INVALID');
  }
  return decoded;
}

function decodeBalance(data: Hex): bigint {
  const decoded = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName: 'balanceOf',
    data,
  }) as unknown;
  if (
    typeof decoded !== 'bigint' ||
    decoded < 0n
  ) {
    throw new AssetError('TOKEN_BALANCE_UNAVAILABLE');
  }
  return decoded;
}

function isUnavailableError(error: unknown): boolean {
  return (
    error instanceof RpcProviderError &&
    (error.code === 'JSON_RPC_ERROR' ||
      error.code === 'NETWORK_UNAVAILABLE' ||
      error.code === 'TIMEOUT' ||
      error.code === 'ENDPOINT_UNAVAILABLE')
  );
}

function metadataStatus(
  fields: readonly MetadataField<unknown>[],
): TokenMetadataStatus {
  if (fields.some((field) => field.failure === 'invalid')) {
    return 'invalid';
  }
  const available = fields.filter((field) => field.value !== null).length;
  if (available === 0) {
    return 'unavailable';
  }
  return available === fields.length ? 'complete' : 'partial';
}

export class ERC20TokenService {
  private readonly services = new Map<string, NetworkBoundTokenReadService>();
  private readonly now: () => number;
  private readonly tokenRegistry: TokenRegistry;

  constructor(
    assets: AssetRegistry,
    readServices: readonly NetworkBoundTokenReadService[],
    options: TokenServiceOptions = {},
    tokenRegistry?: TokenRegistry,
  ) {
    this.tokenRegistry = tokenRegistry ?? new TokenRegistry(assets);
    this.now = options.now ?? (() => Date.now());
    for (const readService of readServices) {
      const network = readService.accountState.getNetwork();
      if (this.services.has(network.id)) {
        throw new AssetError('TOKEN_DUPLICATE_IDENTITY');
      }
      if (!assets.getNetworkRegistry().getById(network.id)) {
        throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
      }
      if (readService.provider === undefined) {
        throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
      }
      this.services.set(network.id, readService);
    }
  }

  getTokenRegistry(): TokenRegistry {
    return this.tokenRegistry;
  }

  async getTokenMetadata(request: TokenRequest): Promise<ERC20Token> {
    const identity = this.resolveRequest(request);
    const readService = this.getReadService(identity);
    let contractCode: ContractCodeState;
    try {
      readService.accountState.assertNetworkContext();
      contractCode = await readService.accountState.getContractCode(
        identity.contractAddress,
      );
    } catch (error) {
      throw mapTokenError(error, 'TOKEN_CONTRACT_CALL_FAILED');
    }
    if (!contractCode.hasCode) {
      throw new AssetError('TOKEN_NOT_A_CONTRACT');
    }

    const [name, symbol, decimals] = await Promise.all([
      this.readText(readService, identity, 'name'),
      this.readText(readService, identity, 'symbol'),
      this.readDecimals(readService, identity),
    ]);

    try {
      readService.accountState.assertNetworkContext();
    } catch (error) {
      throw mapTokenError(error, 'TOKEN_NETWORK_CHANGED');
    }

    const status = metadataStatus([name, symbol, decimals]);
    const network = readService.accountState.getNetwork();
    return Object.freeze({
      ...identity,
      chainId: network.chainId as number,
      name: name.value,
      symbol: symbol.value,
      decimals: decimals.value,
      metadataStatus: status,
      verificationStatus: 'unknown',
      availabilityStatus: 'available',
    });
  }

  async getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance> {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.accountId !== 'string' ||
      request.accountId.trim().length === 0
    ) {
      throw new AssetError('TOKEN_BALANCE_UNAVAILABLE');
    }
    let accountAddress: string;
    try {
      accountAddress = normalizePublicEvmAddress(request.accountAddress);
    } catch {
      throw new AssetError('TOKEN_INVALID_ADDRESS');
    }

    const identity = this.resolveRequest(request);
    const token = request.token ?? (await this.getTokenMetadata(request));
    this.assertTokenMatches(token, identity);
    if (token.decimals === null) {
      throw new AssetError('TOKEN_METADATA_UNAVAILABLE');
    }

    const readService = this.getReadService(identity);
    let rawBalance: bigint;
    try {
      readService.accountState.assertNetworkContext();
      const data = encodeFunctionData({
        abi: ERC20_READ_ABI,
        functionName: 'balanceOf',
        args: [accountAddress as Address],
      });
      const result = await readService.provider.request('eth_call', [
        {
          to: identity.contractAddress,
          data,
        },
        'latest',
      ]);
      rawBalance = decodeBalance(result);
      readService.accountState.assertNetworkContext();
    } catch (error) {
      throw mapTokenError(error, 'TOKEN_BALANCE_UNAVAILABLE');
    }

    return Object.freeze({
      kind: 'erc20-token-balance',
      asset: token,
      assetIdentity: identity,
      networkId: identity.networkId,
      chainId: BigInt(token.chainId),
      accountId: request.accountId,
      contractAddress: identity.contractAddress,
      accountAddress,
      rawBalance,
      decimals: token.decimals,
      displayAmount: formatAssetAmount(rawBalance, token.decimals),
      symbol: token.symbol,
      name: token.name,
      metadataStatus: token.metadataStatus,
      verificationStatus: token.verificationStatus,
      blockNumber: null,
      blockHash: null,
      retrievedAtMs: this.now(),
    });
  }

  private resolveRequest(request: TokenRequest): TokenAssetIdentity {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.networkId !== 'string'
    ) {
      throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
    try {
      return this.tokenRegistry.resolveIdentity(
        request.networkId,
        request.contractAddress,
      );
    } catch (error) {
      if (error instanceof AssetError) {
        throw error;
      }
      throw new AssetError('TOKEN_INVALID_ADDRESS');
    }
  }

  private getReadService(
    identity: TokenAssetIdentity,
  ): NetworkBoundTokenReadService {
    const readService = this.services.get(identity.networkId);
    if (!readService) {
      throw new AssetError('TOKEN_NETWORK_UNAVAILABLE');
    }
    const network = readService.accountState.getNetwork();
    if (
      network.id !== identity.networkId ||
      network.chainId === null
    ) {
      throw new AssetError('TOKEN_CHAIN_MISMATCH');
    }
    return readService;
  }

  private async readText(
    readService: NetworkBoundTokenReadService,
    identity: TokenAssetIdentity,
    functionName: TextFunctionName,
  ): Promise<MetadataField<string>> {
    try {
      const data = encodeFunctionData({
        abi: ERC20_READ_ABI,
        functionName,
      });
      const result = await readService.provider.request('eth_call', [
        { to: identity.contractAddress, data },
        'latest',
      ]);
      return { value: decodeText(result, functionName), failure: null };
    } catch (error) {
      return {
        value: null,
        failure: isUnavailableError(error) ? 'unavailable' : 'invalid',
      };
    }
  }

  private async readDecimals(
    readService: NetworkBoundTokenReadService,
    identity: TokenAssetIdentity,
  ): Promise<MetadataField<number>> {
    try {
      const data = encodeFunctionData({
        abi: ERC20_READ_ABI,
        functionName: 'decimals',
      });
      const result = await readService.provider.request('eth_call', [
        { to: identity.contractAddress, data },
        'latest',
      ]);
      const raw = decodeUint256(result);
      if (raw > BigInt(TOKEN_DECIMALS_MAX)) {
        return { value: null, failure: 'invalid' };
      }
      const decimals = Number(raw);
      validateAssetDecimals(decimals);
      return { value: decimals, failure: null };
    } catch (error) {
      return {
        value: null,
        failure: isUnavailableError(error) ? 'unavailable' : 'invalid',
      };
    }
  }

  private assertTokenMatches(
    token: ERC20Token,
    identity: TokenAssetIdentity,
  ): void {
    if (
      token.assetType !== 'fungible_token' ||
      token.networkId !== identity.networkId ||
      token.assetId !== identity.assetId ||
      token.contractAddress !== identity.contractAddress ||
      token.chainId !==
        (this.services.get(identity.networkId)?.accountState.getNetwork()
          .chainId ?? null) ||
      token.availabilityStatus !== 'available'
    ) {
      throw new AssetError('TOKEN_CHAIN_MISMATCH');
    }
  }
}