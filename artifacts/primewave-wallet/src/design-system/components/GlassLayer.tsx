import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';
import { glass } from '../tokens/wallet-home';

// Keep text, QR modules and touch targets above this decorative layer.
export function GlassLayer({ sheet = false }: { sheet?: boolean }) {
  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      {sheet && Platform.OS !== 'android' && (
        <BlurView intensity={glass.blur} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={glass.reflection} start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}
