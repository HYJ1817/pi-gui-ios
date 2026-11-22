import { useColorScheme } from 'react-native';
import { appTheme, type AppTheme } from './design/app-theme';
import { themeFor, type ThemeTokens, type ThemeName, themes, lightTheme, darkTheme } from './design/tokens';

export type { ThemeTokens, ThemeName, AppTheme };
export { themes, lightTheme, darkTheme, appTheme };

export function useTheme(): AppTheme {
  return appTheme(useColorScheme() === 'dark');
}
