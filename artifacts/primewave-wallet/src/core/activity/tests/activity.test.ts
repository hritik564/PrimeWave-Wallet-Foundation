import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActivityError,
  ActivityReadModelService,
  ActivityService,
  InMemoryActivityRepository,
} from '@/src/core/activity';
import { createAssetIcon } from '@/src/core/portfolio';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks';
import type {
  ActivityAssetPresentation,
  ActivityRecordInput,
  ActivityScope,
} from '@/src/core/activity';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const hash = `0x${'a'.repeat(64)}` as `0x${string}`;

const scope: ActivityScope = {
  accountId: 'account-a',
  networkId: 'ethereum',
  chainId: 1n,
};

function recordInput(overrides: Partial<ActivityRecordInput> = {}): ActivityRecordInput {
  return {
    ...scope,
    localTransactionId: 'local-a',
    transactionHash: null,
    senderAddress: sender,
    transactionType: 'native-transfer',
    direction: 'outgoing',
    assetIdentity: {
      assetType: 'native',
      networkId: 'ethereum',
      assetId: 'native',
    },
    recipient,
    amountRaw: 1250000000000000000n,
    amountDecimals: 18,
    amountDisplay: '1.25',
    nativeValue: 1250000000000000000n,
    tokenContractAddress: null,
    nonce: 4n,
    gasLimit: 21000n,
    feeModel: 'eip1559',
    feeAmount: 42000000000000n,
    createdAt: 100,
    broadcastAt: null,
    confirmedAt: null,
    status: 'draft',
    confirmation: null,
    explorerUrl: null,
    provenance: 'local_wallet',
    observedAt: 100,
    ...overrides,
  };
}

function signedTransaction() {
  return {
    kind: 'signed-transaction' as const,
    rawTransaction: `0x${'11'.repeat(32)}` as `0x${string}`,
    transactionHash: hash,
    networkId: scope.networkId,
    chainId: scope.chainId,
    transactionType: 'native-transfer' as const,
    from: sender,
  };
}

test('requires a local ID or blockchain hash and preserves exact quantities', () => {
  const repository = new InMemoryActivityRepository();
  const record = repository.add(recordInput());

  assert.equal(record.localTransactionId, 'local-a');
  assert.equal(record.amountRaw, 1250000000000000000n);
  assert.equal(record.feeAmount, 42000000000000n);
  assert.equal(record.nonce, 4n);
  assert.throws(
    () => repository.add(recordInput({ localTransactionId: null })),
    (error: unknown) =>
      error instanceof ActivityError && error.code === 'INVALID_RECORD',
  );
});

test('prevents duplicate scoped identity but isolates account and network records', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput());
  assert.throws(
    () => repository.add(recordInput()),
    (error: unknown) =>
      error instanceof ActivityError && error.code === 'DUPLICATE_RECORD',
  );

  const otherAccount = repository.add(
    recordInput({ localTransactionId: 'local-b', accountId: 'account-b' }),
  );
  const otherNetwork = repository.add(
    recordInput({
      localTransactionId: 'local-c',
      networkId: 'polygon',
      chainId: 137n,
      assetIdentity: { assetType: 'native', networkId: 'polygon', assetId: 'native' },
    }),
  );
  assert.equal(otherAccount.accountId, 'account-b');
  assert.equal(otherNetwork.networkId, 'polygon');
  assert.equal(repository.listByAccountAndNetwork(scope).length, 1);
  assert.equal(
    repository.getById('local-b', scope),
    null,
    'a different account must not be visible through the requested scope',
  );
});

test('associates a blockchain hash with a local record and supports hash lookup', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput({ transactionHash: hash, status: 'signed' }));
  const byHash = repository.getByHash(hash.toUpperCase(), scope);
  assert.ok(byHash);
  assert.equal(byHash.localTransactionId, 'local-a');
});

