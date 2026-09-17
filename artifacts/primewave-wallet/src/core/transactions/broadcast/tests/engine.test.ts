import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  EvmRpcProvider,
  type RpcTransport,
  type RpcTransportRequest,
  type RpcTransportResponse,
} from '@/src/core/blockchain/rpc';
import {
  NetworkRegistry,
  supportedNetworks,
} from '@/src/core/networks/registry';
import type { EvmNetwork } from '@/src/core/networks/types';
import type { SignedTransaction } from '../../signing';
import {
  TransactionBroadcastEngine,
  TransactionBroadcastError,
  type BroadcastResult,
} from '../index';

const MNEMONIC =
  'test test test test test test test test test test test junk';
const FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TO = '0x1111111111111111111111111111111111111111';
const BLOCK_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

type FakeResponse =
  | RpcTransportResponse
  | Error
  | (() => Promise<RpcTransportResponse>);

class FakeTransport implements RpcTransport {
  readonly requests: RpcTransportRequest[] = [];

  constructor(private readonly responses: FakeResponse[]) {}

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No fake response configured.');
    }
    if (response instanceof Error) {
      throw response;
    }
    return typeof response === 'function' ? response() : response;
  }
}

function jsonResponse(id: number, result: unknown): RpcTransportResponse {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id, result },
  };
}

function errorResponse(
  id: number,
  code: number,
  message: string,
): RpcTransportResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    },
  };
}

function createRegistry(): NetworkRegistry {
  const registry = new NetworkRegistry(
    supportedNetworks.filter(
      (network) =>
        network.id === 'primewave' ||
        network.id === 'ethereum' ||
        network.id === 'base',
    ),
  );
  registry.selectActiveNetwork('ethereum');
  return registry;
}

async function createSignedTransaction(
  kind: 'legacy' | 'eip1559' = 'legacy',
): Promise<SignedTransaction> {
  const account = mnemonicToAccount(MNEMONIC);
  const rawTransaction =
    kind === 'legacy'
      ? await account.signTransaction({
          chainId: 1,
          nonce: 7,
          to: TO,
          value: 1_000_000_000_000_000n,
          gas: 21_000n,
          gasPrice: 1_000_000_000n,
          data: '0x',
        })
      : await account.signTransaction({
          chainId: 1,
          nonce: 8,
          to: TO,
          value: 0n,
          gas: 55_000n,
          maxFeePerGas: 2_500_000_000n,
          maxPriorityFeePerGas: 1_500_000_000n,
          data: '0xaabb',
          type: 'eip1559',
        });

  return {
    kind: 'signed-transaction',
    rawTransaction,
    transactionHash: keccak256(rawTransaction),
    networkId: 'ethereum',
    chainId: 1n,
    transactionType: kind === 'legacy' ? 'native-transfer' : 'contract-call',
    from: FROM,
  };
}

async function createEngine(
  responses: FakeResponse[],
  options: ConstructorParameters<typeof TransactionBroadcastEngine>[2] = {},
): Promise<{
  registry: NetworkRegistry;
  provider: EvmRpcProvider;
  transport: FakeTransport;
  engine: TransactionBroadcastEngine;
}> {
  const registry = createRegistry();
  const transport = new FakeTransport(responses);
  const provider = new EvmRpcProvider(registry, {
    transport,
    timeoutMs: 50,
  });
  const engine = new TransactionBroadcastEngine(registry, provider, options);
  return { registry, provider, transport, engine };
}

function createBroadcastResult(signed: SignedTransaction): BroadcastResult {
  return {
    kind: 'broadcast-result',
    state: 'broadcasted',
    transactionHash: signed.transactionHash,
    networkId: signed.networkId,
    chainId: signed.chainId,
    transactionType: signed.transactionType,
    from: signed.from,
    submittedAtMs: 1,
  };
}

async function expectBroadcastError(
  action: () => Promise<unknown>,
  code: TransactionBroadcastError['code'],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return error instanceof TransactionBroadcastError && error.code === code;
  });
}

function receipt(
  transactionHash: string,
  status: '0x0' | '0x1' = '0x1',
): Record<string, unknown> {
  return {
    transactionHash,
    blockHash: BLOCK_HASH,
    blockNumber: '0x10',
    status,
    gasUsed: '0x5208',
    effectiveGasPrice: '0x3b9aca00',
  };
}

test('broadcasts a valid signed transaction exactly once with exact raw bytes', async () => {
  const signed = await createSignedTransaction();
  const { engine, transport } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
  ]);

  const result = await engine.broadcast(signed);

  assert.equal(result.state, 'broadcasted');
  assert.equal(result.transactionHash, signed.transactionHash.toLowerCase());
  assert.equal(engine.getState(signed.transactionHash), 'broadcasted');
  assert.deepEqual(
    JSON.parse(transport.requests[1].body),
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_sendRawTransaction',
      params: [signed.rawTransaction],
    },
  );
});

