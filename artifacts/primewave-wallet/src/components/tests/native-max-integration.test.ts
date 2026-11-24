import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAssetAmount } from '@/src/core/assets';
import { createEvmRpcProvider, type RpcTransport, type RpcTransportRequest, type RpcTransportResponse } from '@/src/core/blockchain/rpc';
import { createTransactionConstructionEngine } from '@/src/core/transactions/construction';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks';
import type { EvmNetwork } from '@/src/core/networks';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import { prepareTransactionReview, TransactionReviewError } from '../TransactionReviewScreen.logic';
import { createPublicSendDraft, NativeMaxRequestGuard } from '../WalletSendScreen.logic';

const FROM = '0x52908400098527886E0F7030069857D2E4169EE7';
const TO = '0x1111111111111111111111111111111111111111';
const RAW_BALANCE = 1_000_000_000_000_000_000n;
const network = supportedNetworks.find((item) => item.id === 'ethereum') as EvmNetwork;

class MockRpc implements RpcTransport {
  balance = RAW_BALANCE;
  readonly balancesByAddress = new Map<string, bigint>();
  priorityFee = 1_500_000_000n;
  holdNextEstimate = false;
  resolveEstimate: ((response: RpcTransportResponse) => void) | null = null;
  estimateRequestId: number | null = null;
  estimateStarted: (() => void) | null = null;
  readonly requests: string[] = [];

  async request(request: RpcTransportRequest): Promise<RpcTransportResponse> {
    const body = JSON.parse(request.body) as { id: number; method: string; params?: unknown[] };
    this.requests.push(body.method);
    if (body.method === 'eth_sendRawTransaction') throw new Error('Broadcast forbidden in this integration test.');
    const result = (): unknown => {
      switch (body.method) {
        case 'eth_chainId': return '0x1';
        case 'eth_getBalance': {
          const address = String(body.params?.[0] ?? '').toLowerCase();
          const balance = this.balancesByAddress.get(address) ?? this.balance;
          return `0x${balance.toString(16)}`;
        }
        case 'eth_getTransactionCount': return '0x1';
        case 'eth_estimateGas': return '0x5208';
        case 'eth_getBlockByNumber': return { number: '0x1', baseFeePerGas: '0x3b9aca00' };
        case 'eth_maxPriorityFeePerGas': return `0x${this.priorityFee.toString(16)}`;
        case 'eth_gasPrice': return '0x3b9aca00';
        default: throw new Error(`Unexpected RPC method ${body.method}`);
      }
    };
    if (body.method === 'eth_estimateGas' && this.holdNextEstimate) {
      this.holdNextEstimate = false;
      this.estimateStarted?.();
      this.estimateRequestId = body.id;
      return new Promise<RpcTransportResponse>((resolve) => {
        this.resolveEstimate = resolve;
      });
    }
    return { status: 200, body: { jsonrpc: '2.0', id: body.id, result: result() } };
  }
}

function asset(rawBalance = RAW_BALANCE): PortfolioAssetViewModel {
  return {
    identity: { assetType: 'native', networkId: network.id, assetId: 'native' },
    assetType: 'native', networkId: network.id, contractAddress: null,
    symbol: network.nativeCurrency.symbol, name: network.nativeCurrency.name,
    decimals: network.nativeCurrency.decimals, rawBalance,
    formattedBalance: formatAssetAmount(rawBalance, network.nativeCurrency.decimals),
    visibility: 'visible', verificationStatus: 'unknown', metadataStatus: 'complete', provenance: [],
    icon: { source: 'none', status: 'unavailable', reference: null, dimensions: null, provenance: 'none', fallback: { type: 'native_currency', initials: network.nativeCurrency.symbol, deterministicId: '0xf1' } },
    balanceState: rawBalance === 0n ? 'zero' : 'positive', availabilityState: 'available',
  };
}

function portfolio(balance = RAW_BALANCE): PortfolioReadModel {
  const selected = asset(balance);
  return {
    accountId: 'account-1', accountAddress: FROM, networkId: network.id,
    networkName: network.displayName, chainId: network.chainId as number,
    generatedAt: 1, totalAssetCount: 1, visibleAssetCount: 1, assets: [selected], warnings: [], state: 'ready',
  };
}

async function runtime(rpc: MockRpc) {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork(network.id);
  const provider = await createEvmRpcProvider(registry, { transport: rpc });
  const engine = await createTransactionConstructionEngine(registry, provider, [
    { accountId: 'account-1', address: FROM },
    { accountId: 'account-2', address: '0x0000000000000000000000000000000000000002' },
  ]);
  return { registry, engine };
}

