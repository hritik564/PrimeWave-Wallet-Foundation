import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultNetworkRegistry } from '@/src/core/networks';
import { verifyMessage } from 'viem';
import { LocalWalletEngine } from '@/src/core/wallet/local-wallet-engine';
import type {
  SecureVault,
} from '@/src/core/security/contracts';
import { DAppError, MessageSigningEngine } from '..';
import type {
  DAppTypedDataDocument,
  MessageSigningKeyAccess,
} from '../signing';
import {
  normalizeSigningRequest,
  parsePersonalSigningRequest,
  parseTypedDataSigningRequest,
} from '../signing/validation';

const address = '0x52908400098527886e0f7030069857d2e4169ee7';
const identity = {
  dappId: 'signing-dapp',
  name: 'Signing DApp',
  description: 'Untrusted signing test metadata.',
  url: 'https://signing.example/app',
  iconUrl: null,
  origin: 'https://signing.example',
  providerSessionId: 'provider-session',
  metadataVersion: '1',
};

class NoopVault implements SecureVault {
  async saveEncryptedWalletState(): Promise<void> {}
  async retrieveEncryptedWalletState(): Promise<null> {
    return null;
  }
  async deleteWalletState(): Promise<void> {}
  async hasVault(): Promise<boolean> {
    return false;
  }
  async isVaultValid(): Promise<boolean> {
    return false;
  }
}

class DeterministicEntropy {
  async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
    return new Uint8Array(byteCount);
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    requestId: '42',
    sessionId: 'session-1',
    identity,
    accountId: 'account-1',
    walletAddress: address,
    networkId: 'ethereum',
    chainId: 1n,
    method: 'personal_sign',
    params: ['hello from a DApp', address],
    createdAt: 1,
    expiresAt: null,
    ...overrides,
  };
}

test('normalizes personal_sign while preserving exact bytes and bounded display', () => {
  const parsed = parsePersonalSigningRequest(input());
  assert.equal(parsed.encoding, 'utf8');
  assert.equal(parsed.rawBytes, '0x68656c6c6f2066726f6d20612044417070');
  assert.equal(parsed.display.text, 'hello from a DApp');

  const normalized = normalizeSigningRequest(input());
  assert.equal(normalized.requestType, 'message-signing');
  if (normalized.payload.kind !== 'message-signing') return;
  assert.equal(normalized.payload.rawPayload, parsed.rawBytes);
  assert.equal(normalized.payload.message, parsed.display.text);
});

test('accepts hex personal_sign and rejects malformed or mismatched requests', () => {
  const parsed = parsePersonalSigningRequest(
    input({ params: [address, '0x6869'] }),
  );
  assert.equal(parsed.encoding, 'hex');
  assert.equal(parsed.rawBytes, '0x6869');
  assert.equal(parsed.display.text, 'hi');

  assert.throws(
    () => parsePersonalSigningRequest(input({ params: ['0x123', address] })),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_REQUEST',
  );
  assert.throws(
    () =>
      normalizeSigningRequest(
        input({ walletAddress: '0x0000000000000000000000000000000000000001' }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_REQUEST',
  );
});

test('validates typed-data structure, chain binding, and display metadata', () => {
  const typedData = JSON.stringify({
    domain: {
      name: 'Example',
      version: '1',
      chainId: 1,
      verifyingContract: address,
    },
    types: {
      Mail: [
        { name: 'contents', type: 'string' },
      ],
    },
    primaryType: 'Mail',
    message: { contents: 'hello' },
  });
  const parsed = parseTypedDataSigningRequest(
    input({
      method: 'eth_signTypedData_v4',
      params: [address, typedData],
    }),
  );
  assert.equal(parsed.chainId, 1n);
  assert.equal(parsed.verifyingContract?.toLowerCase(), address.toLowerCase());
  assert.equal(parsed.document.primaryType, 'Mail');

  const normalized = normalizeSigningRequest(
    input({
      method: 'eth_signTypedData_v4',
      params: [address, typedData],
    }),
  );
  assert.equal(normalized.requestType, 'typed-data-signing');
  assert.throws(
    () =>
      normalizeSigningRequest(
        input({
          method: 'eth_signTypedData_v4',
          params: [address, typedData.replace('"chainId":1', '"chainId":2')],
        }),
      ),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'INVALID_REQUEST',
  );
});

test('message signing requires explicit authentication and binds the request digest', async () => {
  const registry = defaultNetworkRegistry;
  registry.selectActiveNetwork('ethereum');
  let unlocks = 0;
  let seenDigest: string | null = null;
  const keyAccess: MessageSigningKeyAccess = {
    async signPersonalMessage(_capability, _accountId, _message, digest) {
      seenDigest = digest;
      return '0x' + '11'.repeat(65) as `0x${string}`;
    },
    async signTypedData(
      _capability,
      _accountId,
      _typedData: DAppTypedDataDocument,
      digest,
    ) {
      seenDigest = digest;
      return '0x' + '22'.repeat(65) as `0x${string}`;
    },
  };
  const engine = new MessageSigningEngine(registry, keyAccess, {
    authenticator: {
      async unlockWallet() {
        unlocks += 1;
        return { authenticated: true, reason: 'success' as const };
      },
    },
    accounts: [{ accountId: 'account-1', address, index: 0 }],
  });
  const signature = await engine.signPersonalMessage({
    requestId: '42',
    accountId: 'account-1',
    from: address,
    networkId: 'ethereum',
    chainId: 1n,
    message: '0x6869',
  });
  assert.equal(signature.length, 132);
  assert.equal(unlocks, 1);
  assert.equal(typeof seenDigest, 'string');
  const capturedDigest = seenDigest as unknown as string;
  assert.ok(capturedDigest.startsWith('0x'));

  const denied = new MessageSigningEngine(registry, keyAccess, {
    authenticator: {
      async unlockWallet() {
        return { authenticated: false as const, reason: 'cancelled' as const };
      },
    },
    accounts: [{ accountId: 'account-1', address, index: 0 }],
  });
  await assert.rejects(
    denied.signPersonalMessage({
      requestId: '43',
      accountId: 'account-1',
      from: address,
      networkId: 'ethereum',
      chainId: 1n,
      message: '0x6869',
    }),
    (error: unknown) =>
      error instanceof DAppError && error.code === 'PERMISSION_DENIED',
  );
});

test('local wallet engine produces a verifiable personal-sign signature without exposing keys', async () => {
  const wallet = new LocalWalletEngine(new NoopVault(), new DeterministicEntropy());
  await wallet.prepareImportWallet(
    'test test test test test test test test test test test junk',
  );
  const [account] = await wallet.getAccounts();
  assert.ok(account);
  const registry = defaultNetworkRegistry;
  registry.selectActiveNetwork('ethereum');
  const engine = new MessageSigningEngine(registry, wallet, {
    authenticator: {
      async unlockWallet() {
        return { authenticated: true, reason: 'success' as const };
      },
    },
    accounts: [account],
  });
  const signature = await engine.signPersonalMessage({
    requestId: 'local-1',
    accountId: account.accountId,
    from: account.address,
    networkId: 'ethereum',
    chainId: 1n,
    message: '0x68656c6c6f',
  });
  assert.equal(
    await verifyMessage({
      address: account.address as `0x${string}`,
      message: { raw: '0x68656c6c6f' },
      signature,
    }),
    true,
  );
});