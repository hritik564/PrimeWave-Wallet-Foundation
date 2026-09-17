import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@/src/theme';

const iconSource = require('../../assets/images/icon.png');

export default function FoundationScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={theme.gradients.background}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Image source={iconSource} style={styles.brandIcon} />
            </View>
            <View>
              <Text style={styles.brandName}>PRIMEWAVE</Text>
              <Text style={styles.brandProduct}>WALLET</Text>
            </View>
          </View>
          <View style={styles.phasePill}>
            <View style={styles.phaseDot} />
            <Text style={styles.phaseText}>PHASE 0A</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.kicker}>NON-CUSTODIAL • MULTI-CHAIN</Text>
          <Text style={styles.title}>Your gateway to the{'\n'}PrimeWave ecosystem.</Text>
          <Text style={styles.intro}>
            A secure foundation for the networks, assets, and experiences that
            will connect PrimeWave to the open web.
          </Text>
        </View>

        <LinearGradient
          colors={theme.gradients.panel}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.foundationCard}
        >
          <View style={styles.cardHeader}>
            <View style={styles.statusIcon}>
              <View style={styles.statusIconInner} />
            </View>
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardEyebrow}>FOUNDATION STATUS</Text>
              <Text style={styles.cardTitle}>Wallet core is being prepared</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Text style={styles.cardBody}>
            The visual system and architecture are in place. Wallet
            functionality will be added in later phases.
          </Text>
          <View style={styles.invariantRow}>
            <View style={styles.invariantIcon}>
              <Text style={styles.invariantGlyph}>✓</Text>
            </View>
            <Text style={styles.invariantText}>
              Your keys will stay on your device.
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.footer}>
          <Text style={styles.footerText}>PRIMEWAVE WALLET</Text>
          <Text style={styles.footerMeta}>DESIGNED FOR SOVEREIGN ACCESS</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'space-between',
  },
  orbTop: {
    position: 'absolute',
    top: -120,
    right: -100,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(80, 217, 255, 0.08)',
  },
  orbBottom: {
    position: 'absolute',
    bottom: -160,
    left: -140,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(124, 140, 255, 0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(124, 140, 255, 0.55)',
  },
  brandIcon: {
    width: '100%',
    height: '100%',
  },
  brandName: {
    color: theme.colors.foreground,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 2,
  },
  brandProduct: {
    color: theme.colors.accent,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    marginTop: 2,
  },
  phasePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(80, 217, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(80, 217, 255, 0.18)',
  },
  phaseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.states.success,
  },
  phaseText: {
    color: theme.colors.accent,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
  },
  hero: {
    marginTop: theme.spacing.xxl,
  },
  kicker: {
    color: theme.colors.accent,
    fontFamily: theme.typography.eyebrow.fontFamily,
    fontSize: theme.typography.eyebrow.fontSize,
    letterSpacing: theme.typography.eyebrow.letterSpacing,
    lineHeight: theme.typography.eyebrow.lineHeight,
    marginBottom: theme.spacing.md,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.typography.title.fontFamily,
    fontSize: theme.typography.title.fontSize,
    letterSpacing: theme.typography.title.letterSpacing,
    lineHeight: theme.typography.title.lineHeight,
  },
  intro: {
    maxWidth: 360,
    color: theme.colors.mutedForeground,
    fontFamily: theme.typography.body.fontFamily,
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    marginTop: theme.spacing.lg,
  },
  foundationCard: {
    marginTop: theme.spacing.xxl,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(124, 140, 255, 0.25)',
    ...theme.shadows.panel,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  statusIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(80, 217, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(80, 217, 255, 0.28)',
  },
  statusIconInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.accent,
    ...theme.shadows.glow,
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardEyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.typography.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 1.4,
    lineHeight: 15,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.typography.bodyMedium.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 3,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(152, 167, 202, 0.16)',
    marginVertical: theme.spacing.md,
  },
  cardBody: {
    color: theme.colors.mutedForeground,
    fontFamily: theme.typography.bodyMedium.fontFamily,
    fontSize: theme.typography.bodyMedium.fontSize,
    lineHeight: theme.typography.bodyMedium.lineHeight,
  },
  invariantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  invariantIcon: {
    width: 21,
    height: 21,
    borderRadius: 10.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(101, 230, 166, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(101, 230, 166, 0.3)',
  },
  invariantGlyph: {
    color: theme.states.success,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  invariantText: {
    color: theme.colors.secondaryForeground,
    fontFamily: theme.typography.label.fontFamily,
    fontSize: theme.typography.label.fontSize,
    lineHeight: theme.typography.label.lineHeight,
  },
  footer: {
    flexDirection: Platform.OS === 'web' ? 'column' : 'row',
    justifyContent: 'space-between',
    alignItems: Platform.OS === 'web' ? 'flex-start' : 'center',
    gap: 6,
    marginTop: theme.spacing.xxl,
  },
  footerText: {
    color: theme.colors.foreground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  footerMeta: {
    color: theme.colors.mutedForeground,
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    letterSpacing: 1.1,
  },
});