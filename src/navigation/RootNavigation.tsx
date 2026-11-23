import { DarkTheme, DefaultTheme, NavigationContainer, createStaticNavigation, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator, createNativeStackScreen } from '@react-navigation/native-stack';
import { Platform, useWindowDimensions } from 'react-native';
import { Split } from 'react-native-screens/experimental';
import { useTheme, type AppTheme } from '../theme';
import { splitColumnMetrics } from '../design/layout';
import type { RootStackParamList } from './types';
import SidebarScreen from './SidebarScreen';
import HomeScreen from '../screens/HomeScreen';
import SessionsScreen from '../screens/SessionsScreen';
import ConversationScreen from '../screens/ConversationScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import ApprovalDetailScreen from '../screens/ApprovalDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import InfrastructureProbe from '../screens/InfrastructureProbe';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';

// Single screen registry. The stacked shell consumes it via the static-config
// navigator below; the iPad split detail stack maps the SAME entries onto a
// dynamic <Screen> set, so the two shells can never drift apart.
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

// Stacked (iPhone / compact) navigator: React Navigation static config.
const RootStack = createNativeStackNavigator({
  initialRouteName: 'Home',
  screenOptions: { headerBackButtonDisplayMode: 'minimal' },
  screens: SCREENS,
});
const Navigation = createStaticNavigation(RootStack);

// Detail-column stack inside the iPad split: a navigator created WITHOUT a
// config returns the dynamic { Navigator, Screen, Group } triple — passing a
// static config would return { config, with, getComponent } only, whose
// Navigator/Screen members do not exist at runtime.
const DetailNav = createNativeStackNavigator<RootStackParamList>();
// Static-config `options` is typed against ParamListForStaticScreenConfig; the
// values are plain NativeStackNavigationOptions|fn identical in shape to the
// dynamic Screen prop — cast once at the mapping boundary.
type DetailScreenProps = React.ComponentProps<typeof DetailNav.Screen>;
const DETAIL_SCREENS = (Object.entries(SCREENS) as [keyof RootStackParamList, (typeof SCREENS)[keyof typeof SCREENS]][]).map(
  ([name, config]) => ({ name, component: config.screen, options: config.options as DetailScreenProps['options'] }),
);

function DetailStack() {
  return (
    <DetailNav.Navigator initialRouteName="Home" screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      {DETAIL_SCREENS.map(s => (
        <DetailNav.Screen key={s.name} name={s.name} component={s.component} options={s.options} />
      ))}
    </DetailNav.Navigator>
  );
}

function navTheme(theme: AppTheme): Theme {
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: theme.background, card: theme.surface, text: theme.text, primary: theme.accent, border: theme.line } };
}

/**
 * iPad: real UISplitViewController (react-native-screens gamma Split, same
 * family as the T3 fork uses) — sidebar column + detail stack. Split is chosen
 * by Platform.isPad ALONE, never by width: crossing a width breakpoint would
 * unmount/remount the whole navigator tree and destroy navigation state during
 * iPad multitasking resizes (Stage Manager, split-view, slide-over). The host
 * itself collapses to a single column in compact size classes, and the
 * display-mode button is the native one — no JS-emulated split.
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
  if (Platform.OS === 'ios' && Platform.isPad) return <SplitShell theme={theme} />;
  return <Navigation theme={navTheme(theme)} />;
}
