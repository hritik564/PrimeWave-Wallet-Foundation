import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssetError,
  AssetRegistry,
  ERC20_READ_ABI,
  ERC20TokenService,
  InMemoryTokenPreferenceRepository,
  TokenDiscoveryService,
  createTokenAssetIdentity,
  type NetworkBoundTokenReadService,
  type TokenPreferenceRecord,
  type TokenPreferenceRepository,
} from '../../../index';
import {
  EvmAccountStateService,
} from '@/src/core/blockchain/account-state';
import {
  createEvmRpcProvider,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  stringToHex,
  type Address,
} from 'viem';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';

const ACCOUNT = '0x52908400098527886e0f7030069857d2e4169ee7';
const OTHER_ACCOUNT = '0x1111111111111111111111111111111111111111';
const CONTRACT_A = '0x1111111111111111111111111111111111111111';
const CONTRACT_B = '0x2222222222222222222222222222222222222222';

const TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  anonymous: false,
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const;

function network(id: string): EvmNetwork {
  return supportedNetworks.find((candidate) => candidate.id === id) as EvmNetwork;
}

function responseFor(id: number | string, result: unknown): RpcTransportResponse {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function rpcErrorFor(
  id: number | string,
  code = 3,
): RpcTransportResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message: 'private details must not leak' },
    },
  };
}

type Handler = (
  method: string,
  params: unknown[],
  id: number | string,
) => RpcTransportResponse | Error | Promise<RpcTransportResponse | Error>;

class FakeTransport implements RpcTransport {
  readonly requests: RpcTransportRequest[] = [];

  constructor(private readonly handler: Handler) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    this.requests.push(request);
    const body = JSON.parse(request.body) as {
      id: number | string;
      method: string;
      params: unknown[];
    };
    const response = await this.handler(body.method, body.params, body.id);
    if (response instanceof Error) throw response;
    return response;
  }
}

function stringResult(value: string): `0x${string}` {
  return encodeAbiParameters([{ type: 'string' }], [value]);
}

function uintResult(value: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

function selector(
  functionName: 'name' | 'symbol' | 'decimals',
): string {
  return encodeFunctionData({
    abi: ERC20_READ_ABI,
    functionName,
  });
}

function transferLog(
  contract: string,
  from: string,
  to: string,
  value: bigint,
  index: string,
): Record<string, unknown> {
  const topics = encodeEventTopics({
    abi: [TRANSFER_EVENT],
    eventName: 'Transfer',
    args: {
      from: from as Address,
      to: to as Address,
    },
  });
  return {
    address: contract,
    topics,
    data: uintResult(value),
    blockNumber: '0x10',
    blockHash: `0x${'a'.repeat(64)}`,
    transactionHash: `0x${index.padStart(64, '0')}`,
    logIndex: `0x${index}`,
  };
}

function createNetworkRegistry(networkId = 'ethereum'): NetworkRegistry {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(networkId);
  return registry;
}

async function createFixture(
  handler: Handler,
  options: {
    readonly now?: () => number;
    readonly networkId?: string;
    readonly repository?: TokenPreferenceRepository;
    readonly limits?: {
      readonly maxBlockRange?: bigint;
      readonly maxResults?: number;
      readonly maxMetadataLookups?: number;
    };
  } = {},
) {
  const networkId = options.networkId ?? 'ethereum';
  const registry = createNetworkRegistry(networkId);
  const transport = new FakeTransport(handler);
  const provider = await createEvmRpcProvider(registry, { transport });
  const accountState = new EvmAccountStateService(registry, provider);
  const assets = new AssetRegistry(registry);
  const tokenService = new ERC20TokenService(
    assets,
    [{ accountState, provider }],
    { now: options.now ?? (() => 1_700_000_000_000) },
  );
  const repository =
    options.repository ?? new InMemoryTokenPreferenceRepository();
  const discovery = new TokenDiscoveryService(
    tokenService,
    [{ accountState, provider }],
    {
      now: options.now ?? (() => 1_700_000_000_000),
      repository,
      limits: options.limits,
    },
  );
  return {
    registry,
    transport,
    provider,
    accountState,
    assets,
    tokenService,
    repository,
    discovery,
  };
}

function metadataHandler(
  logs: readonly Record<string, unknown>[] = [],
  options: {
    readonly chainId?: string;
    readonly failLogs?: boolean;
    readonly failMetadata?: boolean;
    readonly code?: string;
  } = {},
): Handler {
  return (method, params, id) => {
    if (method === 'eth_chainId') {
      return responseFor(id, options.chainId ?? '0x1');
    }
    if (method === 'eth_getCode') {
      return responseFor(id, options.code ?? '0x6001');
    }
    if (method === 'eth_getLogs') {
      return options.failLogs ? rpcErrorFor(id) : responseFor(id, logs);
    }
    if (method === 'eth_call') {
      if (options.failMetadata) return rpcErrorFor(id);
      const data = (params[0] as { data: string }).data;
      if (data === selector('name')) return responseFor(id, stringResult('Token'));
      if (data === selector('symbol')) return responseFor(id, stringResult('TKN'));
      if (data === selector('decimals')) return responseFor(id, uintResult(18n));
    }
    throw new Error(`unexpected method ${method}`);
  };
}

async function expectDiscoveryError(
  callback: () => unknown | Promise<unknown>,
  code: AssetError['code'],
): Promise<void> {
  await assert.rejects(async () => callback(), (error: unknown) => {
    return error instanceof AssetError && error.code === code;
  });
}

test('adds a valid user token with manual provenance and unknown verification', async () => {
  const fixture = await createFixture(metadataHandler());
  const candidate = await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A.toLowerCase(),
  });
  assert.equal(candidate.assetIdentity.contractAddress, CONTRACT_A);
  assert.equal(candidate.provenance, 'user_added');
  assert.equal(candidate.discoveryState, 'manually_added');
  assert.equal(candidate.verificationStatus, 'unknown');
  assert.equal(candidate.visibility, 'visible');
  assert.equal(candidate.provenanceObservations.length, 1);
  assert.equal(candidate.provenanceObservations[0].accountId, null);
});

