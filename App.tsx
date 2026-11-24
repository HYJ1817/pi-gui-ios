import './global.css';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { glassPreferencesResolved, resolveGlassPreferences } from './src/components/GlassSurface';
import { RootNavigation } from './src/navigation/RootNavigation';
import { useTheme } from './src/theme';

export default function App() {
  const theme = useTheme();
  // Resolve the async Reduce Transparency preference during launch — the
  // native splash covers this window — so the first mounted glass surface is
  // already correct (glass for normal users, the labeled solid fallback under
  // Reduce Transparency). Rendering null here never flashes either direction.
  const [glassReady, setGlassReady] = useState(glassPreferencesResolved());
  useEffect(() => {
    if (glassReady) return;
    resolveGlassPreferences().then(() => setGlassReady(true));
  }, [glassReady]);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><KeyboardProvider><StatusBar style={theme.dark ? 'light' : 'dark'} />{glassReady ? <RootNavigation /> : null}</KeyboardProvider></SafeAreaProvider></GestureHandlerRootView>;
}