test('supports EIP-1559 signed transactions without rebuilding them', async () => {
  const signed = await createSignedTransaction('eip1559');
  const { engine, transport } = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
  ]);

  const result = await engine.broadcast(signed);

  assert.equal(result.state, 'broadcasted');
  assert.equal(
    JSON.parse(transport.requests[1].body).params[0],
    signed.rawTransaction,
  );
});

test('rejects malformed raw data, hash tampering, and signed chain mismatch before send', async () => {
  const signed = await createSignedTransaction();
  const malformed = {
    ...signed,
    rawTransaction: '0x01' as Hex,
    transactionHash: keccak256('0x01'),
  };
  const hashTampered = {
    ...signed,
    transactionHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
  };
  const wrongChain = { ...signed, chainId: 5n };
  const malformedFixture = await createEngine([jsonResponse(1, '0x1')]);
  await expectBroadcastError(
    () => malformedFixture.engine.broadcast(malformed),
    'BROADCAST_INVALID_TRANSACTION',
  );
  await expectBroadcastError(
    () => malformedFixture.engine.broadcast(hashTampered),
    'BROADCAST_HASH_MISMATCH',
  );
  await expectBroadcastError(
    () => malformedFixture.engine.broadcast(wrongChain),
    'BROADCAST_CHAIN_MISMATCH',
  );
  assert.equal(malformedFixture.transport.requests.length, 0);
});

test('rejects an active-network mismatch without switching or sending', async () => {
  const signed = await createSignedTransaction();
  const { registry, engine, transport } = await createEngine([
    jsonResponse(1, '0x1'),
  ]);
  registry.selectActiveNetwork('base');

  await expectBroadcastError(
    () => engine.broadcast(signed),
    'BROADCAST_NETWORK_CHANGED',
  );
  assert.equal(transport.requests.length, 0);
});

test('rejects a remote chain mismatch before broadcasting', async () => {
  const signed = await createSignedTransaction();
  const registry = createRegistry();
  const transport = new FakeTransport([jsonResponse(1, '0x38')]);
  const provider = new EvmRpcProvider(registry, { transport });
  const engine = new TransactionBroadcastEngine(registry, provider);

  await expectBroadcastError(
    () => engine.broadcast(signed),
    'BROADCAST_CHAIN_MISMATCH',
  );
  assert.equal(transport.requests.length, 1);
});

test('normalizes RPC rejection and malformed hash responses without leaking RPC text', async () => {
  const signed = await createSignedTransaction();
  const rejection = await createEngine([
    jsonResponse(1, '0x1'),
    errorResponse(2, -32000, 'private key leaked by a hostile endpoint'),
  ]);
  await assert.rejects(
    () => rejection.engine.broadcast(signed),
    (error: unknown) => {
      assert.ok(error instanceof TransactionBroadcastError);
      assert.equal(error.code, 'BROADCAST_REJECTED');
      assert.equal(error.message.includes('private key'), false);
      return true;
    },
  );

  const malformed = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, '0x1234'),
  ]);
  await expectBroadcastError(
    () => malformed.engine.broadcast(signed),
    'BROADCAST_MALFORMED_RESPONSE',
  );
});

test('treats broadcast timeout as unknown and never automatically rebroadcasts', async () => {
  const signed = await createSignedTransaction();
  const fixture = await createEngine([
    jsonResponse(1, '0x1'),
    () => new Promise<RpcTransportResponse>(() => {}),
  ]);
  const result = await fixture.engine.broadcast(signed);

  assert.equal(result.state, 'unknown');
  assert.equal(result.errorCode, 'BROADCAST_TIMEOUT');
  assert.equal(fixture.engine.getState(signed.transactionHash), 'unknown');
  const repeated = await fixture.engine.broadcast(signed);
  assert.equal(repeated, result);
  assert.equal(fixture.transport.requests.length, 2);
});

test('reuses the in-flight broadcast operation for concurrent calls', async () => {
  const signed = await createSignedTransaction();
  let release: ((response: RpcTransportResponse) => void) | undefined;
  let started: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fixture = await createEngine([
    jsonResponse(1, '0x1'),
    () =>
      new Promise<RpcTransportResponse>((resolve) => {
        release = resolve;
        started?.();
      }),
  ]);

  const first = fixture.engine.broadcast(signed);
  await startedPromise;
  assert.equal(fixture.engine.getState(signed.transactionHash), 'broadcasting');
  const second = fixture.engine.broadcast(signed);
  release?.(jsonResponse(2, signed.transactionHash));

  assert.equal(await first, await second);
  assert.equal(
    fixture.transport.requests.filter((request) =>
      request.body.includes('eth_sendRawTransaction'),
    ).length,
    1,
  );
});

test('confirms successful receipts with bigint quantities', async () => {
  const signed = await createSignedTransaction();
  const fixture = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
    jsonResponse(3, receipt(signed.transactionHash)),
  ]);
  const broadcast = await fixture.engine.broadcast(signed);
  const result = await fixture.engine.confirm(broadcast);

  assert.equal(result.state, 'confirmed');
  assert.equal(result.receipt?.status, 'success');
  assert.equal(result.receipt?.blockNumber, 16n);
  assert.equal(result.receipt?.gasUsed, 21_000n);
  assert.equal(fixture.engine.getState(signed.transactionHash), 'confirmed');
});

