import { createStaticNavigation, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator, createNativeStackScreen } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import SessionsScreen from '../screens/SessionsScreen';
import ConversationScreen from '../screens/ConversationScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import ApprovalDetailScreen from '../screens/ApprovalDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import InfrastructureProbe from '../screens/InfrastructureProbe';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';

const RootStack = createNativeStackNavigator({
  initialRouteName: 'Home',
  screenOptions: { headerBackButtonDisplayMode: 'minimal' },
  screens: {
    Home: createNativeStackScreen({ screen: HomeScreen, options: { title: 'Pi GUI Mobile', headerLargeTitle: true } }),
    Sessions: createNativeStackScreen({ screen: SessionsScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Sessions' }) }),
    Conversation: createNativeStackScreen({ screen: ConversationScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Conversation' }) }),
    Approvals: createNativeStackScreen({ screen: ApprovalsScreen, options: { title: 'Approvals' } }),
    ApprovalDetail: createNativeStackScreen({ screen: ApprovalDetailScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Approval' }) }),
    Settings: createNativeStackScreen({ screen: SettingsScreen, options: { title: 'Settings' } }),
    InfrastructureProbe: createNativeStackScreen({ screen: InfrastructureProbe, options: { title: 'Infrastructure' } }),
    Diagnostics: createNativeStackScreen({ screen: DiagnosticsScreen, options: { title: 'Diagnostics' } }),
  },
});
const Navigation = createStaticNavigation(RootStack);

export function RootNavigation() {
  const theme = useTheme();
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return <Navigation theme={{ ...base, colors: { ...base.colors, background: theme.background, card: theme.surface, text: theme.text, primary: theme.accent, border: theme.line } }} />;
}