test('validates invalid, disabled, unconfigured, placeholder, and EOA token paths', async () => {
  const fixture = await createFixture(metadataHandler());
  await expectDiscoveryError(
    () =>
      fixture.discovery.addUserToken({
        networkId: 'ethereum',
        contractAddress: 'not-an-address',
      }),
    'DISCOVERY_INVALID_TOKEN',
  );
  await expectDiscoveryError(
    () =>
      fixture.discovery.addUserToken({
        networkId: 'primewave',
        contractAddress: CONTRACT_A,
      }),
    'DISCOVERY_NETWORK_UNAVAILABLE',
  );

  const disabledRegistry = new NetworkRegistry([
    network('primewave'),
    { ...network('ethereum'), enabled: false },
  ]);
  const disabledAssets = new AssetRegistry(disabledRegistry);
  const disabledTokenService = new ERC20TokenService(disabledAssets, []);
  const disabledDiscovery = new TokenDiscoveryService(disabledTokenService, []);
  await expectDiscoveryError(
    () =>
      disabledDiscovery.addUserToken({
        networkId: 'ethereum',
        contractAddress: CONTRACT_A,
      }),
    'DISCOVERY_NETWORK_UNAVAILABLE',
  );

  const eoa = await createFixture(metadataHandler([], { code: '0x' }));
  await expectDiscoveryError(
    () =>
      eoa.discovery.addUserToken({
        networkId: 'ethereum',
        contractAddress: CONTRACT_A,
      }),
    'DISCOVERY_NOT_A_CONTRACT',
  );
});

test('merges user-added and discovered provenance into one identity', async () => {
  const fixture = await createFixture(metadataHandler());
  const userAdded = await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  const discovered = await fixture.discovery.discoverKnownToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A.toLowerCase(),
    accountId: 'account-a',
    accountAddress: ACCOUNT,
  });
  assert.equal(discovered.assetIdentity.assetId, userAdded.assetIdentity.assetId);
  assert.equal(discovered.provenance, 'user_added');
  assert.equal(discovered.provenanceObservations.length, 2);
  assert.deepEqual(
    discovered.provenanceObservations.map((observation) => observation.provenance),
    ['user_added', 'discovered'],
  );
  assert.equal(fixture.discovery.getCandidates().length, 1);

  const repeated = await fixture.discovery.discoverKnownToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
    accountId: 'account-a',
    accountAddress: ACCOUNT,
  });
  assert.equal(repeated.provenanceObservations.length, 2);
  assert.equal(fixture.discovery.getCandidates().length, 1);
});

test('keeps same-address tokens separate across networks and accounts', async () => {
  const ethereum = await createFixture(metadataHandler());
  const base = await createFixture(
    metadataHandler([], { chainId: '0x2105' }),
    { networkId: 'base' },
  );
  const first = await ethereum.discovery.discoverKnownToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
    accountId: 'account-a',
    accountAddress: ACCOUNT,
  });
  const second = await base.discovery.discoverKnownToken({
    networkId: 'base',
    contractAddress: CONTRACT_A,
    accountId: 'account-b',
    accountAddress: OTHER_ACCOUNT,
  });
  assert.notEqual(
    first.assetIdentity.assetId,
    `${second.assetIdentity.networkId}:${second.assetIdentity.assetId}`,
  );
  assert.notEqual(first.assetIdentity.networkId, second.assetIdentity.networkId);
  assert.equal(first.provenanceObservations[0].accountId, 'account-a');
  assert.equal(second.provenanceObservations[0].accountId, 'account-b');
});

