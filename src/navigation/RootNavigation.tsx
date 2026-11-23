import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator, createNativeStackScreen } from '@react-navigation/native-stack';
import { Platform, useWindowDimensions } from 'react-native';
import { Split } from 'react-native-screens/experimental';
import { useTheme, type AppTheme } from '../theme';
import { shellMode, splitColumnMetrics } from '../design/layout';
import SidebarScreen from './SidebarScreen';
import HomeScreen from '../screens/HomeScreen';
import SessionsScreen from '../screens/SessionsScreen';
import ConversationScreen from '../screens/ConversationScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import ApprovalDetailScreen from '../screens/ApprovalDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import InfrastructureProbe from '../screens/InfrastructureProbe';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';

const SCREENS = {
  Home: createNativeStackScreen({ screen: HomeScreen, options: { title: 'Pi GUI Mobile', headerLargeTitle: true } }),
  Sessions: createNativeStackScreen({ screen: SessionsScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Sessions' }) }),
  Conversation: createNativeStackScreen({ screen: ConversationScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Conversation' }) }),
  Approvals: createNativeStackScreen({ screen: ApprovalsScreen, options: { title: 'Approvals' } }),
  ApprovalDetail: createNativeStackScreen({ screen: ApprovalDetailScreen, options: ({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Approval' }) }),
  Settings: createNativeStackScreen({ screen: SettingsScreen, options: { title: 'Settings' } }),
  InfrastructureProbe: createNativeStackScreen({ screen: InfrastructureProbe, options: { title: 'Infrastructure' } }),
  Diagnostics: createNativeStackScreen({ screen: DiagnosticsScreen, options: { title: 'Diagnostics' } }),
};

const RootStack = createNativeStackNavigator({
  initialRouteName: 'Home',
  screenOptions: { headerBackButtonDisplayMode: 'minimal' },
  screens: SCREENS,
});

// Declarative <RootStack.Screen> children for the split path — the static
// `screens:` config only auto-registers inside createStaticNavigation;
// a bare <RootStack.Navigator/> renders whatever Screen children it's given.
function DetailStack() {
  return (
    <RootStack.Navigator initialRouteName="Home" screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <RootStack.Screen name="Home" component={HomeScreen} options={{ title: 'Pi GUI Mobile', headerLargeTitle: true }} />
      <RootStack.Screen name="Sessions" component={SessionsScreen} options={({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Sessions' })} />
      <RootStack.Screen name="Conversation" component={ConversationScreen} options={({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Conversation' })} />
      <RootStack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: 'Approvals' }} />
      <RootStack.Screen name="ApprovalDetail" component={ApprovalDetailScreen} options={({ route }: { route: { params?: { title?: string } } }) => ({ title: route.params?.title ?? 'Approval' })} />
      <RootStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <RootStack.Screen name="InfrastructureProbe" component={InfrastructureProbe} options={{ title: 'Infrastructure' }} />
      <RootStack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: 'Diagnostics' }} />
    </RootStack.Navigator>
  );
}
import { createStaticNavigation } from '@react-navigation/native';
const Navigation = createStaticNavigation(RootStack);

function navTheme(theme: AppTheme): Theme {
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: theme.background, card: theme.surface, text: theme.text, primary: theme.accent, border: theme.line } };
}

/**
 * iPad / wide screen: real UISplitViewController (react-native-screens gamma
 * Split, same family as the T3 fork uses) — sidebar column + detail stack.
 * The host collapses to stacked presentation itself in compact size classes,
 * and the display-mode button is the native one — no JS-emulated split.
 * iPhone and non-iOS always take the stacked native-stack path.
 */
function SplitShell({ theme }: { theme: AppTheme }) {
  const { width, height } = useWindowDimensions();
  const metrics = splitColumnMetrics({ width, height });
  return (
    <NavigationContainer theme={navTheme(theme)}>
      <Split.Host
        columnMetrics={metrics}
        preferredDisplayMode="automatic"
        preferredSplitBehavior="automatic"
        displayModeButtonVisibility="automatic"
        primaryEdge="leading"
        primaryBackgroundStyle="sidebar"
        presentsWithGesture
      >
        <Split.Column>
          <SidebarScreen />
        </Split.Column>
        <Split.Column>
          <DetailStack />
        </Split.Column>
      </Split.Host>
    </NavigationContainer>
  );
}

export function RootNavigation() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const split = Platform.OS === 'ios' && Platform.isPad && shellMode({ width, height }) === 'split';
  if (split) return <SplitShell theme={theme} />;
  return <Navigation theme={navTheme(theme)} />;
}
