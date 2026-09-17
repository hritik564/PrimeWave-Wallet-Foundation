import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { EncryptedWalletState, SecureVault } from '@/src/core/security';

export const CURRENT_VAULT_VERSION = 1 as const;
export const VAULT_STORAGE_KEY = 'primewave.wallet.vault';
const MAX_ACCOUNT_INDEXES = 1_000;

export interface WalletVaultRecord {
  walletId: string;
  createdAt: string;
  accountIndexes: number[];
  mnemonic: string;
}

export interface SecureKeyValueStorage {
  isAvailableAsync(): Promise<boolean>;
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

export type WalletVaultErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_DELETE_FAILED'
  | 'MALFORMED_VAULT'
  | 'UNSUPPORTED_VAULT_VERSION'
  | 'INVALID_VAULT_STATE';

export class WalletVaultError extends Error {
  constructor(
    public readonly code: WalletVaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WalletVaultError';
  }
}

const secretStates = new WeakMap<
  EncryptedWalletState,
  WalletVaultRecord
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidAccountIndexes(value: unknown): value is number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ACCOUNT_INDEXES
  ) {
    return false;
  }

  const indexes = value.filter(
    (index): index is number =>
      Number.isSafeInteger(index) && index >= 0 && index < 2 ** 31,
  );

  return (
    indexes.length === value.length &&
    new Set(indexes).size === indexes.length &&
    indexes.includes(0)
  );
}

function validateVaultRecord(record: WalletVaultRecord): void {
  if (
    !record.walletId ||
    record.walletId.length > 128 ||
    !record.createdAt ||
    record.createdAt.length > 128 ||
    !isValidAccountIndexes(record.accountIndexes) ||
    !validateMnemonic(record.mnemonic, wordlist)
  ) {
    throw new WalletVaultError(
      'INVALID_VAULT_STATE',
      'The wallet vault state is invalid.',
    );
  }
}

function cloneRecord(record: WalletVaultRecord): WalletVaultRecord {
  validateVaultRecord(record);
  return {
    walletId: record.walletId,
    createdAt: record.createdAt,
    accountIndexes: [...record.accountIndexes].sort(
      (left, right) => left - right,
    ),
    mnemonic: record.mnemonic,
  };
}

export function createEncryptedWalletState(
  record: WalletVaultRecord,
): EncryptedWalletState {
  const state = Object.freeze({
    kind: 'encrypted-wallet-state',
  }) as EncryptedWalletState;

  secretStates.set(state, cloneRecord(record));
  return state;
}

export function consumeEncryptedWalletState(
  state: EncryptedWalletState,
): WalletVaultRecord {
  const record = secretStates.get(state);
  secretStates.delete(state);

  if (!record) {
    throw new WalletVaultError(
      'INVALID_VAULT_STATE',
      'The wallet vault state is invalid.',
    );
  }

  return record;
}

function parseStoredVault(payload: string): WalletVaultRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new WalletVaultError(
      'MALFORMED_VAULT',
      'The wallet vault could not be read.',
    );
  }

  if (!isRecord(parsed) || typeof parsed.vaultVersion !== 'number') {
    throw new WalletVaultError(
      'MALFORMED_VAULT',
      'The wallet vault could not be read.',
    );
  }

  if (parsed.vaultVersion !== CURRENT_VAULT_VERSION) {
    throw new WalletVaultError(
      'UNSUPPORTED_VAULT_VERSION',
      'The wallet vault version is not supported.',
    );
  }

  const wallet = parsed.wallet;
  const secret = parsed.secret;

  if (
    !isRecord(wallet) ||
    !isRecord(secret) ||
    typeof wallet.walletId !== 'string' ||
    typeof wallet.createdAt !== 'string' ||
    !isValidAccountIndexes(wallet.accountIndexes) ||
    typeof secret.mnemonic !== 'string'
  ) {
    throw new WalletVaultError(
      'MALFORMED_VAULT',
      'The wallet vault could not be read.',
    );
  }

  const record: WalletVaultRecord = {
    walletId: wallet.walletId,
    createdAt: wallet.createdAt,
    accountIndexes: wallet.accountIndexes,
    mnemonic: secret.mnemonic,
  };

  validateVaultRecord(record);
  return cloneRecord(record);
}

export class SecureWalletVault implements SecureVault {
  constructor(private readonly storage: SecureKeyValueStorage) {}

  async saveEncryptedWalletState(
    state: EncryptedWalletState,
  ): Promise<void> {
    const record = consumeEncryptedWalletState(state);
    const payload = JSON.stringify({
      vaultVersion: CURRENT_VAULT_VERSION,
      wallet: {
        walletId: record.walletId,
        createdAt: record.createdAt,
        accountIndexes: record.accountIndexes,
      },
      secret: {
        mnemonic: record.mnemonic,
      },
    });

    await this.ensureAvailable();

    try {
      await this.storage.setItemAsync(VAULT_STORAGE_KEY, payload);
    } catch {
      throw new WalletVaultError(
        'STORAGE_WRITE_FAILED',
        'The wallet vault could not be saved.',
      );
    }
  }

  async retrieveEncryptedWalletState(): Promise<EncryptedWalletState | null> {
    await this.ensureAvailable();

    let payload: string | null;
    try {
      payload = await this.storage.getItemAsync(VAULT_STORAGE_KEY);
    } catch {
      throw new WalletVaultError(
        'STORAGE_READ_FAILED',
        'The wallet vault could not be read.',
      );
    }

    return payload === null
      ? null
      : createEncryptedWalletState(parseStoredVault(payload));
  }

  async deleteWalletState(): Promise<void> {
    await this.ensureAvailable();

    try {
      await this.storage.deleteItemAsync(VAULT_STORAGE_KEY);
    } catch {
      throw new WalletVaultError(
        'STORAGE_DELETE_FAILED',
        'The wallet vault could not be deleted.',
      );
    }
  }

  async hasVault(): Promise<boolean> {
    await this.ensureAvailable();

    try {
      return (await this.storage.getItemAsync(VAULT_STORAGE_KEY)) !== null;
    } catch {
      throw new WalletVaultError(
        'STORAGE_READ_FAILED',
        'The wallet vault could not be read.',
      );
    }
  }

  async isVaultValid(): Promise<boolean> {
    try {
      const state = await this.retrieveEncryptedWalletState();
      if (!state) {
        return false;
      }

      const record = consumeEncryptedWalletState(state);
      record.mnemonic = '';
      return true;
    } catch {
      return false;
    }
  }

  private async ensureAvailable(): Promise<void> {
    let available = false;

    try {
      available = await this.storage.isAvailableAsync();
    } catch {
      available = false;
    }

    if (!available) {
      throw new WalletVaultError(
        'STORAGE_UNAVAILABLE',
        'Secure wallet storage is unavailable on this platform.',
      );
    }
  }
}