test('supports visibility changes and distinguishes hide from local preference removal', async () => {
  const fixture = await createFixture(metadataHandler());
  const candidate = await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  const hidden = await fixture.discovery.setVisibility(
    candidate.assetIdentity,
    'hidden',
  );
  assert.equal(hidden.visibility, 'hidden');
  assert.equal(hidden.discoveryState, 'hidden');
  assert.equal((await fixture.repository.list()).length, 1);

  await fixture.discovery.removeLocalPreference(candidate.assetIdentity);
  assert.equal(fixture.discovery.getCandidates().length, 0);
  assert.equal((await fixture.repository.list()).length, 0);
});

test('discovers bounded incoming and outgoing Transfer logs with account scope', async () => {
  const logs = [
    transferLog(CONTRACT_A, OTHER_ACCOUNT, ACCOUNT, 0n, '1'),
    transferLog(CONTRACT_A, ACCOUNT, OTHER_ACCOUNT, 5n, '2'),
    transferLog(CONTRACT_A, ACCOUNT, OTHER_ACCOUNT, 5n, '2'),
    transferLog(CONTRACT_B, OTHER_ACCOUNT, ACCOUNT, 9n, '3'),
    {
      address: 'not-an-address',
      topics: ['0xdead', '0x01', '0x02'],
      data: '0x00',
    },
    {
      address: CONTRACT_A,
      topics: ['0xdead', '0x01', '0x02'],
      data: '0x00',
    },
  ];
  const fixture = await createFixture(metadataHandler(logs));
  const result = await fixture.discovery.discoverTransferEvents({
    networkId: 'ethereum',
    accountId: 'account-a',
    accountAddress: ACCOUNT,
    fromBlock: 10n,
    toBlock: 20n,
  });
  assert.equal(result.logsObserved, 3);
  assert.equal(result.metadataResolved, 2);
  assert.equal(result.candidates.length, 2);
  assert.equal(
    result.candidates.every(
      (candidate) =>
        candidate.provenance === 'discovered' &&
        candidate.provenanceObservations[0].accountId === 'account-a' &&
        candidate.provenanceObservations[0].reason === 'transfer_event',
    ),
    true,
  );
});

test('rejects unbounded ranges, excessive results, and excessive metadata lookups', async () => {
  const logs = [
    transferLog(CONTRACT_A, OTHER_ACCOUNT, ACCOUNT, 1n, '1'),
    transferLog(CONTRACT_B, OTHER_ACCOUNT, ACCOUNT, 1n, '2'),
  ];
  const fixture = await createFixture(metadataHandler(logs), {
    limits: { maxBlockRange: 5n, maxResults: 1, maxMetadataLookups: 1 },
  });
  const request = {
    networkId: 'ethereum',
    accountId: 'account-a',
    accountAddress: ACCOUNT,
    fromBlock: 10n,
    toBlock: 20n,
  } as const;
  await expectDiscoveryError(
    () => fixture.discovery.discoverTransferEvents(request),
    'DISCOVERY_RANGE_TOO_LARGE',
  );
  await expectDiscoveryError(
    () =>
      fixture.discovery.discoverTransferEvents({
        ...request,
        toBlock: 12n,
        maxResults: 1,
      }),
    'DISCOVERY_RESULT_LIMIT',
  );

  const metadataBounded = await createFixture(metadataHandler(logs), {
    limits: { maxBlockRange: 20n, maxResults: 10, maxMetadataLookups: 1 },
  });
  await expectDiscoveryError(
    () =>
      metadataBounded.discovery.discoverTransferEvents({
        ...request,
        toBlock: 20n,
        maxMetadataLookups: 1,
      }),
    'DISCOVERY_RESULT_LIMIT',
  );
});

