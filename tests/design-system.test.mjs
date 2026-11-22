import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// The design layer is TypeScript; transpile it once to a temp dir and import the
// emitted CJS so unit tests run under plain node (no RN runtime needed).
const require = createRequire(import.meta.url);
const tsc = resolve('node_modules/typescript/bin/tsc');
function buildDesign(t) {
  const out = mkdtempSync(resolve(tmpdir(), 'piguimobile-design-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react', '--esModuleInterop', '--skipLibCheck', '--outDir', out,
    'src/design/tokens.ts', 'src/design/contrast.ts', 'src/design/layout.ts', 'src/design/app-theme.ts', 'src/data/fixtures.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tsc failed: ${r.stderr}\n${r.stdout}`);
  return out;
}

test('design tokens: complete, consistent light/dark, required fields', (t) => {
  const out = buildDesign(t);
  const { lightTheme, darkTheme, themes, themeFor } = require(resolve(out, 'design/tokens.js'));
  assert.ok(lightTheme && darkTheme && themes.light && themes.dark);
  assert.equal(themeFor(true).name, 'dark'); assert.equal(themeFor(false).name, 'light');
  for (const theme of [lightTheme, darkTheme]) {
    for (const key of ['background','surface','text','textSecondary','accent','onAccent','border','success','warning','danger','pending','userBubble','assistantBubble','codeBackground','approvalSurface','approvalAccent','decorative','separator','surfaceElevated','textTertiary']) {
      assert.ok(typeof theme.colors[key] === 'string' && theme.colors[key].length > 0, `missing color ${key}`);
      assert.match(theme.colors[key], /^#([0-9A-Fa-f]{6})$/, `${key} not a hex color`);
    }
    for (const key of ['body','headline','title','largeTitle','caption','mono']) assert.ok(theme.type[key] > 0);
    for (const key of ['md','lg','page']) assert.ok(theme.spacing[key] > 0);
    assert.equal(theme.minHitTarget, 44);
    assert.ok(theme.maxReadableWidth >= 600);
  }
});

test('contrast: text and accent pairings meet WCAG AA in both themes', (t) => {
  const out = buildDesign(t);
  const { contrastRatio, AA_NORMAL, AA_LARGE, AA_UI } = require(resolve(out, 'design/contrast.js'));
  const { lightTheme, darkTheme } = require(resolve(out, 'design/tokens.js'));
  for (const theme of [lightTheme, darkTheme]) {
    assert.ok(contrastRatio(theme.colors.text, theme.colors.background) >= AA_NORMAL, `${theme.name} text/background ${contrastRatio(theme.colors.text, theme.colors.background).toFixed(2)}`);
    assert.ok(contrastRatio(theme.colors.text, theme.colors.surface) >= AA_NORMAL, `${theme.name} text/surface`);
    assert.ok(contrastRatio(theme.colors.textSecondary, theme.colors.background) >= AA_NORMAL, `${theme.name} secondary/background`);
    assert.ok(contrastRatio(theme.colors.accent, theme.colors.background) >= AA_UI, `${theme.name} accent/background`);
    assert.ok(contrastRatio(theme.colors.onAccent, theme.colors.accent) >= AA_LARGE, `${theme.name} onAccent/accent`);
    assert.ok(contrastRatio(theme.colors.text, theme.colors.userBubble) >= AA_NORMAL || contrastRatio(theme.colors.onAccent, theme.colors.userBubble) >= AA_NORMAL, `${theme.name} userBubble legible`);
  }
});

test('layout: split vs stacked breakpoints and sidebar/content widths', (t) => {
  const out = buildDesign(t);
  const { shellMode, sidebarWidth, contentWidth, isRegularSizeClass, clampFontScale, SPLIT_MIN_WIDTH, CONTENT_MAX } = require(resolve(out, 'design/layout.js'));
  assert.equal(shellMode({ width: 390, height: 844 }), 'stacked');      // iPhone
  assert.equal(shellMode({ width: 768, height: 1024 }), 'split');       // iPad portrait
  assert.equal(shellMode({ width: 1180, height: 820 }), 'split');       // iPad landscape
  assert.equal(isRegularSizeClass({ width: SPLIT_MIN_WIDTH - 1, height: 0 }), false);
  assert.equal(isRegularSizeClass({ width: SPLIT_MIN_WIDTH, height: 0 }), true);
  assert.equal(sidebarWidth({ width: 390, height: 0 }), 0);
  assert.ok(sidebarWidth({ width: 1180, height: 0 }) <= 375 && sidebarWidth({ width: 1180, height: 0 }) > 0);
  assert.ok(contentWidth({ width: 390, height: 0 }) <= CONTENT_MAX);
  assert.ok(contentWidth({ width: 2000, height: 0 }) <= CONTENT_MAX);
  assert.equal(clampFontScale(3), 2.0); assert.equal(clampFontScale(0.5), 0.75); assert.equal(clampFontScale(1), 1);
});

test('theme hook: appTheme maps tokens to legacy field names', (t) => {
  const out = buildDesign(t);
  const { appTheme } = require(resolve(out, 'design/app-theme.js'));
  const light = appTheme(false), dark = appTheme(true);
  assert.equal(light.dark, false); assert.equal(dark.dark, true);
  assert.equal(light.background, light.tokens.colors.background);
  assert.equal(light.text, light.tokens.colors.text);
  assert.equal(light.accent, light.tokens.colors.accent);
  assert.equal(dark.surface, dark.tokens.colors.surface);
  assert.ok(light.tokens.colors !== dark.tokens.colors);
});

test('fixtures: opaque ids, referential integrity, bounded text', (t) => {
  const out = buildDesign(t);
  const { projects, sessions, messages, approvals, projectById, sessionsFor, messagesFor } = require(resolve(out, 'data/fixtures.js'));
  const idRe = /^[A-Za-z0-9_-]{8,128}$/;
  for (const p of projects) assert.match(p.projectId, idRe);
  for (const s of sessions) { assert.match(s.sessionId, idRe); assert.match(s.projectId, idRe); assert.ok(projectById(s.projectId)); for (const c of s.activeConversations) assert.match(c.conversationId, idRe); }
  for (const m of messages) { assert.match(m.messageId, idRe); assert.ok(m.text.length > 0 && m.text.length <= 8192); }
  for (const a of approvals) { assert.match(a.requestId, idRe); assert.ok(['confirm','select','input','editor'].includes(a.method)); }
  assert.ok(sessionsFor('project-a0001').length >= 1);
  assert.ok(messagesFor('conversation-c001').length >= 1);
  // no credentials/paths leak in fixture text
  for (const m of messages) assert.ok(!/(PI_GUI_TOKEN|api[_-]?key|C:\\|\\\\)/i.test(m.text), `fixture text leaked: ${m.text}`);
});
