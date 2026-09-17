import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';
import type { EvmNetwork } from '@/src/core/networks';
import { createReceiveShareMessage } from './receive.logic';

export type ShareResult = 'shared' | 'cancelled' | 'unavailable';

export async function copyPublicText(value: string): Promise<void> {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error('PUBLIC_ADDRESS_UNAVAILABLE');
  await Clipboard.setStringAsync(normalized);
}

export async function copyPublicAddress(address: string): Promise<void> {
  await copyPublicText(address);
}

export async function pastePublicAddress(): Promise<string> {
  const value = await Clipboard.getStringAsync();
  return typeof value === 'string' ? value : '';
}

export function createPublicAddressShareMessage(
  network: EvmNetwork,
  address: string,
): string {
  return createReceiveShareMessage(network.displayName, address);
}

export async function sharePublicAddress(
  message: string,
  title = 'WAVEX public address',
): Promise<ShareResult> {
  try {
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      await navigator.share({ title, text: message });
      return 'shared';
    }

    if (Platform.OS === 'web') return 'unavailable';

    const result = await Share.share({ message, title });
    return result.action === Share.sharedAction ? 'shared' : 'cancelled';
  } catch {
    return 'unavailable';
  }
}