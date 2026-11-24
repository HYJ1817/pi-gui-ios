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

// isLiquidGlassAvailable() is a pure SDK/plist capability check and does NOT
// fold Reduce Transparency (expo-glass-effect docs + GlassEffectModule.swift),
// so the RT preference must gate 'enabled' ourselves. The RT value is async
// only (AccessibilityInfo), which is why it is resolved once during app
// bootstrap — before screens mount — via resolveGlassPreferences(). That makes
// the first visible frame already correct in both directions: no glass flash
// for RT users, no fallback flash for everyone else. The listener keeps the
// cache live when the user toggles the setting mid-session.
let cachedReduceTransparency: boolean | null = null;
let listenerInstalled = false;

export function glassPreferencesResolved(): boolean {
  return cachedReduceTransparency !== null;
}

export async function resolveGlassPreferences(): Promise<void> {
  try {
    cachedReduceTransparency = await AccessibilityInfo.isReduceTransparencyEnabled();
  } catch {
    cachedReduceTransparency = true; // Unknown preference: fail toward the opaque fallback.
  }
  if (!listenerInstalled) {
    listenerInstalled = true;
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => { cachedReduceTransparency = value; });
  }
}

export function useGlassAvailable(): { native: boolean; reducedTransparency: boolean | null; enabled: boolean } {
  const [reducedTransparency, setReducedTransparency] = useState<boolean | null>(cachedReduceTransparency);
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReducedTransparency);
    if (cachedReduceTransparency === null) {
      resolveGlassPreferences().then(() => setReducedTransparency(cachedReduceTransparency));
    } else if (reducedTransparency !== cachedReduceTransparency) {
      setReducedTransparency(cachedReduceTransparency);
    }
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const native = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  // An unresolved preference renders the solid fallback (spec-safe); glass
  // requires the material API AND a resolved non-reduced preference.
  return { native, reducedTransparency, enabled: native && reducedTransparency === false };
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
