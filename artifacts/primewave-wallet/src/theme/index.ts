import colors from '@/constants/colors';

export const theme = {
  colors: colors.dark,
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 24,
    pill: 999,
  },
  typography: {
    eyebrow: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 11,
      letterSpacing: 1.8,
      lineHeight: 16,
    },
    title: {
      fontFamily: 'Inter_700Bold',
      fontSize: 34,
      letterSpacing: -1.2,
      lineHeight: 40,
    },
    body: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 25,
    },
    bodyMedium: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 21,
    },
    label: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      letterSpacing: 0.4,
      lineHeight: 18,
    },
  },
  gradients: {
    background: ['#070b19', '#0b1330', '#070b19'] as const,
    accent: ['#50d9ff', '#7c8cff', '#ab78ff'] as const,
    panel: ['#121d38', '#0d152c'] as const,
  },
  shadows: {
    glow: {
      shadowColor: '#50d9ff',
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    panel: {
      shadowColor: '#000000',
      shadowOpacity: 0.3,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  },
  states: {
    pressedOpacity: 0.76,
    disabledOpacity: 0.4,
    focusRing: '#50d9ff',
    success: '#65e6a6',
    warning: '#f4c86b',
  },
} as const;

export type Theme = typeof theme;