import { colors } from './colors';
import { motion } from '../motion';
import { radius } from './radius';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { typography } from '../typography';

export { colors } from './colors';
export { motion } from '../motion';
export { radius } from './radius';
export { shadows } from './shadows';
export { spacing } from './spacing';
export { typography } from '../typography';

export const gradients = {
  background: [colors.background, '#0b1330', colors.background] as const,
  accent: [colors.accent, colors.primary, colors.violet] as const,
  panel: [colors.surfaceElevated, '#0d152c'] as const,
} as const;

export const states = {
  pressedOpacity: motion.pressedOpacity,
  disabledOpacity: motion.disabledOpacity,
  focusRing: colors.focus,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
  info: colors.info,
} as const;

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  gradients,
  shadows,
  states,
  motion,
} as const;

export type DesignTheme = typeof theme;