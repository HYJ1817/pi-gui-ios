import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MenuView } from '@react-native-menu/menu';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme';

export default function InfrastructureProbe() {
  const theme = useTheme(), insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
  const { width } = useWindowDimensions();
  const [reducedTransparency, setReducedTransparency] = useState(true);
  const [label, setLabel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [menuResult, setMenuResult] = useState('Menu not opened');
  const [animationResult, setAnimationResult] = useState('Animation not run');
  const [gestureResult, setGestureResult] = useState('Gesture not tested');
  const motion = useSharedValue(0), reduceMotion = useReducedMotion();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const motionStyle = useAnimatedStyle(() => ({ transform: [{ translateX: motion.value * 120 }] }));
  const tap = useMemo(() => Gesture.Tap().runOnJS(true).onEnd((_event, success) => { if (success) setGestureResult('Native gesture confirmed'); }), []);
  useEffect(() => () => cancelAnimation(motion), [motion]);
  const runAnimation = () => {
    setAnimationResult('Animation running');
    motion.value = withTiming(motion.value > 0 ? 0 : 1, { duration: reduceMotion ? 0 : 360 }, finished => {
      if (finished) runOnJS(setAnimationResult)('Animation completed');
    });
  };
  // isLiquidGlassAvailable() already includes Reduce Transparency, so the
  // local flag only tracks the preference for display copy — no fallback flash.
  const glass = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  const nativeAvailable = glass;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setReducedTransparency(value); }).catch(() => { if (active) setReducedTransparency(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReducedTransparency);
    return () => { active = false; subscription.remove(); };
  }, []);
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => <MenuView title="Native validation menu" themeVariant={theme.dark ? 'dark' : 'light'} shouldOpenOnLongPress={false} actions={[{ id: 'diagnostic', title: 'Show diagnostic' }, { id: 'cancel', title: 'Cancel' }]} onPressAction={({ nativeEvent }) => { if (nativeEvent.event === 'diagnostic') setMenuResult('Native menu confirmed'); }}><Pressable accessibilityRole="button" accessibilityLabel="Open native menu" style={styles.menuButton}><Text style={{ color: theme.accent, fontSize: 17 }}>Menu</Text></Pressable></MenuView> });
  }, [navigation, theme.dark, theme.accent]);
  const glassContents = <><Text style={[styles.eyebrow, { color: theme.accent }]}>NATIVE MATERIAL</Text><Text testID="glass-status" style={[styles.cardTitle, { color: theme.text }]}>{glass ? 'Native Liquid Glass' : 'Opaque accessibility fallback'}</Text><Text style={[styles.body, { color: theme.secondary }]}>{nativeAvailable ? 'iOS glass API available' : 'iOS glass API unavailable'}</Text><Text style={[styles.body, { color: theme.secondary }]}>A real system material over a patterned canvas.</Text></>;

  return <KeyboardAwareScrollView testID="probe-scroll" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: theme.background }} contentContainerStyle={[styles.page, { paddingBottom: Math.max(32, insets.bottom + 20), paddingLeft: Math.max(20, insets.left + 12), paddingRight: Math.max(20, insets.right + 12) }]}>
    <View className="w-full self-center gap-6" style={{ maxWidth: width > 700 ? 760 : 560 }}>
      <Text style={[styles.eyebrow, { color: theme.accent }]}>M−1 · INFRASTRUCTURE LAB</Text>
      <Text style={[styles.hero, { color: theme.text }]}>{'Your agents.\nCloser at hand.'}</Text>
      <Text style={[styles.intro, { color: theme.secondary }]}>Offline native technology preview. No computer is connected and remote access is not enabled.</Text>
      <View style={[styles.canvas, { backgroundColor: theme.decorative }]}><View accessible={false} style={[styles.orbit, { borderColor: theme.accent }]} /><View accessible={false} style={[styles.stripe, { backgroundColor: theme.accent }]} />{glass ? <GlassView testID="native-glass-surface" glassEffectStyle="regular" style={styles.glass} colorScheme={theme.dark ? 'dark' : 'light'}>{glassContents}</GlassView> : <View testID="opaque-surface" style={[styles.glass, { backgroundColor: theme.surface }]}>{glassContents}</View>}</View>
      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Interaction checks</Text>
        <Text testID="keyboard-state" style={[styles.body, { color: theme.secondary }]}>Keyboard state: {keyboardVisible ? 'visible' : 'hidden'}</Text>
        <Text nativeID="label-title" style={[styles.body, { color: theme.secondary }]}>Synthetic device label</Text>
        <TextInput testID="device-label" accessibilityLabel="Synthetic device label" accessibilityLabelledBy="label-title" value={label} onChangeText={setLabel} placeholder="Enter a test label" placeholderTextColor={theme.secondary} autoCorrect={false} autoCapitalize="none" maxLength={64} returnKeyType="done" style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
        <Text testID="label-result" style={[styles.body, { color: theme.text }]}>Preview label: {label || 'not set'}</Text>
        <View style={styles.switchRow}><Text style={[styles.switchLabel, { color: theme.text }]}>Local demo preference</Text><Switch testID="demo-toggle" accessibilityLabel="Local demo preference" value={enabled} onValueChange={setEnabled} /></View>
        <Text testID="toggle-result" style={[styles.body, { color: theme.secondary }]}>Demo preference: {enabled ? 'on' : 'off'}</Text>
        <Text testID="menu-result" style={[styles.body, { color: theme.secondary }]}>{menuResult}</Text>
      </View>
      <View className="gap-4" style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Native motion and gestures</Text>
        <Text style={[styles.body, { color: theme.secondary }]}>Reanimated follows Reduce Motion. The gesture check uses a native Gesture Handler recognizer.</Text>
        <Animated.View testID="motion-indicator" accessibilityLabel="Native animation indicator" style={[styles.motionIndicator, { backgroundColor: theme.accent }, motionStyle]} />
        <Pressable testID="run-animation" accessibilityRole="button" onPress={runAnimation} style={[styles.button, { backgroundColor: theme.accent }]}><Text style={[styles.buttonText, { color: theme.onAccent }]}>Run native animation</Text></Pressable>
        <Text testID="animation-result" style={[styles.body, { color: theme.secondary }]}>{animationResult}</Text>
        <GestureDetector gesture={tap}><View collapsable={false} testID="native-gesture" accessible accessibilityRole="button" accessibilityLabel="Verify native gesture" onAccessibilityTap={() => setGestureResult('Accessibility action confirmed')} style={[styles.button, { backgroundColor: theme.accent }]}><Text style={[styles.buttonText, { color: theme.onAccent }]}>Verify native gesture</Text></View></GestureDetector>
        <Text testID="gesture-result" style={[styles.body, { color: theme.secondary }]}>{gestureResult}</Text>
      </View>
      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.line }]}><Text style={[styles.cardTitle, { color: theme.text }]}>Built for iPhone and iPad</Text><Text style={[styles.body, { color: theme.secondary }]}>System appearance, safe areas and dynamic text follow your device. Reduce Transparency uses a solid surface.</Text><Pressable testID="open-diagnostics" accessibilityRole="button" accessibilityLabel="Open infrastructure details" onPress={() => navigation.navigate('Diagnostics')} style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed ? 0.75 : 1 }]}><Text style={[styles.buttonText, { color: theme.onAccent }]}>Infrastructure details</Text></Pressable></View>
      <Text testID="scroll-end" style={[styles.footnote, { color: theme.secondary }]}>End of native validation screen</Text>
    </View>
  </KeyboardAwareScrollView>;
}

const styles = StyleSheet.create({
  page: { paddingTop: 20 }, menuButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }, motionIndicator: { height: 32, width: 32, borderRadius: 16 }, eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 }, hero: { fontSize: 38, fontWeight: '700', letterSpacing: -1.3 }, intro: { fontSize: 17, lineHeight: 25 }, canvas: { minHeight: 236, borderRadius: 30, overflow: 'hidden', justifyContent: 'center', padding: 22 }, orbit: { position: 'absolute', right: -28, top: -38, width: 220, height: 220, borderWidth: 26, borderRadius: 110, opacity: 0.22 }, stripe: { position: 'absolute', width: 310, height: 54, bottom: 35, left: -55, transform: [{ rotate: '-28deg' }], opacity: 0.22 }, glass: { borderRadius: 24, padding: 22, gap: 10 }, section: { borderRadius: 24, padding: 22, gap: 16, borderWidth: StyleSheet.hairlineWidth }, cardTitle: { fontSize: 22, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 24 }, input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 }, switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, switchLabel: { fontSize: 17, flex: 1 }, button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', padding: 14 }, buttonText: { fontSize: 17, fontWeight: '600', textAlign: 'center' }, footnote: { fontSize: 13, textAlign: 'center', paddingBottom: 16 },
});
