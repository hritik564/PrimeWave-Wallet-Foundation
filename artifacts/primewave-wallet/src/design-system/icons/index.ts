import type { Ionicons } from '@expo/vector-icons';

export type WaveXIconName = keyof typeof Ionicons.glyphMap;

export const icons = {
  home: 'home-outline',
  assets: 'layers-outline',
  swap: 'swap-horizontal-outline',
  activity: 'time-outline',
  settings: 'settings-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  account: 'person-outline',
  network: 'globe-outline',
  security: 'shield-checkmark-outline',
  success: 'checkmark-circle',
  warning: 'warning-outline',
  error: 'alert-circle-outline',
  info: 'information-circle-outline',
  search: 'search-outline',
  close: 'close',
  back: 'arrow-back-outline',
  forward: 'chevron-forward',
  chevronDown: 'chevron-down',
  copy: 'copy-outline',
  lock: 'lock-closed-outline',
  refresh: 'refresh-outline',
  scan: 'scan-outline',
  dapps: 'link-outline',
} as const satisfies Record<string, WaveXIconName>;

export type WaveXIconKey = keyof typeof icons;