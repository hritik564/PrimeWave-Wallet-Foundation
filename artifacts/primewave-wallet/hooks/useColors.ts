import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the PrimeWave semantic tokens for the active color scheme.
 *
 * The wallet keeps the dark PrimeWave palette for both system schemes so the
 * foundation remains intentional and consistent.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette =
    scheme === 'dark'
      ? colors.dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}