test('Send Max draft flows through real construction and review with exact fee reservation', async () => {
  const rpc = new MockRpc();
  const { registry, engine } = await runtime(rpc);
  const quote = await engine.estimateNativeTransferMax({ accountId: 'account-1', from: FROM, to: TO });
  const amount = formatAssetAmount(quote.maxAmount, network.nativeCurrency.decimals);
  const draft = createPublicSendDraft({
    accountId: 'account-1', senderPublicAddress: FROM, network, asset: asset(), recipient: TO, amount,
  });
  const review = await prepareTransactionReview({
    draft, account: { accountId: 'account-1', address: FROM }, network,
    registeredNetwork: registry.getById(network.id), activeNetworkId: registry.getActiveNetwork()?.id ?? null,
    portfolio: portfolio(), constructionEngine: engine,
  });
  assert.equal(review.preview.value, quote.maxAmount);
  assert.equal(review.preview.totalMaximumNativeAmount, RAW_BALANCE);
  assert.equal(review.nativeBalance, RAW_BALANCE);
  assert.equal(review.preview.feeModel, 'eip1559');
  assert.equal(rpc.requests.includes('eth_sendRawTransaction'), false);
});

test('runtime Max quote is bound to the selected public account balance', async () => {
  const rpc = new MockRpc();
  const secondAddress = '0x0000000000000000000000000000000000000002';
  rpc.balancesByAddress.set(secondAddress, 4_000_000_000_000_000_000n);
  const { engine } = await runtime(rpc);
  const first = await engine.estimateNativeTransferMax({ accountId: 'account-1', from: FROM, to: TO });
  const second = await engine.estimateNativeTransferMax({ accountId: 'account-2', from: secondAddress, to: TO });
  assert.equal(first.accountId, 'account-1');
  assert.equal(second.accountId, 'account-2');
  assert.equal(second.rawBalance, 4_000_000_000_000_000_000n);
  assert.equal(second.maxAmount, second.rawBalance - second.feeReserve);
  await assert.rejects(engine.estimateNativeTransferMax({ accountId: 'account-1', from: secondAddress, to: TO }));
});

test('review rejects a Max draft when fees spike before signing-time rebuild', async () => {
  const rpc = new MockRpc();
  const { registry, engine } = await runtime(rpc);
  const quote = await engine.estimateNativeTransferMax({ accountId: 'account-1', from: FROM, to: TO });
  const draft = createPublicSendDraft({
    accountId: 'account-1', senderPublicAddress: FROM, network, asset: asset(), recipient: TO,
    amount: formatAssetAmount(quote.maxAmount, network.nativeCurrency.decimals),
  });
  rpc.priorityFee = 3_000_000_000n;
  await assert.rejects(
    prepareTransactionReview({
      draft, account: { accountId: 'account-1', address: FROM }, network,
      registeredNetwork: registry.getById(network.id), activeNetworkId: registry.getActiveNetwork()?.id ?? null,
      portfolio: portfolio(), constructionEngine: engine,
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'INSUFFICIENT_NATIVE_BALANCE',
  );
});

test('pending native Max estimate is invalidated by network switch away and back', async () => {
  const rpc = new MockRpc();
  const { registry, engine } = await runtime(rpc);
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  rpc.holdNextEstimate = true;
  rpc.estimateStarted = startedResolve;
  const pending = engine.estimateNativeTransferMax({ accountId: 'account-1', from: FROM, to: TO });
  await started;
  registry.selectActiveNetwork('bnb-smart-chain');
  registry.selectActiveNetwork(network.id);
  const resolveEstimate = rpc.resolveEstimate;
  assert.ok(resolveEstimate);
  resolveEstimate({ status: 200, body: { jsonrpc: '2.0', id: rpc.estimateRequestId as number, result: '0x5208' } });
  await assert.rejects(pending, (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'NETWORK_CHANGED');
});

test('pending runtime Max for Account 1 is discarded when the UI selects Account 2', async () => {
  const rpc = new MockRpc();
  const { registry, engine } = await runtime(rpc);
  const guard = new NativeMaxRequestGuard();
  let selectedAccountId = 'account-1';
  const revision = registry.getSelectionRevision();
  const generation = guard.begin();
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  rpc.holdNextEstimate = true;
  rpc.estimateStarted = startedResolve;
  const pending = engine.estimateNativeTransferMax({ accountId: 'account-1', from: FROM, to: TO });
  await started;
  selectedAccountId = 'account-2';
  guard.invalidate();
  const resolveEstimate = rpc.resolveEstimate;
  assert.ok(resolveEstimate);
  resolveEstimate({ status: 200, body: { jsonrpc: '2.0', id: rpc.estimateRequestId as number, result: '0x5208' } });
  const quote = await pending;
  assert.equal(quote.accountId, 'account-1');
  assert.equal(guard.isCurrent(generation, revision, () => registry.getSelectionRevision(), () => selectedAccountId === quote.accountId), false);
});

test('final review uses a fresh native RPC balance instead of the stale portfolio amount', async () => {
  const rpc = new MockRpc();
  const { registry, engine } = await runtime(rpc);
  rpc.balance = 900_000_000_000_000_000n;
  const draft = createPublicSendDraft({
    accountId: 'account-1', senderPublicAddress: FROM, network, asset: asset(), recipient: TO, amount: '0.95',
  });
  await assert.rejects(
    prepareTransactionReview({
      draft, account: { accountId: 'account-1', address: FROM }, network,
      registeredNetwork: registry.getById(network.id), activeNetworkId: registry.getActiveNetwork()?.id ?? null,
      portfolio: portfolio(), constructionEngine: engine,
    }),
    (error: unknown) => error instanceof TransactionReviewError && error.code === 'INSUFFICIENT_NATIVE_BALANCE',
  );
});
