import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPreviewTestModeAvailable,
  PreviewTestMode,
} from './preview-test-mode';

type PreviewStorage = {
  readonly values: Map<string, string>;
  readonly localStorage: Storage;
};

function installPreviewEnvironment(dev: boolean): {
  readonly storage: PreviewStorage;
  readonly restore: () => void;
} {
  const previousDev = (globalThis as Record<string, unknown>).__DEV__;
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const previousWindow = (globalThis as Record<string, unknown>).window;
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;

  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value: dev,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  return {
    storage: { values, localStorage },
    restore: () => {
      if (previousDev === undefined) delete (globalThis as Record<string, unknown>).__DEV__;
      else Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: previousDev });
      if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
      if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    },
  };
}

test('Preview Test Mode is available only in development web previews', () => {
  const development = installPreviewEnvironment(true);
  try {
    assert.equal(isPreviewTestModeAvailable(), true);
  } finally {
    development.restore();
  }

  const production = installPreviewEnvironment(false);
  try {
    assert.equal(isPreviewTestModeAvailable(), false);
  } finally {
    production.restore();
  }
});

test('uses only public simulated state for create, PIN, lock, unlock, and reset', () => {
  const environment = installPreviewEnvironment(true);
  try {
    const preview = new PreviewTestMode();
    assert.deepEqual(preview.getState(), {
      hasPreviewWallet: false,
      phase: 'onboarding',
      pinConfigured: false,
    });

    const wallet = preview.createPreviewWallet();
    assert.equal(wallet.accounts[0].address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    assert.equal(environment.storage.values.size, 1);
    const storedState = [...environment.storage.values.values()][0];
    assert.equal(storedState.includes('mnemonic'), false);
    assert.equal(storedState.includes('privateKey'), false);
    assert.equal(storedState.includes('recoveryPhrase'), false);
    assert.equal(storedState.includes('482913'), false);

    assert.throws(() => preview.setPreviewPin('12345'), /exactly 6 digits/);
    assert.throws(() => preview.setPreviewPin('12ab56'), /exactly 6 digits/);
    preview.setPreviewPin('482913');
    assert.equal(preview.getState().phase, 'unlocked');
    assert.equal(preview.verifyPreviewPin('000000'), false);
    assert.equal(preview.verifyPreviewPin('482913'), true);
    assert.ok(preview.getWallet());
    assert.equal(new PreviewTestMode().getState().phase, 'unlocked');

    preview.lockPreviewWallet();
    assert.equal(preview.getState().phase, 'locked');
    assert.equal(preview.getWallet(), null);
    assert.equal(preview.getDisplayWallet().accounts[0].address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    assert.equal(preview.verifyPreviewPin('482913'), true);

    preview.resetPreviewWallet();
    preview.resetPreviewWallet();
    assert.deepEqual(preview.getState(), {
      hasPreviewWallet: false,
      phase: 'onboarding',
      pinConfigured: false,
    });
  } finally {
    environment.restore();
  }
});