test('orders block-known activity before pending and local-only activity with bounded reads', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput({ localTransactionId: 'local-only', createdAt: 300, observedAt: 300 }));
  repository.add(
    recordInput({
      localTransactionId: 'pending',
      transactionHash: `0x${'b'.repeat(64)}`,
      status: 'broadcasted',
      createdAt: 100,
      observedAt: 200,
    }),
  );
  repository.add(
    recordInput({
      localTransactionId: 'mined',
      transactionHash: `0x${'c'.repeat(64)}`,
      status: 'confirmed',
      createdAt: 50,
      observedAt: 50,
      confirmedAt: 50,
      confirmation: {
        state: 'confirmed',
        polls: 1,
        checkedAtMs: 50,
        receipt: {
          transactionHash: `0x${'c'.repeat(64)}`,
          blockHash: `0x${'d'.repeat(64)}`,
          blockNumber: 12n,
          status: 'success',
          gasUsed: 21000n,
          effectiveGasPrice: 2n,
        },
      },
    }),
  );
  const page = repository.listByAccountAndNetwork(scope, { limit: 2 });
  assert.deepEqual(
    page.map((item) => item.localTransactionId),
    ['mined', 'pending'],
  );
  assert.equal(repository.listByAccountAndNetwork(scope, { limit: 1, offset: 2 })[0]?.localTransactionId, 'local-only');
});

test('lifecycle service preserves signed, broadcast, confirmation, and unknown states', () => {
  let clock = 1000;
  const service = new ActivityService({
    now: () => clock,
    createLocalTransactionId: () => 'lifecycle-1',
  });
  const record = service.createDraft({
    ...scope,
    senderAddress: sender,
    transactionType: 'native-transfer',
    direction: 'outgoing',
    recipient,
    amountRaw: 1n,
    amountDecimals: 18,
    nativeValue: 1n,
  });
  assert.equal(record.status, 'draft');

  const signed = service.recordSigned(record.localTransactionId!, signedTransaction());
  assert.equal(signed.status, 'signed');
  service.recordBroadcasting(record.localTransactionId!);
  clock = 1100;
  const broadcasted = service.recordBroadcast(record.localTransactionId!, {
    kind: 'broadcast-result',
    state: 'broadcasted',
    transactionHash: hash,
    networkId: scope.networkId,
    chainId: scope.chainId,
    transactionType: 'native-transfer',
    from: sender,
    submittedAtMs: 1100,
  });
  assert.equal(broadcasted.status, 'broadcasted');
  const unknown = service.recordConfirmation(record.localTransactionId!, {
    kind: 'confirmation-result',
    state: 'unknown',
    transactionHash: hash,
    networkId: scope.networkId,
    chainId: scope.chainId,
    receipt: null,
    polls: 3,
    checkedAtMs: 1200,
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.confirmedAt, null);
  const confirmed = service.recordConfirmation(record.localTransactionId!, {
    kind: 'confirmation-result',
    state: 'confirmed',
    transactionHash: hash,
    networkId: scope.networkId,
    chainId: scope.chainId,
    receipt: {
      transactionHash: hash,
      blockHash: `0x${'d'.repeat(64)}`,
      blockNumber: 99n,
      status: 'success',
      gasUsed: 21000n,
      effectiveGasPrice: 2n,
    },
    polls: 1,
    checkedAtMs: 1300,
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmedAt, 1300);
});

test('rejects lifecycle context mismatches and invalid regressions', () => {
  const service = new ActivityService({
    createLocalTransactionId: () => 'mismatch',
    now: () => 100,
  });
  const record = service.createDraft({
    ...scope,
    senderAddress: sender,
    transactionType: 'contract-interaction',
    direction: 'outgoing',
    recipient,
    assetIdentity: {
      assetType: 'fungible_token',
      networkId: 'ethereum',
      assetId: token,
    },
    tokenContractAddress: token,
  });
  assert.throws(
    () =>
      service.recordSigned(record.localTransactionId!, {
        ...signedTransaction(),
        from: recipient,
      }),
    (error: unknown) =>
      error instanceof ActivityError && error.code === 'LIFECYCLE_MISMATCH',
  );
  service.recordSigned(record.localTransactionId!, signedTransaction());
  service.recordBroadcasting(record.localTransactionId!);
  service.recordBroadcast(record.localTransactionId!, {
    kind: 'broadcast-result',
    state: 'broadcasted',
    transactionHash: hash,
    networkId: scope.networkId,
    chainId: scope.chainId,
    transactionType: 'native-transfer',
    from: sender,
    submittedAtMs: 110,
  });
  assert.throws(
    () => service.recordFailed(record.localTransactionId!),
    (error: unknown) =>
      error instanceof ActivityError && error.code === 'INVALID_STATUS_TRANSITION',
  );
});

test('represents external blockchain activity without a local ID', () => {
  const service = new ActivityService({ now: () => 500 });
  const external = service.recordExternal({
    ...scope,
    transactionHash: hash,
    senderAddress: sender,
    direction: 'incoming',
    transactionType: 'erc20-transfer',
    assetIdentity: {
      assetType: 'fungible_token',
      networkId: 'ethereum',
      assetId: token,
    },
    tokenContractAddress: token,
    amountRaw: 25n,
    amountDecimals: 6,
    status: 'unknown',
  });
  assert.equal(external.localTransactionId, null);
  assert.equal(external.provenance, 'blockchain_read');
  assert.equal(external.transactionHash, hash);
});

test('hash-based upserts preserve an existing local transaction association', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput({ transactionHash: hash, status: 'signed' }));
  const merged = repository.upsert({
    ...scope,
    localTransactionId: null,
    transactionHash: hash,
    senderAddress: sender,
    transactionType: 'native-transfer',
    direction: 'outgoing',
    status: 'unknown',
    provenance: 'blockchain_read',
    createdAt: 200,
    observedAt: 200,
  });
  assert.equal(merged.localTransactionId, 'local-a');
  assert.equal(merged.provenance, 'blockchain_read');
  assert.equal(repository.getByHash(hash, scope)?.localTransactionId, 'local-a');
});

