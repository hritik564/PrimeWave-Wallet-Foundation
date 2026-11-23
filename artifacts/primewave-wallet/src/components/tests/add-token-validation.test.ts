import assert from 'node:assert/strict';
import test from 'node:test';
import type { ERC20Token } from '@/src/core/assets';
import { createTokenAssetIdentity } from '@/src/core/assets/token/registry';
import { NetworkRegistry, supportedNetworks, type EvmNetwork } from '@/src/core/networks';
import { AddTokenValidationController } from '../add-token-validation';

const CONTRACT_A = '0x00000000000000000000000000000000000000a1';
const CONTRACT_B = '0x00000000000000000000000000000000000000b2';
const token = (networkId: string, chainId: number, contractAddress: string): ERC20Token => ({
  ...createTokenAssetIdentity(networkId, contractAddress), chainId,
  name: 'Fixture token', symbol: 'FIX', decimals: 18, metadataStatus: 'complete',
  verificationStatus: 'unknown', availabilityStatus: 'available',
});
function fixture() {
  const registry = new NetworkRegistry(supportedNetworks);
  registry.selectActiveNetwork('ethereum');
  const network = () => registry.getActiveNetwork() as EvmNetwork;
  const controller = new AddTokenValidationController((candidate, revision) =>
    registry.getActiveNetwork()?.id === candidate.id && registry.getSelectionRevision() === revision);
  const read = async (candidate: EvmNetwork, address: string) => token(candidate.id, candidate.chainId!, address);
  return { registry, network, controller, read };
}

test('changing a validated address or clearing it invalidates the prior preview', async () => {
  const f = fixture();
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  assert.ok(f.controller.isPreviewCurrent(f.network(), f.registry.getSelectionRevision()));
  f.controller.setInput(CONTRACT_B);
  assert.equal(f.controller.getSnapshot().preview, null);
  await f.controller.register(f.network(), f.registry.getSelectionRevision(), async () => assert.fail('stale token registered'), () => assert.fail('stale success'));
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  f.controller.setInput('');
  assert.equal(f.controller.getSnapshot().preview, null);
  assert.equal(f.controller.getSnapshot().message, null);
});

test('switching network away and back invalidates preview by selection revision', async () => {
  const f = fixture();
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  f.registry.selectActiveNetwork('bnb-smart-chain');
  f.registry.selectActiveNetwork('ethereum');
  assert.equal(f.controller.isPreviewCurrent(f.network(), f.registry.getSelectionRevision()), false);
  await f.controller.register(f.network(), f.registry.getSelectionRevision(), async () => assert.fail('stale network token registered'), () => assert.fail('stale success'));
});

test('network switch during metadata read discards the completion', async () => {
  const f = fixture();
  f.controller.setInput(CONTRACT_A);
  let resolve!: (value: ERC20Token) => void;
  const pending = f.controller.validate(f.network(), f.registry.getSelectionRevision(), () => new Promise((done) => { resolve = done; }));
  f.registry.selectActiveNetwork('bnb-smart-chain');
  resolve(token('ethereum', 1, CONTRACT_A));
  await pending;
  assert.equal(f.controller.getSnapshot().preview, null);
  assert.equal(f.controller.getSnapshot().busy, false);
  assert.match(f.controller.getSnapshot().message ?? '', /network changed/);
});

test('input edits, cancel, and dispose make pending metadata reads inert', async () => {
  for (const action of ['edit', 'cancel'] as const) {
    const f = fixture();
    f.controller.setInput(CONTRACT_A);
    let resolve!: (value: ERC20Token) => void;
    const pending = f.controller.validate(f.network(), f.registry.getSelectionRevision(), () => new Promise((done) => { resolve = done; }));
    if (action === 'edit') f.controller.setInput(CONTRACT_B); else f.controller.dispose();
    resolve(token('ethereum', 1, CONTRACT_A));
    await pending;
    if (action === 'edit') assert.equal(f.controller.getSnapshot().preview, null);
  }
});

test('reopen uses fresh controller; rapid add taps register only once', async () => {
  const f = fixture();
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  let finish!: () => void;
  let registrations = 0;
  const register = async () => { registrations++; await new Promise<void>((resolve) => { finish = resolve; }); };
  const first = f.controller.register(f.network(), f.registry.getSelectionRevision(), register, () => undefined);
  const second = f.controller.register(f.network(), f.registry.getSelectionRevision(), register, () => undefined);
  assert.equal(registrations, 1);
  finish();
  await Promise.all([first, second]);
  assert.equal(registrations, 1);
  f.controller.dispose();
  const reopened = new AddTokenValidationController();
  assert.equal(reopened.getSnapshot().preview, null);
});

test('registration failure reports an error; success refresh callback runs once', async () => {
  const f = fixture();
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  await f.controller.register(f.network(), f.registry.getSelectionRevision(), async () => { throw new Error('registration failed'); }, () => assert.fail('unexpected success'));
  assert.match(f.controller.getSnapshot().message ?? '', /could not be added/);
  f.controller.setInput(CONTRACT_A);
  await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
  let refreshed = 0;
  await f.controller.register(f.network(), f.registry.getSelectionRevision(), async () => undefined, () => { refreshed++; });
  assert.equal(refreshed, 1);
});

test('network change or modal close during registration suppresses stale success UI', async () => {
  for (const action of ['network', 'close'] as const) {
    const f = fixture();
    f.controller.setInput(CONTRACT_A);
    await f.controller.validate(f.network(), f.registry.getSelectionRevision(), f.read);
    const revision = f.registry.getSelectionRevision();
    let finish!: () => void;
    let refreshed = 0;
    const pending = f.controller.register(f.network(), revision, async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
    }, () => { refreshed++; });
    if (action === 'network') {
      f.registry.selectActiveNetwork('bnb-smart-chain');
      f.controller.invalidate('The active network changed.');
    } else {
      f.controller.dispose();
    }
    finish();
    await pending;
    assert.equal(refreshed, 0);
    if (action === 'network') assert.equal(f.controller.getSnapshot().preview, null);
  }
});

test('malformed and incomplete addresses cannot be validated', async () => {
  const f = fixture();
  for (const invalid of ['0x1234', '0x' + 'g'.repeat(40), '0x' + '1'.repeat(39)]) {
    f.controller.setInput(invalid);
    await f.controller.validate(f.network(), f.registry.getSelectionRevision(), async () => assert.fail('invalid address read'));
    assert.equal(f.controller.getSnapshot().preview, null);
    assert.match(f.controller.getSnapshot().message ?? '', /valid 20-byte/);
  }
});