test('normalizes log RPC failures, network changes, chain mismatches, and bad accounts', async () => {
  const failed = await createFixture(metadataHandler([], { failLogs: true }));
  await expectDiscoveryError(
    () =>
      failed.discovery.discoverTransferEvents({
        networkId: 'ethereum',
        accountId: 'account-a',
        accountAddress: ACCOUNT,
        fromBlock: 1n,
        toBlock: 2n,
      }),
    'DISCOVERY_LOG_QUERY_FAILED',
  );
  await expectDiscoveryError(
    () =>
      failed.discovery.discoverTransferEvents({
        networkId: 'ethereum',
        accountId: 'account-a',
        accountAddress: 'bad',
        fromBlock: 1n,
        toBlock: 2n,
      }),
    'DISCOVERY_INVALID_ACCOUNT',
  );

  let registry!: NetworkRegistry;
  const changed = await createFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getLogs') {
      registry.selectActiveNetwork('base');
      return responseFor(id, []);
    }
    return metadataHandler()(method, params, id);
  });
  registry = changed.registry;
  await expectDiscoveryError(
    () =>
      changed.discovery.discoverTransferEvents({
        networkId: 'ethereum',
        accountId: 'account-a',
        accountAddress: ACCOUNT,
        fromBlock: 1n,
        toBlock: 2n,
      }),
    'DISCOVERY_NETWORK_CHANGED',
  );

  let mismatchChainCalls = 0;
  const mismatch = await createFixture((method, params, id) => {
    if (method === 'eth_chainId') {
      mismatchChainCalls += 1;
      return responseFor(id, mismatchChainCalls === 1 ? '0x1' : '0x38');
    }
    return metadataHandler()(method, params, id);
  });
  await expectDiscoveryError(
    () =>
      mismatch.discovery.discoverTransferEvents({
        networkId: 'ethereum',
        accountId: 'account-a',
        accountAddress: ACCOUNT,
        fromBlock: 1n,
        toBlock: 2n,
      }),
    'DISCOVERY_CHAIN_MISMATCH',
  );
});

test('persists only public metadata and never uses SecureStore or secret material', async () => {
  const fixture = await createFixture(metadataHandler());
  const candidate = await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  const records = await fixture.repository.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].assetIdentity.contractAddress, CONTRACT_A);
  assert.equal('privateKey' in records[0], false);
  assert.equal('mnemonic' in records[0], false);
  assert.equal('seed' in records[0], false);
  assert.equal('vault' in records[0], false);
  assert.equal(JSON.stringify(records).includes('SecureStore'), false);
  assert.equal(JSON.stringify(candidate).includes('privateKey'), false);
});

test('keeps metadata changes as observations without changing identity', async () => {
  let phase = 0;
  const fixture = await createFixture((method, params, id) => {
    if (method === 'eth_chainId') return responseFor(id, '0x1');
    if (method === 'eth_getCode') return responseFor(id, '0x6001');
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data === selector('name')) {
        return responseFor(id, stringResult(phase === 0 ? 'Old' : 'New'));
      }
      if (data === selector('symbol')) return responseFor(id, stringResult('TKN'));
      if (data === selector('decimals')) return responseFor(id, uintResult(18n));
    }
    throw new Error(`unexpected method ${method}`);
  });
  const first = await fixture.discovery.addUserToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  phase = 1;
  const second = await fixture.discovery.discoverKnownToken({
    networkId: 'ethereum',
    contractAddress: CONTRACT_A,
  });
  assert.equal(first.assetIdentity.assetId, second.assetIdentity.assetId);
  assert.equal(second.token.name, 'New');
  assert.equal(second.provenanceObservations.length, 2);
  assert.equal(fixture.discovery.getCandidates().length, 1);
});

test('keeps concurrent repeated discovery deduplicated and rejects forbidden transaction methods', async () => {
  const fixture = await createFixture(metadataHandler());
  const candidates = await Promise.all(
    Array.from({ length: 4 }, () =>
      fixture.discovery.discoverKnownToken({
        networkId: 'ethereum',
        contractAddress: CONTRACT_A,
        accountId: 'account-a',
        accountAddress: ACCOUNT,
      }),
    ),
  );
  assert.equal(new Set(candidates.map((candidate) => candidate.assetIdentity.assetId)).size, 1);
  assert.equal(fixture.discovery.getCandidates().length, 1);
  assert.equal(
    fixture.transport.requests.some(
      (request) => JSON.parse(request.body).method === 'eth_sendRawTransaction',
    ),
    false,
  );
  assert.equal(
    fixture.transport.requests.some((request) =>
      JSON.stringify(JSON.parse(request.body)).match(
        /transfer|approve|allowance|permit|permit2/i,
      ),
    ),
    false,
  );
});

test('repository failures become safe discovery persistence errors', async () => {
  const failingRepository = {
    async get(): Promise<TokenPreferenceRecord | undefined> {
      return undefined;
    },
    async list(): Promise<readonly TokenPreferenceRecord[]> {
      return [];
    },
    async save(): Promise<void> {
      throw new Error('storage internals must not leak');
    },
    async delete(): Promise<void> {},
  };
  const fixture = await createFixture(metadataHandler(), {
    repository: failingRepository as TokenPreferenceRepository,
  });
  await expectDiscoveryError(
    () =>
      fixture.discovery.addUserToken({
        networkId: 'ethereum',
        contractAddress: CONTRACT_A,
      }),
    'DISCOVERY_PERSISTENCE_FAILED',
  );
});
