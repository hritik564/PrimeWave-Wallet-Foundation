import {
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { getAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import type { WalletAccount } from './models';

export const EVM_DERIVATION_PREFIX = "m/44'/60'/0'/0";

export function normalizeRecoveryPhrase(recoveryPhrase: string): string {
  return recoveryPhrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export class WalletCoreError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_MNEMONIC'
      | 'INVALID_ACCOUNT_INDEX'
      | 'WALLET_NOT_CREATED'
      | 'DERIVATION_FAILED'
      | 'SIGNING_ACCESS_DENIED'
      | 'SIGNING_ACCOUNT_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'WalletCoreError';
  }
}

export function validateRecoveryPhrase(recoveryPhrase: string): boolean {
  try {
    return validateMnemonic(recoveryPhrase, wordlist);
  } catch {
    return false;
  }
}

function assertValidAccountIndex(accountIndex: number): void {
  if (
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex >= 2 ** 31
  ) {
    throw new WalletCoreError(
      'INVALID_ACCOUNT_INDEX',
      'The account index is invalid.',
    );
  }
}

function assertValidRecoveryPhrase(recoveryPhrase: string): void {
  if (!validateRecoveryPhrase(recoveryPhrase)) {
    throw new WalletCoreError(
      'INVALID_MNEMONIC',
      'The recovery phrase is invalid.',
    );
  }
}

function derivePublicAccount(
  recoveryPhrase: string,
  accountIndex: number,
): WalletAccount {
  assertValidAccountIndex(accountIndex);
  const derivationPath = `${EVM_DERIVATION_PREFIX}/${accountIndex}`;
  const account = mnemonicToAccount(recoveryPhrase, {
    accountIndex: 0,
    changeIndex: 0,
    addressIndex: accountIndex,
  });

  return {
    accountId: `account-${accountIndex}`,
    index: accountIndex,
    address: getAddress(account.address),
    derivationPath,
  };
}

export function derivePublicAccountFromMnemonic(
  recoveryPhrase: string,
  accountIndex: number,
): WalletAccount {
  assertValidAccountIndex(accountIndex);
  assertValidRecoveryPhrase(recoveryPhrase);

  return derivePublicAccount(recoveryPhrase, accountIndex);
}

export function derivePublicAccountsFromMnemonic(
  recoveryPhrase: string,
  accountCount: number,
): WalletAccount[] {
  if (
    !Number.isSafeInteger(accountCount) ||
    accountCount < 0 ||
    accountCount >= 2 ** 31
  ) {
    throw new WalletCoreError(
      'INVALID_ACCOUNT_INDEX',
      'The account count is invalid.',
    );
  }

  assertValidRecoveryPhrase(recoveryPhrase);
  return Array.from({ length: accountCount }, (_, accountIndex) =>
    derivePublicAccount(recoveryPhrase, accountIndex),
  );
}