import { getAddress, isAddress } from 'viem';
import { AccountStateError } from './errors';

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function normalizePublicEvmAddress(address: unknown): string {
  if (typeof address !== 'string' || !EVM_ADDRESS_PATTERN.test(address)) {
    throw new AccountStateError('INVALID_ADDRESS');
  }

  const isUniformCase =
    address === address.toLowerCase() || address === address.toUpperCase();
  if (!isUniformCase && !isAddress(address, { strict: true })) {
    throw new AccountStateError('INVALID_ADDRESS');
  }

  try {
    return getAddress(address);
  } catch {
    throw new AccountStateError('INVALID_ADDRESS');
  }
}