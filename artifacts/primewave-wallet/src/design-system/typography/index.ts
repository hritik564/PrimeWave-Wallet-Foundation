export const typography = {
  // Legacy aliases keep existing production screens source-compatible while
  // the new semantic names are adopted incrementally.
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.8,
    fontWeight: '600' as const,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1.2,
    fontWeight: '700' as const,
  },
  bodyMedium: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500' as const,
  },
  display: {
    fontFamily: 'Inter_700Bold',
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.4,
    fontWeight: '700' as const,
  },
  balance: {
    fontFamily: 'Inter_700Bold',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  pageTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -1.1,
    fontWeight: '700' as const,
  },
  sectionHeading: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    fontWeight: '700' as const,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600' as const,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400' as const,
  },
  bodySecondary: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400' as const,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.4,
    fontWeight: '600' as const,
  },
  caption: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  micro: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    fontWeight: '600' as const,
  },
} as const;

export type DesignTypography = typeof typography;