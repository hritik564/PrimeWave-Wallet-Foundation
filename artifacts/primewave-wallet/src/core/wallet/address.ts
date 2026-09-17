import { getAddress, isAddress } from 'viem';

export type EvmAddressValidation =
  | {
      kind: 'valid';
      input: string;
      checksummedAddress: string;
    }
  | {
      kind: 'invalid' | 'malformed';
      input: string;
    };

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function validateEvmAddress(
  address: unknown,
): EvmAddressValidation {
  if (typeof address !== 'string' || !EVM_ADDRESS_PATTERN.test(address)) {
    return {
      kind: 'malformed',
      input: typeof address === 'string' ? address : '',
    };
  }

  const isUniformCase =
    address === address.toLowerCase() || address === address.toUpperCase();
  if (!isUniformCase && !isAddress(address, { strict: true })) {
    return { kind: 'invalid', input: address };
  }

  try {
    return {
      kind: 'valid',
      input: address,
      checksummedAddress: getAddress(address),
    };
  } catch {
    return { kind: 'invalid', input: address };
  }
}