test('read model is bounded, scoped, ordered, and public-only', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput({ localTransactionId: 'read-1', transactionHash: hash }));
  const readModel = new ActivityReadModelService(repository).getActivity({
    ...scope,
    limit: 10,
  });
  assert.equal(readModel.kind, 'activity-read-model');
  assert.equal(readModel.items[0]?.kind, 'activity-item');
  assert.equal(readModel.items[0]?.identity, `local:read-1`);
  assert.equal('privateKey' in (readModel.items[0] ?? {}), false);
  assert.equal(readModel.scope.chainId, 1n);
});

test('presents native assets with reused icon fallback, network metadata, and exact signed amounts', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(
    recordInput({
      localTransactionId: 'presentation-native',
      amountRaw: 1250000000000000000n,
      amountDecimals: 18,
      amountDisplay: null,
      blockTimestamp: 1700000000,
      status: 'confirmed',
    }),
  );
  const readModel = new ActivityReadModelService(repository, {
    networkRegistry: new NetworkRegistry(supportedNetworks),
  }).getActivity(scope);
  const presentation = readModel.items[0]!.presentation;

  assert.equal(presentation.action, 'sent');
  assert.equal(presentation.primaryAsset?.symbol, 'ETH');
  assert.equal(presentation.primaryAsset?.name, 'Ether');
  assert.equal(presentation.primaryAsset?.icon.fallback.type, 'native_currency');
  assert.equal(presentation.primaryAsset?.verificationStatus, 'unknown');
  assert.equal(presentation.network.name, 'Ethereum');
  assert.equal(presentation.network.badgeId, 'network:ethereum');
  assert.equal(presentation.network.configured, true);
  assert.equal(presentation.network.chainId, 1n);
  assert.equal(presentation.primaryAmount.display, '1.25');
  assert.equal(presentation.primaryAmount.signedDisplay, '-1.25 ETH');
  assert.equal(presentation.primaryAmount.raw, 1250000000000000000n);
  assert.equal(presentation.timestamp.source, 'blockchain');
  assert.equal(presentation.timestamp.timestamp, 1700000000);
});

test('presents ERC-20 metadata without coupling icon availability to verification', () => {
  const repository = new InMemoryActivityRepository();
  const identity = {
    assetType: 'fungible_token' as const,
    networkId: 'ethereum',
    assetId: token,
  };
  const icon = createAssetIcon(identity, 'Test Token', 'TST');
  repository.add(
    recordInput({
      localTransactionId: 'presentation-token',
      assetIdentity: identity,
      transactionType: 'erc20-transfer',
      amountRaw: 1005000n,
      amountDecimals: 6,
      amountDisplay: null,
      tokenContractAddress: token,
      direction: 'incoming',
    }),
  );
  const presentation = new ActivityReadModelService(repository, {
    assetResolver: (assetIdentity) =>
      assetIdentity.assetId === token
        ? {
            name: 'Test Token',
            symbol: 'TST',
            decimals: 6,
            icon,
            metadataStatus: 'complete',
            verificationStatus: 'unverified',
          }
        : null,
  }).getActivity(scope).items[0]!.presentation;

  assert.equal(presentation.action, 'received');
  assert.equal(presentation.primaryAsset?.identity.assetId, token);
  assert.equal(presentation.primaryAsset?.symbol, 'TST');
  assert.equal(presentation.primaryAsset?.icon.fallback.initials, 'TS');
  assert.equal(presentation.primaryAsset?.icon.status, 'unavailable');
  assert.equal(presentation.primaryAsset?.verificationStatus, 'unverified');
  assert.equal(presentation.counterparty.type, 'from');
  assert.equal(presentation.counterparty.displayAddress, '0x1111...1111');
  assert.equal(presentation.primaryAmount.signedDisplay, '+1.005 TST');
});

