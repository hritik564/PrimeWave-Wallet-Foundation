import assert from 'node:assert/strict';
import test from 'node:test';
import {
  derivePublicAccountFromMnemonic,
  derivePublicAccountsFromMnemonic,
  EVM_DERIVATION_PREFIX,
  validateRecoveryPhrase,
  WalletCoreError,
} from '../derivation';
import { validateEvmAddress } from '../address';

const hardhatMnemonic =
  'test test test test test test test test test test test junk';

const expectedAddresses = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];

test('validates the known BIP-39 recovery phrase', () => {
  assert.equal(validateRecoveryPhrase(hardhatMnemonic), true);
  assert.equal(
    validateRecoveryPhrase(
      'test test test test test test test test test test test wrong',
    ),
    false,
  );
});

test('derives the known EVM account 0 vector', () => {
  const account = derivePublicAccountFromMnemonic(hardhatMnemonic, 0);

  assert.equal(account.address, expectedAddresses[0]);
  assert.equal(account.index, 0);
  assert.equal(account.derivationPath, `${EVM_DERIVATION_PREFIX}/0`);
  assert.equal('privateKey' in account, false);
});

test('derives deterministic account 0, 1, and 2 addresses', () => {
  const accounts = derivePublicAccountsFromMnemonic(hardhatMnemonic, 3);

  assert.deepEqual(
    accounts.map((account) => account.address),
    expectedAddresses,
  );
  assert.deepEqual(
    accounts.map((account) => account.derivationPath),
    [0, 1, 2].map((index) => `${EVM_DERIVATION_PREFIX}/${index}`),
  );
});

test('repeated derivation produces identical public accounts', () => {
  const first = derivePublicAccountFromMnemonic(hardhatMnemonic, 1);
  const second = derivePublicAccountFromMnemonic(hardhatMnemonic, 1);

  assert.deepEqual(first, second);
});

test('rejects invalid derivation indexes', () => {
  assert.throws(
    () => derivePublicAccountFromMnemonic(hardhatMnemonic, -1),
    (error: unknown) =>
      error instanceof WalletCoreError &&
      error.code === 'INVALID_ACCOUNT_INDEX',
  );
  assert.throws(
    () => derivePublicAccountFromMnemonic(hardhatMnemonic, 2 ** 31),
    (error: unknown) =>
      error instanceof WalletCoreError &&
      error.code === 'INVALID_ACCOUNT_INDEX',
  );
});

test('classifies valid, invalid, and malformed EVM addresses', () => {
  assert.equal(validateEvmAddress(expectedAddresses[0]).kind, 'valid');
  assert.equal(
    validateEvmAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92267').kind,
    'invalid',
  );
  assert.equal(validateEvmAddress('not-an-address').kind, 'malformed');
});

test('public wallet metadata does not contain mnemonic material', () => {
  const accounts = derivePublicAccountsFromMnemonic(hardhatMnemonic, 1);
  const publicWallet = {
    walletId: 'wallet-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    accountCount: accounts.length,
    accounts,
  };

  assert.equal('mnemonic' in publicWallet, false);
  assert.equal('privateKey' in publicWallet.accounts[0], false);
});