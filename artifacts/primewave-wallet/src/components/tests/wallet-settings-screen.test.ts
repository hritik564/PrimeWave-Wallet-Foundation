import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWalletSettingsSections,
  settingsVersionLabel,
} from '../WalletSettingsScreen.logic';

const accountAddress = '0x1Ef7EA6f787891789852f5E51896966b51589a62';

function createInput(
  overrides: Partial<Parameters<typeof createWalletSettingsSections>[0]> = {},
) {
  return {
    accountLabel: 'Account 1',
    accountIndex: 0,
    accountAddress,
    networkName: 'BNB Smart Chain',
    networkStatus: 'Configured',
    previewMode: false,
    authenticationSettings: {
      biometricEnabled: false,
      autoLockPolicy: 0 as const,
      pinConfigured: true,
    },
    biometricAvailability: {
      available: false,
      type: null,
    },
    ...overrides,
  };
}

function rows(input = createInput()) {
  return createWalletSettingsSections(input).flatMap((section) => section.rows);
}

test('builds all Settings information-architecture sections and core rows', () => {
  const sections = createWalletSettingsSections(createInput());

  assert.deepEqual(
    sections.map((section) => section.id),
    ['wallet', 'security', 'preferences', 'about'],
  );
  assert.deepEqual(
    sections[0]?.rows.map((row) => row.id),
    ['account', 'network', 'lock'],
  );
  assert.equal(rows().find((row) => row.id === 'account')?.action, 'account');
  assert.equal(rows().find((row) => row.id === 'network')?.action, 'network');
  assert.equal(rows().find((row) => row.id === 'lock')?.action, 'lock');
});

test('uses a shortened public address and never includes secrets in Settings data', () => {
  const modelText = JSON.stringify(createWalletSettingsSections(createInput()));

  assert.match(modelText, /0x1Ef7…9a62/);
  assert.doesNotMatch(modelText, new RegExp(accountAddress));
  assert.doesNotMatch(
    modelText,
    /mnemonic|private.?key|seed phrase|vault key|securestore contents|recovery phrase words/i,
  );
});

test('reports safe native security status without exposing authentication material', () => {
  const model = rows();

  assert.equal(model.find((row) => row.id === 'pin')?.value, 'PIN configured');
  assert.equal(model.find((row) => row.id === 'biometric')?.value, 'Unavailable');
  assert.equal(model.find((row) => row.id === 'secure-storage')?.value, 'Managed by device');
  assert.equal(
    model.find((row) => row.id === 'recovery')?.value,
    'Managed securely on this device',
  );
  assert.equal(model.find((row) => row.id === 'security-controls')?.action, 'security');
});

test('isolates Preview security and lock behavior from native controls', () => {
  const previewRows = rows(
    createInput({
      previewMode: true,
      biometricAvailability: { available: true, type: 'face' },
    }),
  );

  assert.equal(
    previewRows.find((row) => row.id === 'pin')?.value,
    'Preview PIN configured',
  );
  assert.equal(
    previewRows.find((row) => row.id === 'biometric')?.value,
    'Not available in Preview',
  );
  assert.equal(
    previewRows.find((row) => row.id === 'secure-storage')?.value,
    'Not used in Preview',
  );
  assert.equal(
    previewRows.find((row) => row.id === 'recovery')?.value,
    'Not used in Preview',
  );
  assert.equal(previewRows.find((row) => row.id === 'security-controls')?.action, null);
});

test('keeps unsupported notifications, display, and About links controlled', () => {
  const model = rows();

  assert.equal(
    model.find((row) => row.id === 'notifications')?.value,
    'Not configured yet',
  );
  assert.equal(model.find((row) => row.id === 'display')?.action, 'coming-soon');
  assert.equal(model.find((row) => row.id === 'privacy')?.action, null);
  assert.equal(model.find((row) => row.id === 'terms')?.action, null);
  assert.equal(model.find((row) => row.id === 'support')?.action, null);
});

test('uses the native application version when available and honest development labels otherwise', () => {
  assert.equal(settingsVersionLabel('1.0.0', 'ios'), '1.0.0');
  assert.equal(settingsVersionLabel(null, 'web'), 'Development build');
  assert.equal(settingsVersionLabel(null, 'android'), 'Unavailable');
});