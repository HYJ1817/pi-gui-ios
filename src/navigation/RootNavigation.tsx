import { createStaticNavigation, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator, createNativeStackScreen } from '@react-navigation/native-stack';
import InfrastructureProbe from '../screens/InfrastructureProbe';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';
import { useTheme } from '../theme';

const RootStack = createNativeStackNavigator({
  initialRouteName: 'Home',
  screenOptions: { headerBackButtonDisplayMode: 'minimal' },
  screens: {
    Home: createNativeStackScreen({ screen: InfrastructureProbe, options: { title: 'Pi GUI Mobile', headerLargeTitle: true } }),
    Diagnostics: createNativeStackScreen({ screen: DiagnosticsScreen, options: { title: 'Infrastructure' } }),
  },
});
const Navigation = createStaticNavigation(RootStack);

export function RootNavigation() {
  const theme = useTheme();
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return <Navigation theme={{ ...base, colors: { ...base.colors, background: theme.background, card: theme.surface, text: theme.text, primary: theme.accent, border: theme.line } }} />;
}
