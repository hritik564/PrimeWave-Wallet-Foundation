import assert from 'node:assert/strict';
import test from 'node:test';
import { icons } from '@/src/design-system/icons';
import { waveXComponentNames } from '@/src/design-system/manifest';
import { motion } from '@/src/design-system/motion';
import { colors, radius, spacing } from '@/src/design-system/tokens';
import { typography } from '@/src/design-system/typography';

test('exposes the complete UI-0 primitive manifest from one design-system entry point', () => {
  assert.deepEqual(
    waveXComponentNames,
    [
      'WaveXButton',
      'WaveXIconButton',
      'WaveXCard',
      'WaveXInput',
      'WaveXSearchInput',
      'WaveXSegmentedControl',
      'WaveXChip',
      'WaveXBadge',
      'WaveXNetworkBadge',
      'WaveXAccountBadge',
      'WaveXAssetIcon',
      'WaveXAssetRow',
      'WaveXTransactionRow',
      'WaveXSectionHeader',
      'WaveXBottomSheet',
      'WaveXModal',
      'WaveXToast',
      'WaveXDivider',
      'WaveXSkeleton',
      'WaveXEmptyState',
      'WaveXErrorState',
      'WaveXLoadingState',
      'WaveXStatusIndicator',
      'WaveXBottomNavigation',
    ],
  );
});

test('keeps semantic colors, spacing, radius, and motion values centralized', () => {
  assert.equal(colors.background, '#090B0E');
  assert.equal(colors.accent, '#0DECFE');
  assert.equal(colors.success, '#65e6a6');
  assert.equal(spacing.lg, 24);
  assert.equal(radius.sheet, 28);
  assert.equal(motion.duration.standard, 220);
  assert.equal(motion.pressedOpacity, 0.76);
});

test('defines readable functional typography and a stable icon vocabulary', () => {
  assert.equal(typography.balance.fontFamily, 'Inter_700Bold');
  assert.deepEqual(typography.balance.fontVariant, ['tabular-nums']);
  assert.equal(typography.body.lineHeight, 21);
  assert.equal(icons.home, 'home-outline');
  assert.equal(icons.settings, 'settings-outline');
  assert.equal(icons.security, 'shield-checkmark-outline');
});