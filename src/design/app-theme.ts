// Pure theme mapping — the AppTheme view over the token palette with legacy
// field names the existing screens use. No React/native imports so unit tests
// can assert the mapping directly.
import { themeFor, type ThemeTokens } from './tokens';

export interface AppTheme {
  dark: boolean;
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  secondary: string;
  tertiary: string;
  accent: string;
  onAccent: string;
  line: string;
  decorative: string;
  success: string;
  warning: string;
  danger: string;
  pending: string;
  userBubble: string;
  assistantBubble: string;
  codeBackground: string;
  approvalSurface: string;
  approvalAccent: string;
  tokens: ThemeTokens;
}

export function appTheme(dark: boolean): AppTheme {
  const t = themeFor(dark);
  return {
    dark,
    background: t.colors.background,
    surface: t.colors.surface,
    surfaceElevated: t.colors.surfaceElevated,
    text: t.colors.text,
    secondary: t.colors.textSecondary,
    tertiary: t.colors.textTertiary,
    accent: t.colors.accent,
    onAccent: t.colors.onAccent,
    line: t.colors.border,
    decorative: t.colors.decorative,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    pending: t.colors.pending,
    userBubble: t.colors.userBubble,
    assistantBubble: t.colors.assistantBubble,
    codeBackground: t.colors.codeBackground,
    approvalSurface: t.colors.approvalSurface,
    approvalAccent: t.colors.approvalAccent,
    tokens: t,
  };
}