test('reports reverted receipts distinctly from confirmed receipts', async () => {
  const signed = await createSignedTransaction();
  const fixture = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
    jsonResponse(3, receipt(signed.transactionHash, '0x0')),
  ]);
  const broadcast = await fixture.engine.broadcast(signed);
  const result = await fixture.engine.confirm(broadcast);

  assert.equal(result.state, 'reverted');
  assert.equal(result.receipt?.status, 'reverted');
  assert.equal(fixture.engine.getState(signed.transactionHash), 'reverted');
});

test('keeps null receipts pending until bounded polling returns unknown', async () => {
  const signed = await createSignedTransaction();
  const fixture = await createEngine(
    [
      jsonResponse(1, '0x1'),
      jsonResponse(2, signed.transactionHash),
      jsonResponse(3, null),
      jsonResponse(4, null),
      jsonResponse(5, null),
      jsonResponse(6, null),
    ],
    { sleep: async () => {}, defaultPolling: { intervalMs: 1, timeoutMs: 3 } },
  );
  const broadcast = await fixture.engine.broadcast(signed);
  const result = await fixture.engine.confirm(broadcast);

  assert.equal(result.state, 'unknown');
  assert.equal(result.receipt, null);
  assert.equal(result.errorCode, 'BROADCAST_TIMEOUT');
  assert.equal(result.polls, 4);
  assert.equal(fixture.engine.getState(signed.transactionHash), 'unknown');
});

test('stops confirmation polling on malformed or mismatched receipts', async () => {
  const signed = await createSignedTransaction();
  const malformed = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
    jsonResponse(3, {
      ...receipt(signed.transactionHash),
      blockNumber: 'not-hex',
    }),
  ]);
  const broadcast = await malformed.engine.broadcast(signed);
  await expectBroadcastError(
    () => malformed.engine.confirm(broadcast),
    'BROADCAST_MALFORMED_RESPONSE',
  );

  const mismatched = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
    jsonResponse(3, receipt(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    )),
  ]);
  const mismatchedBroadcast = await mismatched.engine.broadcast(signed);
  await expectBroadcastError(
    () => mismatched.engine.confirm(mismatchedBroadcast),
    'BROADCAST_HASH_MISMATCH',
  );
});

test('keeps confirmation tied to the original provider network after an active-network switch', async () => {
  const signed = await createSignedTransaction();
  let fixture!: Awaited<ReturnType<typeof createEngine>>;
  let switched = false;
  fixture = await createEngine(
    [
      jsonResponse(1, '0x1'),
      jsonResponse(2, signed.transactionHash),
      jsonResponse(3, null),
      jsonResponse(4, receipt(signed.transactionHash)),
    ],
    {
      sleep: async () => {
        if (!switched) {
          switched = true;
          fixture.registry.selectActiveNetwork('base');
        }
      },
      defaultPolling: { intervalMs: 1, timeoutMs: 10 },
    },
  );
  const broadcast = await fixture.engine.broadcast(signed);
  const result = await fixture.engine.confirm(broadcast);

  assert.equal(result.state, 'confirmed');
  assert.equal(result.networkId, 'ethereum');
  assert.equal(fixture.engine.getState(signed.transactionHash), 'confirmed');
});

test('supports read-only transaction lookup without history or rebroadcast behavior', async () => {
  const signed = await createSignedTransaction();
  const pending = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, { hash: signed.transactionHash, blockNumber: null }),
  ]);
  const pendingResult = await pending.engine.lookupTransaction(
    createBroadcastResult(signed),
  );
  assert.equal(pendingResult.state, 'pending');

  const mined = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, {
      hash: signed.transactionHash,
      blockHash: BLOCK_HASH,
      blockNumber: '0x10',
    }),
  ]);
  const minedResult = await mined.engine.lookupTransaction(
    createBroadcastResult(signed),
  );
  assert.equal(minedResult.state, 'mined');
  assert.equal(minedResult.blockNumber, 16n);

  const missing = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, null),
  ]);
  const missingResult = await missing.engine.lookupTransaction(
    createBroadcastResult(signed),
  );
  assert.equal(missingResult.state, 'not-found');
});

test('does not expose secrets or signing access through broadcast results', async () => {
  const signed = await createSignedTransaction();
  const fixture = await createEngine([
    jsonResponse(1, '0x1'),
    jsonResponse(2, signed.transactionHash),
  ]);
  const result = await fixture.engine.broadcast(signed);
  const serialized = JSON.stringify(result, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  assert.equal(serialized.includes(MNEMONIC), false);
  assert.equal(serialized.includes('privateKey'), false);
  assert.equal(serialized.includes('mnemonic'), false);
  assert.equal('sign' in fixture.engine, false);
  assert.equal('vault' in fixture.engine, false);
});