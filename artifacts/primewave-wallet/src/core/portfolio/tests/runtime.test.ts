import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvmRpcProvider, type RpcTransport } from '@/src/core/blockchain/rpc';
import { portfolioForSelection } from '@/src/components/WalletHomeShell.logic';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks';
import { createAppPortfolioReadModelService } from '../runtime';

const first = { accountId: 'first', accountAddress: '0x0000000000000000000000000000000000000001', networkId: 'ethereum' };
const second = { ...first, accountId: 'second', accountAddress: '0x0000000000000000000000000000000000000002' };

function fixture(readBalance: (address: string) => Promise<bigint>, chainId = '0x1') {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork('ethereum');
  const transport: RpcTransport = {
    async request(request) {
      const { method, params, id } = JSON.parse(request.body);
      let result: string;
      if (method === 'eth_chainId') result = chainId;
      else {
        assert.equal(method, 'eth_getBalance');
        assert.equal(params[1], 'latest');
        result = '0x' + (await readBalance(params[0])).toString(16);
      }
      return { status: 200, body: { jsonrpc: '2.0', id, result } };
    },
  };
  const service = createAppPortfolioReadModelService(registry, r => createEvmRpcProvider(r, { transport }));
  return { registry, service };
}

test('overlapping selected-account reads retain their identity, exact amount and genuine zero', async () => {
  const amount = 123456789012345678901234567890n;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const { service } = fixture(async address => {
    if (address === first.accountAddress) {
      await wait;
      return amount;
    }
    assert.equal(address, second.accountAddress);
    return 0n;
  });
  const pending = service.getPortfolio(first);
  const zero = await service.getPortfolio(second);
  release();
  const positive = await pending;
  assert.equal(portfolioForSelection(positive, second), null);
  assert.equal(portfolioForSelection(positive, { ...first, networkId: 'bnb-smart-chain' }), null);
  assert.equal(portfolioForSelection(positive, { ...first, accountAddress: second.accountAddress }), null);
  assert.equal(portfolioForSelection(zero, second), zero);
  assert.equal(zero.accountId, second.accountId);
  assert.equal(zero.assets[0]?.rawBalance, 0n);
  assert.equal(zero.assets[0]?.balanceState, 'zero');
  assert.equal(positive.accountAddress, first.accountAddress);
  assert.equal(positive.assets[0]?.rawBalance, amount);
});

test('failed balance read is unavailable', async () => {
  const { service } = fixture(async () => { throw new Error('offline'); });
  const model = await service.getPortfolio(first);
  assert.equal(model.state, 'unavailable');
  assert.equal(model.assets[0]?.rawBalance, null);
});

test('rejects wrong chain, inactive network and a network switch during balance read', async () => {
  let reads = 0;
  const mismatch = fixture(async () => { reads++; return 1n; }, '0x38');
  await assert.rejects(mismatch.service.getPortfolio(first));
  assert.equal(reads, 0);
  const { registry, service } = fixture(async () => {
    registry.selectActiveNetwork('bnb-smart-chain');
    return 1n;
  });
  await assert.rejects(service.getPortfolio(first));
  await assert.rejects(service.getPortfolio(first));
  registry.clearActiveNetwork();
  await assert.rejects(service.getPortfolio(first));
});
