// M2 design tokens — single source for light/dark palette, spacing, type, radii,
// elevation and accessibility targets. Pure data (no React/native) so unit tests
// can assert token completeness, contract shape and WCAG contrast without a device.
//
// Palette values follow iOS system colors (systemBlue/gray/etc) adapted to the
// project's cool-neutral surface scheme already used by the M-1 probe.

export type ThemeName = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  onAccent: string;
  border: string;
  separator: string;
  decorative: string;
  success: string;
  warning: string;
  danger: string;
  pending: string;
  // Chat / approval specific
  userBubble: string;
  assistantBubble: string;
  codeBackground: string;
  approvalSurface: string;
  approvalAccent: string;
}

export interface TypeScale {
  largeTitle: number;
  title: number;
  headline: number;
  body: number;
  callout: number;
  subheadline: number;
  footnote: number;
  caption: number;
  mono: number;
}

export interface Spacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  page: number;
}

export interface Radii {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}

export interface ThemeTokens {
  name: ThemeName;
  dark: boolean;
  colors: Palette;
  type: TypeScale;
  spacing: Spacing;
  radii: Radii;
  // Accessibility constants
  minHitTarget: number;      // 44pt Apple HIG
  maxReadableWidth: number;  // readable column for long content
  hairline: number;
}

const TYPE: TypeScale = {
  largeTitle: 34, title: 28, headline: 22, body: 17, callout: 16,
  subheadline: 15, footnote: 13, caption: 12, mono: 15,
};
const SPACING: Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, page: 20 };
const RADII: Radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
const HIT = 44;
const READABLE = 760;
const HAIRLINE = 0.5;

export const lightTheme: ThemeTokens = {
  name: 'light', dark: false,
  colors: {
    background: '#F4F6FA', surface: '#FFFFFF', surfaceElevated: '#FBFCFE',
    text: '#172331', textSecondary: '#536274', textTertiary: '#8B98A8',
    accent: '#1559B6', onAccent: '#FFFFFF',
    border: '#D8DFE8', separator: '#E6EBF1',
    decorative: '#D3E4FE',
    success: '#1F7A43', warning: '#9A6A00', danger: '#C4322F', pending: '#8A6D00',
    userBubble: '#1559B6', assistantBubble: '#E8EEF6',
    codeBackground: '#EFF3F8',
    approvalSurface: '#FFF8E8', approvalAccent: '#9A6A00',
  },
  type: TYPE, spacing: SPACING, radii: RADII,
  minHitTarget: HIT, maxReadableWidth: READABLE, hairline: HAIRLINE,
};

export const darkTheme: ThemeTokens = {
  name: 'dark', dark: true,
  colors: {
    background: '#111418', surface: '#20252D', surfaceElevated: '#262C35',
    text: '#F5F7FA', textSecondary: '#AFBAC8', textTertiary: '#7B8794',
    accent: '#8CB9FF', onAccent: '#111418',
    border: '#343D49', separator: '#2B333E',
    decorative: '#263D5B',
    success: '#4CC380', warning: '#E0B34C', danger: '#FF6B66', pending: '#E0B34C',
    userBubble: '#2E6FC9', assistantBubble: '#2A313B',
    codeBackground: '#1A1F26',
    approvalSurface: '#2C2416', approvalAccent: '#E0B34C',
  },
  type: TYPE, spacing: SPACING, radii: RADII,
  minHitTarget: HIT, maxReadableWidth: READABLE, hairline: HAIRLINE,
};

export const themes: Record<ThemeName, ThemeTokens> = { light: lightTheme, dark: darkTheme };
export function themeFor(dark: boolean): ThemeTokens { return dark ? darkTheme : lightTheme; }
