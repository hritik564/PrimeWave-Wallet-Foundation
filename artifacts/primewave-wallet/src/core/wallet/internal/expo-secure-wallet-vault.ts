import * as SecureStore from 'expo-secure-store';
import { SecureWalletVault } from './vault';

class ExpoSecureStoreAdapter {
  isAvailableAsync(): Promise<boolean> {
    return SecureStore.isAvailableAsync();
  }

  setItemAsync(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  getItemAsync(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  deleteItemAsync(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
}

export function createExpoSecureWalletVault(): SecureWalletVault {
  return new SecureWalletVault(new ExpoSecureStoreAdapter());
}