import { walletHomeColors as brand } from './wallet-home';

export const colors = {
  text: brand.text,
  tint: brand.blue,
  background: brand.background,
  foreground: brand.text,
  card: brand.surface,
  cardForeground: brand.text,
  primary: brand.blue,
  primaryForeground: brand.background,
  secondary: '#16213d',
  secondaryForeground: '#dce4ff',
  muted: '#111a31',
  mutedForeground: brand.secondaryText,
  accent: brand.cyan,
  accentForeground: '#07101d',
  destructive: '#ff7387',
  destructiveForeground: '#210b13',
  border: brand.divider,
  input: brand.divider,

  // Semantic aliases for new WaveX primitives.
  surface: brand.surface,
  surfaceElevated: '#16213d',
  surfacePressed: '#1d2b4f',
  textPrimary: brand.text,
  textSecondary: '#dce4ff',
  textMuted: brand.secondaryText,
  textDisabled: '#5f6f95',
  borderSubtle: brand.divider,
  borderActive: brand.cyan,
  focus: brand.cyan,
  info: '#6aa7ff',
  violet: brand.violet,
  success: '#65e6a6',
  warning: '#f4c86b',
  error: '#ff7387',
  disabled: '#5f6f95',
} as const;

export type DesignColors = typeof colors;