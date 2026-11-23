// Responsive layout decisions for iPhone/iPad (pure, testable).
// Breakpoints and split-vs-stack rules used by the navigation + screens.

export type SizeClass = 'compact' | 'regular';

export interface ShellGeometry {
  width: number;
  height: number;
}

export const SPLIT_MIN_WIDTH = 768;   // iPad portrait width triggers the two-pane shell
export const CONTENT_MAX = 760;       // readable column cap

export function isRegularSizeClass(g: ShellGeometry): boolean {
  return g.width >= SPLIT_MIN_WIDTH;
}

// iPad / wide: a persistent side column + detail pane. iPhone / narrow: stacked push nav.
export type ShellMode = 'stacked' | 'split';
export function shellMode(g: ShellGeometry): ShellMode {
  return isRegularSizeClass(g) ? 'split' : 'stacked';
}

// Sidebar column width in split mode (iOS convention ~320–375).
export function sidebarWidth(g: ShellGeometry): number {
  return isRegularSizeClass(g) ? Math.min(375, Math.round(g.width * 0.38)) : 0;
}

// Content column: clamp to a readable measure on wide screens.
export function contentWidth(g: ShellGeometry): number {
  const side = sidebarWidth(g);
  const avail = g.width - side;
  return Math.min(CONTENT_MAX, avail > 0 ? avail : g.width);
}

// Primary-column metrics for the native UISplitViewController shell
// (react-native-screens gamma Split). Preferred width is a FRACTION of the
// split — iOS convention ~30–38% — clamped by absolute min/max bounds.
export const SIDEBAR_MIN = 300;
export const SIDEBAR_MAX = 375;
export const SIDEBAR_FRACTION = 0.32;

export interface SplitColumnMetricsShape {
  minimumPrimaryColumnWidth: number;
  maximumPrimaryColumnWidth: number;
  preferredPrimaryColumnWidthOrFraction: number;
}
export function splitColumnMetrics(_g: ShellGeometry): SplitColumnMetricsShape {
  return {
    minimumPrimaryColumnWidth: SIDEBAR_MIN,
    maximumPrimaryColumnWidth: SIDEBAR_MAX,
    preferredPrimaryColumnWidthOrFraction: SIDEBAR_FRACTION,
  };
}

// Dynamic-type scale factor derived from a font-size multiplier the OS supplies.
// RN exposes preferred content size via the text style's allowFontScaling; we keep
// a clamp so huge accessibility sizes don't blow the layout out of bounds.
export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(2.0, Math.max(0.75, scale));
}
