export const radius = {
  none: 0,
  sm: 10,
  md: 16,
  lg: 24,
  sheet: 28,
  pill: 999,
} as const;

export type DesignRadius = typeof radius;