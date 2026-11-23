import { walletHomeColors as palette } from '../tokens/wallet-home';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { icons, type WaveXIconName } from '../icons';
import { colors, motion, radius, shadows, spacing, typography } from '../tokens';

export type WaveXButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive';

export interface WaveXButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: WaveXButtonVariant;
  readonly icon?: WaveXIconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function WaveXButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  testID,
}: WaveXButtonProps) {
  const unavailable = disabled || loading;
  const iconColor =
    variant === 'primary' || variant === 'destructive'
      ? colors.primaryForeground
      : colors.accent;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        unavailable && styles.disabled,
        pressed && !unavailable && styles.pressed,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={iconColor} />
      ) : null}
      <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{label}</Text>
    </Pressable>
  );
}

export function WaveXIconButton({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  readonly icon: WaveXIconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}
    >
      <Ionicons name={icon} size={19} color={colors.foreground} />
    </Pressable>
  );
}

export function WaveXCard({
  children,
  elevated = false,
  testID,
}: {
  readonly children: React.ReactNode;
  readonly elevated?: boolean;
  readonly testID?: string;
}) {
  return (
    <View style={[styles.card, elevated && styles.cardElevated]} testID={testID}>
      {children}
    </View>
  );
}

export function WaveXInput({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly error?: string;
  readonly secureTextEntry?: boolean;
  readonly testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        style={[styles.input, error && styles.inputError]}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function WaveXSearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  testID,
}: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly testID?: string;
}) {
  return (
    <View style={styles.searchInput}>
      <Ionicons name={icons.search} size={17} color={colors.textMuted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchText}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}

export function WaveXSegmentedControl({
  options,
  value,
  onChange,
}: {
  readonly options: readonly { value: string; label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function WaveXChip({
  label,
  selected = false,
  onPress,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly onPress?: () => void;
}) {
  const content = <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>;
  if (!onPress) return <View style={[styles.chip, selected && styles.chipSelected]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function WaveXBadge({
  label,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
}) {
  return (
    <View style={[styles.badge, tone !== 'neutral' && styles[`badge_${tone}`]]}>
      <Text style={[styles.badgeText, tone !== 'neutral' && styles[`badgeText_${tone}`]]}>{label}</Text>
    </View>
  );
}

export function WaveXNetworkBadge({
  name,
  symbol,
}: {
  readonly name: string;
  readonly symbol: string;
}) {
  return (
    <View accessibilityLabel={`${name}, ${symbol}`} style={styles.networkBadge}>
      <View style={styles.networkDot} />
      <Text numberOfLines={1} style={styles.networkBadgeText}>
        {name}
      </Text>
      <Text style={styles.networkBadgeSymbol}>{symbol}</Text>
    </View>
  );
}

export function WaveXAccountBadge({
  label,
  address,
  onPress,
}: {
  readonly label: string;
  readonly address: string;
  readonly onPress?: () => void;
}) {
  const content = (
    <>
      <View style={styles.accountBadgeIcon}>
        <Ionicons name={icons.account} size={15} color={colors.accent} />
      </View>
      <View style={styles.accountBadgeCopy}>
        <Text style={styles.accountBadgeLabel}>{label}</Text>
        <Text style={styles.accountBadgeAddress}>{address}</Text>
      </View>
    </>
  );
  if (!onPress) return <View style={styles.accountBadge}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`${label}, ${address}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.accountBadge, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function WaveXAssetIcon({
  initials,
  imageUri,
  label,
}: {
  readonly initials: string;
  readonly imageUri?: string | null;
  readonly label?: string;
}) {
  return (
    <View accessibilityLabel={label} style={styles.assetIcon}>
      {imageUri ? (
        <Image accessibilityLabel={label} contentFit="contain" source={{ uri: imageUri }} style={styles.assetImage} />
      ) : (
        <Text style={styles.assetInitials}>{initials}</Text>
      )}
    </View>
  );
}

export function WaveXAssetRow({
  title,
  subtitle,
  amount,
  status,
  imageUri,
  initials,
  onPress,
  trailing,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly status?: string;
  readonly imageUri?: string | null;
  readonly initials: string;
  readonly onPress?: () => void;
  readonly trailing?: React.ReactNode;
}) {
  const content = (
    <>
      <WaveXAssetIcon initials={initials} imageUri={imageUri} label={`${title} icon`} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.rowAmount}>
        <Text numberOfLines={1} style={styles.amount}>{amount}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      {trailing}
      {onPress ? <Ionicons name={icons.forward} size={16} color={colors.textMuted} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.assetRow}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`${title}, ${subtitle}, ${amount}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.assetRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function WaveXTransactionRow({
  title,
  subtitle,
  amount,
  status,
  icon = icons.activity,
  onPress,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly status?: string;
  readonly icon?: WaveXIconName;
  readonly onPress?: () => void;
}) {
  const content = (
    <>
      <View style={styles.transactionIcon}>
        <Ionicons name={icon} size={17} color={colors.accent} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.rowAmount}>
        <Text style={styles.amount}>{amount}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.assetRow}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.assetRow, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export function WaveXSectionHeader({
  eyebrow,
  title,
  actionLabel,
  onAction,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.rowCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function WaveXDivider() {
  return <View style={styles.divider} />;
}

export function WaveXBottomSheet({
  visible,
  title,
  onClose,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel={`Close ${title}`} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <WaveXIconButton icon={icons.close} label={`Close ${title}`} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function WaveXModal({
  visible,
  title,
  onClose,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel={`Close ${title}`} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <WaveXIconButton icon={icons.close} label={`Close ${title}`} onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function WaveXToast({
  message,
  tone = 'info',
}: {
  readonly message: string;
  readonly tone?: 'success' | 'warning' | 'error' | 'info';
}) {
  return (
    <View accessibilityRole="alert" style={[styles.toast, styles[`toast_${tone}`]]}>
      <Ionicons name={tone === 'success' ? icons.success : tone === 'error' ? icons.error : tone === 'warning' ? icons.warning : icons.info} size={17} color={colors.foreground} />
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

export function WaveXSkeleton({
  width = '100%',
  height = 16,
}: {
  readonly width?: number | `${number}%`;
  readonly height?: number;
}) {
  return <View accessibilityLabel="Loading" style={[styles.skeleton, { width, height }]} />;
}

export function WaveXLoadingState({ label = 'Loading' }: { readonly label?: string }) {
  return (
    <View accessibilityLabel={label} style={styles.state}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.stateBody}>{label}</Text>
    </View>
  );
}

export function WaveXEmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View style={styles.state}>
      <Ionicons name="layers-outline" size={26} color={colors.textMuted} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onAction ? <WaveXButton label={actionLabel} onPress={onAction} variant="outline" /> : null}
    </View>
  );
}

export function WaveXErrorState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View style={[styles.state, styles.stateError]}>
      <Ionicons name={icons.error} size={26} color={colors.error} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onAction ? <WaveXButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function WaveXStatusIndicator({
  label,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
}) {
  return (
    <View accessibilityLabel={label} style={styles.statusIndicator}>
      <View style={[styles.statusDot, tone !== 'neutral' && styles[`statusDot_${tone}`]]} />
      <Text style={styles.statusIndicatorText}>{label}</Text>
    </View>
  );
}

export function WaveXBottomNavigation({
  items,
  selectedKey,
  onSelect,
}: {
  readonly items: readonly { key: string; label: string; icon: WaveXIconName }[];
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.bottomNavigation}>
      {items.map((item) => {
        const selected = item.key === selectedKey;
        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            <Ionicons name={item.icon} size={19} color={selected ? palette.cyan : palette.secondaryText} />
            <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  button_primary: { backgroundColor: colors.accent },
  button_secondary: { backgroundColor: colors.secondary },
  button_outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  button_destructive: { backgroundColor: colors.error },
  buttonText: { ...typography.label },
  buttonText_primary: { color: colors.accentForeground },
  buttonText_secondary: { color: colors.foreground },
  buttonText_outline: { color: colors.accent },
  buttonText_destructive: { color: colors.destructiveForeground },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: { opacity: motion.disabledOpacity },
  pressed: { opacity: motion.pressedOpacity },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardElevated: { backgroundColor: colors.surfaceElevated, ...shadows.panel },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputError: { borderColor: colors.error },
  errorText: { ...typography.caption, color: colors.error },
  searchInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.divider,
  },
  searchText: { flex: 1, color: palette.text, ...typography.body, paddingVertical: 0 },
  segmented: {
    padding: 3,
    flexDirection: 'row',
    gap: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
  },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentSelected: { backgroundColor: colors.accent },
  segmentText: { ...typography.caption, color: colors.textMuted },
  segmentTextSelected: { color: colors.accentForeground },
  chip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextSelected: { color: colors.accentForeground },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start', borderRadius: radius.pill, backgroundColor: colors.muted },
  badge_success: { backgroundColor: '#16392f' },
  badge_warning: { backgroundColor: '#3c3119' },
  badge_error: { backgroundColor: '#3b1c27' },
  badge_info: { backgroundColor: '#1a2d4c' },
  badgeText: { ...typography.micro, letterSpacing: 0.5, color: colors.textSecondary },
  badgeText_success: { color: colors.success },
  badgeText_warning: { color: colors.warning },
  badgeText_error: { color: colors.error },
  badgeText_info: { color: colors.info },
  networkBadge: { minHeight: 34, maxWidth: '100%', paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  networkDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
  networkBadgeText: { flexShrink: 1, ...typography.caption, color: colors.textPrimary },
  networkBadgeSymbol: { ...typography.micro, color: colors.textMuted },
  accountBadge: { minHeight: 48, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  accountBadgeIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.secondary },
  accountBadgeCopy: { flex: 1, gap: 1 },
  accountBadgeLabel: { ...typography.caption, color: colors.textPrimary },
  accountBadgeAddress: { ...typography.micro, letterSpacing: 0.2, color: colors.textMuted },
  assetIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider },
  assetImage: { width: 30, height: 30 },
  assetInitials: { ...typography.label, color: colors.textPrimary },
  assetRow: { minHeight: 56, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.divider },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...typography.cardTitle, color: palette.text },
  rowSubtitle: { ...typography.caption, color: palette.secondaryText },
  rowAmount: { maxWidth: '35%', alignItems: 'flex-end', gap: 2 },
  amount: { ...typography.label, color: palette.text },
  status: { ...typography.micro, letterSpacing: 0.4, color: palette.secondaryText },
  transactionIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.secondary },
  sectionHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eyebrow: { ...typography.micro, color: colors.accent },
  sectionTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  actionText: { ...typography.caption, color: colors.accent },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  sheet: { maxHeight: '86%', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, backgroundColor: palette.surface, ...shadows.panel },
  sheetHandle: { alignSelf: 'center', width: 44, height: 4, borderRadius: radius.pill, backgroundColor: palette.divider },
  sheetHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sheetTitle: { ...typography.cardTitle, color: colors.textPrimary },
  sheetContent: { paddingBottom: spacing.xl, gap: spacing.sm },
  dialog: { marginHorizontal: spacing.lg, padding: spacing.lg, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.panel },
  toast: { minHeight: 48, margin: spacing.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.info, ...shadows.panel },
  toast_success: { borderColor: colors.success },
  toast_warning: { borderColor: colors.warning },
  toast_error: { borderColor: colors.error },
  toast_info: { borderColor: colors.info },
  toastText: { flex: 1, ...typography.bodySecondary, color: colors.textPrimary },
  skeleton: { borderRadius: radius.pill, backgroundColor: colors.surfacePressed },
  state: { padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stateError: { borderColor: colors.error },
  stateTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'center' },
  stateBody: { ...typography.bodySecondary, color: colors.textMuted, textAlign: 'center' },
  statusIndicator: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.textMuted },
  statusDot_success: { backgroundColor: colors.success },
  statusDot_warning: { backgroundColor: colors.warning },
  statusDot_error: { backgroundColor: colors.error },
  statusDot_info: { backgroundColor: colors.info },
  statusIndicatorText: { ...typography.caption, color: colors.textSecondary },
  bottomNavigation: { minHeight: 64, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.divider, },
  navItem: { flex: 1, minWidth: 0, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.sm },
  navLabel: { ...typography.micro, letterSpacing: 0.2, color: palette.secondaryText },
  navLabelSelected: { color: palette.cyan },
});