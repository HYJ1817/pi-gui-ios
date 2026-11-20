import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Button, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';

export default function InfrastructureProbe() {
  const theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [reducedTransparency, setReducedTransparency] = useState(true);
  const [label, setLabel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [menuResult, setMenuResult] = useState('Menu not opened');
  const nativeAvailable = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  const glass = nativeAvailable && !reducedTransparency;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setReducedTransparency(value); }).catch(() => { if (active) setReducedTransparency(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReducedTransparency);
    return () => { active = false; subscription.remove(); };
  }, []);
  const showMenu = () => {
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: 'Native validation menu', options: ['Show diagnostic', 'Cancel'], cancelButtonIndex: 1, userInterfaceStyle: theme.dark ? 'dark' : 'light' }, index => { if (index === 0) setMenuResult('Native menu confirmed'); });
    else Alert.alert('Native menu', 'This probe targets iOS.');
  };
  const glassContents = <><Text style={[styles.eyebrow, { color: theme.accent }]}>NATIVE MATERIAL</Text><Text testID="glass-status" style={[styles.cardTitle, { color: theme.text }]}>{glass ? 'Native Liquid Glass' : 'Opaque accessibility fallback'}</Text><Text style={[styles.body, { color: theme.secondary }]}>{nativeAvailable ? 'iOS glass API available' : 'iOS glass API unavailable'}</Text><Text style={[styles.body, { color: theme.secondary }]}>A real system material over a patterned canvas.</Text></>;

  return <><Stack.Screen options={{ headerRight: () => <Button title="Menu" accessibilityLabel="Open native menu" onPress={showMenu} /> }} /><ScrollView testID="probe-scroll" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: theme.background }} contentContainerStyle={[styles.page, { paddingBottom: Math.max(32, insets.bottom + 20), paddingLeft: Math.max(20, insets.left + 12), paddingRight: Math.max(20, insets.right + 12) }]}>
    <View style={[styles.content, { maxWidth: width > 700 ? 760 : 560 }]}>
      <Text style={[styles.eyebrow, { color: theme.accent }]}>M−1 · INFRASTRUCTURE LAB</Text>
      <Text style={[styles.hero, { color: theme.text }]}>Your agents.
Closer at hand.</Text>
      <Text style={[styles.intro, { color: theme.secondary }]}>Offline native technology preview. No computer is connected and remote access is not enabled.</Text>
      <View style={[styles.canvas, { backgroundColor: theme.decorative }]}><View accessible={false} style={[styles.orbit, { borderColor: theme.accent }]} /><View accessible={false} style={[styles.stripe, { backgroundColor: theme.accent }]} />{glass ? <GlassView testID="native-glass-surface" glassEffectStyle="regular" style={styles.glass} colorScheme={theme.dark ? 'dark' : 'light'}>{glassContents}</GlassView> : <View testID="opaque-surface" style={[styles.glass, { backgroundColor: theme.surface }]}>{glassContents}</View>}</View>
      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Interaction checks</Text>
        <Text nativeID="label-title" style={[styles.body, { color: theme.secondary }]}>Synthetic device label</Text>
        <TextInput testID="device-label" accessibilityLabel="Synthetic device label" accessibilityLabelledBy="label-title" value={label} onChangeText={setLabel} placeholder="Enter a test label" placeholderTextColor={theme.secondary} autoCorrect={false} autoCapitalize="none" maxLength={64} returnKeyType="done" style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
        <Text testID="label-result" style={[styles.body, { color: theme.text }]}>Preview label: {label || 'not set'}</Text>
        <View style={styles.switchRow}><Text style={[styles.switchLabel, { color: theme.text }]}>Local demo preference</Text><Switch testID="demo-toggle" accessibilityLabel="Local demo preference" value={enabled} onValueChange={setEnabled} /></View>
        <Text testID="toggle-result" style={[styles.body, { color: theme.secondary }]}>Demo preference: {enabled ? 'on' : 'off'}</Text>
        <Text testID="menu-result" style={[styles.body, { color: theme.secondary }]}>{menuResult}</Text>
      </View>
      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.line }]}><Text style={[styles.cardTitle, { color: theme.text }]}>Built for iPhone and iPad</Text><Text style={[styles.body, { color: theme.secondary }]}>System appearance, safe areas and dynamic text follow your device. Reduce Transparency uses a solid surface.</Text><Pressable testID="open-diagnostics" accessibilityRole="button" accessibilityLabel="Open infrastructure details" onPress={() => router.push('/diagnostics')} style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed ? 0.75 : 1 }]}><Text style={[styles.buttonText, { color: theme.dark ? '#111418' : '#FFFFFF' }]}>Infrastructure details</Text></Pressable></View>
      <Text testID="scroll-end" style={[styles.footnote, { color: theme.secondary }]}>End of native validation screen</Text>
    </View>
  </ScrollView></>;
}

const styles = StyleSheet.create({
  page: { paddingTop: 20 }, content: { width: '100%', alignSelf: 'center', gap: 24 }, eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 }, hero: { fontSize: 38, fontWeight: '700', letterSpacing: -1.3 }, intro: { fontSize: 17, lineHeight: 25 }, canvas: { minHeight: 236, borderRadius: 30, overflow: 'hidden', justifyContent: 'center', padding: 22 }, orbit: { position: 'absolute', right: -28, top: -38, width: 220, height: 220, borderWidth: 26, borderRadius: 110, opacity: 0.22 }, stripe: { position: 'absolute', width: 310, height: 54, bottom: 35, left: -55, transform: [{ rotate: '-28deg' }], opacity: 0.22 }, glass: { borderRadius: 24, padding: 22, gap: 10 }, section: { borderRadius: 24, padding: 22, gap: 16, borderWidth: StyleSheet.hairlineWidth }, cardTitle: { fontSize: 22, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 24 }, input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 }, switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, switchLabel: { fontSize: 17, flex: 1 }, button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', padding: 14 }, buttonText: { fontSize: 17, fontWeight: '600', textAlign: 'center' }, footnote: { fontSize: 13, textAlign: 'center', paddingBottom: 16 },
});