test('keeps future multi-asset and action representations explicit', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(
    recordInput({
      localTransactionId: 'future-swap',
      transactionType: 'contract-interaction',
      direction: 'unknown',
      assetIdentity: null,
      amountRaw: null,
      amountDecimals: null,
      amountDisplay: null,
    }),
  );
  const secondaryIdentity = {
    assetType: 'fungible_token' as const,
    networkId: 'ethereum',
    assetId: token,
  };
  const secondaryAsset: ActivityAssetPresentation = {
    identity: secondaryIdentity,
    assetType: 'fungible_token',
    networkId: 'ethereum',
    assetId: token,
    symbol: 'TST',
    name: 'Test Token',
    decimals: 6,
    icon: createAssetIcon(secondaryIdentity, 'Test Token', 'TST'),
    metadataStatus: 'complete',
    verificationStatus: 'unverified',
  };
  const presentation = new ActivityReadModelService(repository, {
    interpretationResolver: () => ({
      action: 'swapped',
      secondaryAsset,
      secondaryAmount: {
        raw: 1065500n,
        decimals: 6,
        symbol: 'TST',
        display: '1.0655',
        signedDisplay: '+1.0655 TST',
        sign: 'positive',
      },
    }),
  }).getActivity(scope).items[0]!.presentation;

  assert.equal(presentation.action, 'swapped');
  assert.equal(presentation.primaryAsset, null);
  assert.equal(presentation.secondaryAsset?.symbol, 'TST');
  assert.equal(presentation.secondaryAmount?.raw, 1065500n);
  assert.equal(presentation.secondaryAmount?.signedDisplay, '+1.0655 TST');

  const untrusted = new ActivityReadModelService(repository).getActivity(scope)
    .items[0]!.presentation;
  assert.equal(untrusted.action, 'contract_interaction');
});

test('preserves approved and unknown future actions without inferring swaps', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(
    recordInput({
      localTransactionId: 'approved',
      transactionType: 'contract-interaction',
      direction: 'unknown',
    }),
  );
  const approved = new ActivityReadModelService(repository, {
    interpretationResolver: () => ({ action: 'approved' }),
  }).getActivity(scope).items[0]!.presentation;
  assert.equal(approved.action, 'approved');

  const unknownRepository = new InMemoryActivityRepository();
  unknownRepository.add(
    recordInput({
      localTransactionId: 'unknown-event',
      transactionType: 'unknown',
      direction: 'unknown',
    }),
  );
  const unknown = new ActivityReadModelService(unknownRepository)
    .getActivity(scope).items[0]!.presentation;
  assert.equal(unknown.action, 'unknown');
  assert.equal(unknown.direction, 'unknown');
  assert.equal(unknown.fiatValue, null);
});

test('exposes explorer and fiat presentation only when explicitly available', () => {
  const repository = new InMemoryActivityRepository();
  repository.add(recordInput({ localTransactionId: 'explorer', transactionHash: hash }));
  const withMetadata = new ActivityReadModelService(repository, {
    fiatValueResolver: () => ({
      currencyCode: 'USD',
      display: '$1.25',
    }),
  }).getActivity(scope).items[0]!.presentation;
  assert.equal(withMetadata.explorerAvailability.available, true);
  assert.equal(withMetadata.explorerAvailability.url, `https://etherscan.io/tx/${hash}`);
  assert.equal(withMetadata.fiatValue?.display, '$1.25');

  const placeholderScope = { accountId: 'account-a', networkId: 'primewave', chainId: 0n };
  const placeholderRepository = new InMemoryActivityRepository();
  placeholderRepository.add(recordInput({
    ...placeholderScope,
    localTransactionId: 'placeholder',
    assetIdentity: { assetType: 'native', networkId: 'primewave', assetId: 'native' },
    transactionHash: hash,
  }));
  const placeholder = new ActivityReadModelService(placeholderRepository)
    .getActivity(placeholderScope).items[0]!.presentation;
  assert.equal(placeholder.network.configured, false);
  assert.equal(placeholder.explorerAvailability.available, false);
  assert.equal(placeholder.explorerAvailability.url, null);
});