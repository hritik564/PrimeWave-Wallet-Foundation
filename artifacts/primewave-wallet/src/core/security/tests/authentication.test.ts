import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHENTICATION_STORAGE_KEY,
  AuthenticationManager,
  type AuthenticationStorage,
  type BiometricProvider,
  type EntropyProvider,
} from '../authentication';

class MemoryStorage implements AuthenticationStorage {
  private readonly values = new Map<string, string>();

  async isAvailableAsync(): Promise<boolean> {
    return true;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

class FixedEntropy implements EntropyProvider {
  async getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
    return Uint8Array.from({ length: byteCount }, (_, index) => index + 1);
  }
}

class MockBiometrics implements BiometricProvider {
  enrolled = true;
  types = [2];
  response: { success: boolean; error?: string } = { success: true };

  async isHardwareEnrolledAsync(): Promise<boolean> {
    return this.enrolled;
  }

  async supportedAuthenticationTypesAsync(): Promise<number[]> {
    return this.types;
  }

  async authenticateAsync(): Promise<{ success: boolean; error?: string }> {
    return this.response;
  }
}

function createManager(
  storage = new MemoryStorage(),
  options: { now?: () => number; biometrics?: MockBiometrics } = {},
) {
  return {
    storage,
    manager: new AuthenticationManager({
      storage,
      entropyProvider: new FixedEntropy(),
      biometricProvider: options.biometrics ?? new MockBiometrics(),
      now: options.now,
    }),
  };
}

test('configures a salted scrypt PIN verifier without storing the PIN', async () => {
  const { manager, storage } = createManager();

  await manager.configurePinAuthentication('482913');

  const rawRecord = storage.get(AUTHENTICATION_STORAGE_KEY);
  assert.ok(rawRecord);
  assert.equal(rawRecord.includes('482913'), false);
  assert.equal(rawRecord.includes('pin'), false);
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
  assert.deepEqual(await manager.authenticateWithPin('000000'), {
    authenticated: false,
    reason: 'rejected',
  });
});

test('backs off repeated PIN failures without permanent lockout', async () => {
  let now = 10_000;
  const { manager } = createManager(new MemoryStorage(), { now: () => now });

  await manager.configurePinAuthentication('482913');
  assert.deepEqual(await manager.authenticateWithPin('000000'), {
    authenticated: false,
    reason: 'rejected',
  });
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: false,
    reason: 'locked',
  });

  now += 1_000;
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
});

test('changing the PIN invalidates the old PIN and preserves access', async () => {
  const { manager } = createManager();

  await manager.configurePinAuthentication('482913');
  assert.deepEqual(await manager.changePin('482913', '719204'), {
    authenticated: true,
    reason: 'success',
  });
  assert.deepEqual(await manager.authenticateWithPin('719204'), {
    authenticated: true,
    reason: 'success',
  });
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: false,
    reason: 'rejected',
  });
});

test('uses platform biometrics only after they are enabled', async () => {
  const biometrics = new MockBiometrics();
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  assert.deepEqual(await manager.authenticateWithBiometrics(), {
    authenticated: false,
    reason: 'not-configured',
  });

  await manager.setBiometricUnlockEnabled(true);
  assert.deepEqual(await manager.determineBiometricAvailability(), {
    available: true,
    type: 'face',
  });
  assert.deepEqual(await manager.authenticateWithBiometrics(), {
    authenticated: true,
    reason: 'success',
  });
});

test('cancelled and unavailable biometrics remain locked for PIN fallback', async () => {
  const biometrics = new MockBiometrics();
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);
  biometrics.response = { success: false, error: 'user_cancel' };
  assert.deepEqual(await manager.authenticateWithBiometrics(), {
    authenticated: false,
    reason: 'cancelled',
  });
  assert.equal(manager.getLockState(), 'AUTHENTICATION_FAILED');

  biometrics.enrolled = false;
  assert.deepEqual(await manager.determineBiometricAvailability(), {
    available: false,
    type: 'face',
  });
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
});

test('the secure default locks immediately when the app backgrounds', async () => {
  let callbackCount = 0;
  const { manager } = createManager();
  const lockingManager = new AuthenticationManager({
    storage: new MemoryStorage(),
    entropyProvider: new FixedEntropy(),
    biometricProvider: new MockBiometrics(),
    onLock: () => {
      callbackCount += 1;
    },
  });

  await manager.configurePinAuthentication('482913');
  await manager.handleAppStateChange('background');
  assert.equal(manager.getLockState(), 'LOCKED');

  await lockingManager.configurePinAuthentication('482913');
  await lockingManager.handleAppStateChange('background');
  assert.equal(lockingManager.getLockState(), 'LOCKED');
  assert.equal(callbackCount, 1);
});