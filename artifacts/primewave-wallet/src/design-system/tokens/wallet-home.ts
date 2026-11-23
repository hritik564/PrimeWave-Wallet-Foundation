export const walletHomeColors = {
  background: '#090B0E',
  surface: '#171A20',
  text: '#F5F6F8',
  secondaryText: '#9299A5',
  cyan: '#0DECFE',
  blue: '#0552F5',
  violet: '#4C20F1',
  divider: '#2B2E34',
} as const;

export const glass = {
  surface: 'rgba(21, 25, 35, 0.94)',
  edge: 'rgba(164, 194, 229, 0.22)',
  blur: 16,
  reflection: ['rgba(13, 236, 254, 0.12)', 'rgba(5, 82, 245, 0.035)', 'rgba(76, 32, 241, 0.10)'] as const,
} as const;

export const glassSurface = {
  backgroundColor: glass.surface,
  borderWidth: 1,
  borderColor: glass.edge,
  overflow: 'hidden',
} as const;
