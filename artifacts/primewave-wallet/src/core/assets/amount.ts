import { AssetError } from './errors';

const MAX_DECIMALS = 36;

export function validateAssetDecimals(decimals: number): number {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_DECIMALS
  ) {
    throw new AssetError('ASSET_INVALID_METADATA');
  }
  return decimals;
}

export function formatAssetAmount(rawAmount: bigint, decimals: number): string {
  validateAssetDecimals(decimals);
  if (typeof rawAmount !== 'bigint' || rawAmount < 0n) {
    throw new AssetError('INVALID_AMOUNT');
  }
  if (decimals === 0) {
    return rawAmount.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = rawAmount / base;
  const fraction = (rawAmount % base).toString().padStart(decimals, '0');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction.length === 0
    ? whole.toString()
    : `${whole.toString()}.${trimmedFraction}`;
}

export function parseAssetAmount(
  input: string,
  decimals: number,
): bigint {
  validateAssetDecimals(decimals);
  if (typeof input !== 'string' || input.length === 0) {
    throw new AssetError('MALFORMED_AMOUNT');
  }

  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(input);
  if (!match) {
    throw new AssetError('MALFORMED_AMOUNT');
  }

  const wholePart = match[1];
  const fractionPart = match[2] ?? '';
  if (fractionPart.length > decimals) {
    throw new AssetError('DECIMAL_OVERFLOW');
  }

  const paddedFraction = fractionPart.padEnd(decimals, '0');
  const digits = `${wholePart}${paddedFraction}`;
  try {
    return BigInt(digits);
  } catch {
    throw new AssetError('DECIMAL_OVERFLOW');
  }
}