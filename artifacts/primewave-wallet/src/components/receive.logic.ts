import type { EvmNetwork } from '@/src/core/networks';

export const RECEIVE_QR_SIZE = 224;
export const RECEIVE_QR_QUIET_ZONE = 12;
export const RECEIVE_QR_ERROR_CORRECTION = 'M' as const;

export function createReceiveQrPayload(address: string): string | null {
  const normalized = address.trim();
  return normalized.length === 0 ? null : normalized;
}

export function createReceiveShareMessage(
  networkName: string,
  address: string,
): string {
  return `WAVEX address — ${networkName}:\n${address.trim()}`;
}

export function receiveNetworkStatus(network: EvmNetwork): {
  label: 'Configured' | 'Not configured' | 'Disabled';
  configured: boolean;
} {
  if (!network.enabled) return { label: 'Disabled', configured: false };
  if (network.configurationStatus !== 'configured' || network.chainId === null) {
    return { label: 'Not configured', configured: false };
  }
  return { label: 'Configured', configured: true };
}
export function receivingNetworks(networks: readonly EvmNetwork[]) {
  return networks.filter(network => receiveNetworkStatus(network).configured || network.id === 'primewave');
}

export function receivingAddress(network: EvmNetwork, publicAddress: string) {
  if (!receiveNetworkStatus(network).configured || !/^0x[0-9a-fA-F]{40}$/.test(publicAddress)) return null;
  return publicAddress;
}

export function receivingExplorer(network: EvmNetwork, publicAddress: string) {
  const address = receivingAddress(network, publicAddress);
  return address ? network.explorer.addressUrlTemplate?.replace('{address}', address) ?? null : null;
}
