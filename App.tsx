import './global.css';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigation } from './src/navigation/RootNavigation';
import { useTheme } from './src/theme';

export default function App() {
  const theme = useTheme();
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><KeyboardProvider><StatusBar style={theme.dark ? 'light' : 'dark'} /><RootNavigation /></KeyboardProvider></SafeAreaProvider></GestureHandlerRootView>;
}
