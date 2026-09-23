export const motion = {
  duration: {
    fast: 120,
    standard: 220,
    slow: 340,
  },
  easing: {
    standard: 'easeInOut',
    entrance: 'easeOut',
  },
  pressScale: 0.98,
  disabledOpacity: 0.4,
  pressedOpacity: 0.76,
} as const;

export type DesignMotion = typeof motion;