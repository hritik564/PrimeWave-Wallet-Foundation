export const spacing = {
  none: 0,
  hairline: 1,
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export type DesignSpacing = typeof spacing;