import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  const theme = useTheme();
  return <><StatusBar style={theme.dark ? 'light' : 'dark'} /><Stack screenOptions={{ headerTintColor: theme.accent, contentStyle: { backgroundColor: theme.background }, headerStyle: { backgroundColor: theme.surface } }}><Stack.Screen name="index" options={{ title: 'Pi GUI Mobile', headerLargeTitle: true, headerBackButtonDisplayMode: 'minimal' }} /><Stack.Screen name="diagnostics" options={{ title: 'Infrastructure' }} /></Stack></>;
}
