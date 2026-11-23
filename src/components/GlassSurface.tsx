import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '../theme';

// True Liquid Glass when the iOS material API is present AND the user has not
// asked for reduced transparency; otherwise an explicit solid-surface fallback.
// Never a blur — per the M-1 constraint, no fake glass.

interface Props {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
  tint?: 'regular' | 'clear';
}

export function useGlassAvailable(): { native: boolean; reducedTransparency: boolean; enabled: boolean } {
  // isLiquidGlassAvailable() already folds the Reduce Transparency preference
  // into its answer; tracking it ourselves would mount the opaque fallback for
  // one frame on capable devices (children remount, visible flash).
  const native = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  return { native, reducedTransparency: !native, enabled: native };
}

export function GlassSurface({ children, style, contentStyle, testID, tint = 'regular' }: Props) {
  const theme = useTheme();
  const { enabled } = useGlassAvailable();
  if (enabled) {
    return (
      <GlassView testID={testID} glassEffectStyle={tint} style={[contentStyle, style]} colorScheme={theme.dark ? 'dark' : 'light'}>
        {children}
      </GlassView>
    );
  }
  return (
    <View testID={testID ? `${testID}-fallback` : undefined} style={[contentStyle, style, { backgroundColor: theme.surfaceElevated }]}>
      {children}
    </View>
  );
}
