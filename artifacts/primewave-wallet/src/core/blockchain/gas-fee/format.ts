import { GasFeeError } from './errors';

export function formatNativeUnits(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isSafeInteger(decimals) || decimals < 0) {
    throw new GasFeeError('INVALID_QUANTITY');
  }
  if (decimals === 0) {
    return value.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed.length === 0
    ? whole.toString()
    : `${whole.toString()}.${trimmed}`;
}