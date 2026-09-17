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
  options: {
    now?: () => number;
    biometrics?: BiometricProvider;
    timeoutMs?: number;
  } = {},
) {
  return {
    storage,
    manager: new AuthenticationManager({
      storage,
      entropyProvider: new FixedEntropy(),
      biometricProvider: options.biometrics ?? new MockBiometrics(),
      now: options.now,
      biometricTimeoutMs: options.timeoutMs,
    }),
  };
}

class DeferredBiometrics extends MockBiometrics {
  private resolveAuthentication:
    | ((response: { success: boolean; error?: string }) => void)
    | null = null;
  private resolveStarted: (() => void) | null = null;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  override async authenticateAsync(): Promise<{ success: boolean; error?: string }> {
    this.resolveStarted?.();
    return new Promise((resolve) => {
      this.resolveAuthentication = resolve;
    });
  }

  resolve(response: { success: boolean; error?: string }): void {
    this.resolveAuthentication?.(response);
  }
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

test('normalizes native biometric exceptions and preserves PIN fallback', async () => {
  const biometrics = new MockBiometrics();
  biometrics.authenticateAsync = async () => {
    throw new Error('native biometric bridge failure');
  };
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);

  assert.deepEqual(await manager.authenticateWithBiometrics(), {
    authenticated: false,
    reason: 'unavailable',
  });
  assert.equal(manager.getLockState(), 'AUTHENTICATION_UNAVAILABLE');
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
});

test('bounds biometric availability and authentication operations', async () => {
  const availabilityTimeout = new MockBiometrics();
  availabilityTimeout.isHardwareEnrolledAsync = async () =>
    new Promise<boolean>(() => {});
  const { manager: availabilityManager } = createManager(
    new MemoryStorage(),
    { biometrics: availabilityTimeout, timeoutMs: 10 },
  );

  assert.deepEqual(await availabilityManager.determineBiometricAvailability(), {
    available: false,
    type: null,
  });

  const authenticationTimeout = new MockBiometrics();
  authenticationTimeout.authenticateAsync = async () =>
    new Promise<{ success: boolean; error?: string }>(() => {});
  const { manager } = createManager(new MemoryStorage(), {
    biometrics: authenticationTimeout,
    timeoutMs: 10,
  });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);
  assert.deepEqual(await manager.authenticateWithBiometrics(), {
    authenticated: false,
    reason: 'unavailable',
  });
  assert.equal(manager.getLockState(), 'AUTHENTICATION_UNAVAILABLE');
});

test('normalizes availability exceptions without affecting PIN fallback', async () => {
  const biometrics = new MockBiometrics();
  biometrics.supportedAuthenticationTypesAsync = async () => {
    throw new Error('native availability bridge failure');
  };
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);

  assert.deepEqual(await manager.determineBiometricAvailability(), {
    available: false,
    type: null,
  });
  assert.deepEqual(await manager.authenticateWithPin('482913'), {
    authenticated: true,
    reason: 'success',
  });
});

test('defers background locking while a biometric prompt is active', async () => {
  const biometrics = new DeferredBiometrics();
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);

  const authentication = manager.authenticateWithBiometrics();
  await biometrics.started;
  await manager.handleAppStateChange('inactive');
  assert.equal(manager.getLockState(), 'UNLOCKING');

  await manager.handleAppStateChange('active');
  biometrics.resolve({ success: true });

  assert.deepEqual(await authentication, {
    authenticated: true,
    reason: 'success',
  });
  assert.equal(manager.getLockState(), 'UNLOCKED');
});

test('locks instead of restoring the wallet when the prompt remains backgrounded', async () => {
  const biometrics = new DeferredBiometrics();
  const { manager } = createManager(new MemoryStorage(), { biometrics });

  await manager.configurePinAuthentication('482913');
  await manager.setBiometricUnlockEnabled(true);

  const authentication = manager.authenticateWithBiometrics();
  await biometrics.started;
  await manager.handleAppStateChange('background');
  biometrics.resolve({ success: true });

  assert.deepEqual(await authentication, {
    authenticated: false,
    reason: 'locked',
  });
  assert.equal(manager.getLockState(), 'LOCKED');
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