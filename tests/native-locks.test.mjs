import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/control.mjs';

// The actual Ruby parser, not a JS imitation. CI installs this exact runtime on
// Windows as well as macOS; missing tools fail canonical npm test, never skip.
const RUBY = process.env.RUBY || 'ruby';
const runtime = spawnSync(RUBY, ['-e', "gem 'bundler', '= 2.6.9'; require 'bundler'; puts RUBY_VERSION; puts Bundler::VERSION"], { encoding: 'utf8' });
assert.equal(runtime.status, 0, 'Ruby 3.3.8 + Bundler 2.6.9 required for native lock security tests; set RUBY/GEM_HOME/GEM_PATH for a portable installation. ' + (runtime.stderr || runtime.error?.message || ''));
assert.deepEqual(runtime.stdout.trim().split(/\r?\n/), ['3.3.8', '2.6.9']);
const marker = 'SYNTHETIC_PRIVATE_LOCK_MARKER';
// Deliberately synthetic locks, not macOS candidates or evidence of a real pod
// resolution. They exercise the same Bundler/Psych code used on the runner.
const GEM = `GEM
  remote: https://rubygems.org/
  specs:
    cocoapods (1.16.2)

PLATFORMS
  arm64-darwin-25

DEPENDENCIES
  bundler (= 2.6.9)
  cocoapods (= 1.16.2)

RUBY VERSION
   ruby 3.3.8p144

BUNDLED WITH
   2.6.9
`;
const POD = `PODS:
  - Synthetic (1.0.0)

DEPENDENCIES:
  - Synthetic (from \`../node_modules/synthetic\`)

EXTERNAL SOURCES:
  Synthetic:
    :path: "../node_modules/synthetic"

SPEC CHECKSUMS:
  Synthetic: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

PODFILE CHECKSUM: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

COCOAPODS: 1.16.2
`;
function fixture(t, pod = POD, gem = GEM) {
  const root = mkdtempSync(join(tmpdir(), 'native-lock-synthetic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'Gemfile'), "source 'https://rubygems.org'\nruby '3.3.8'\ngem 'cocoapods', '= 1.16.2'\ngem 'bundler', '= 2.6.9'\n");
  writeFileSync(join(root, 'Gemfile.lock'), gem);
  writeFileSync(join(root, 'Podfile.lock'), pod);
  const options = { cwd: root, env: { ...process.env, BUNDLE_GEMFILE: join(root, 'Gemfile') }, encoding: 'utf8' };
  return { root, options };
}
function validate(f, script = join(ROOT, 'scripts/ci/validate-locks.rb')) {
  return spawnSync(RUBY, [script, f.root], f.options);
}
function reject(t, pod, phase, gem = GEM) {
  const f = fixture(t, pod, gem);
  const before = [readFileSync(join(f.root, 'Gemfile.lock')), readFileSync(join(f.root, 'Podfile.lock'))];
  const result = validate(f);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'NATIVE_LOCKS_REJECTED_' + phase);
  assert.equal((result.stdout + result.stderr).includes(marker), false);
  assert.deepEqual([readFileSync(join(f.root, 'Gemfile.lock')), readFileSync(join(f.root, 'Podfile.lock'))], before, 'Rejected locks must remain byte-for-byte untouched');
}

test('real Bundler/Psych accepts CocoaPods Symbol source keys and preserves deployment semantics', t => {
  const f = fixture(t);
  const first = validate(f); assert.equal(first.status, 0, first.stdout + first.stderr); assert.equal(first.stdout.trim(), 'NATIVE_LOCKS_SAFE');
  const serialized = readFileSync(join(f.root, 'Podfile.lock'));
  const semantic = spawnSync(RUBY, ['-e', "require 'yaml'; p = YAML.safe_load(File.read(ARGV[0]), permitted_classes: [Symbol], permitted_symbols: [:path], aliases: false); abort unless p.fetch('EXTERNAL SOURCES').fetch('Synthetic') == {path: '../node_modules/synthetic'}; puts 'SYMBOL_SOURCE_PRESERVED'", join(f.root, 'Podfile.lock')], f.options);
  assert.equal(semantic.status, 0, semantic.stderr); assert.equal(semantic.stdout.trim(), 'SYMBOL_SOURCE_PRESERVED');
  const second = validate(f); assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.deepEqual(readFileSync(join(f.root, 'Podfile.lock')), serialized, 'Canonicalization must be idempotent');
});
for (const [option, value] of [
  ['podspec', '../node_modules/react-native/third-party-podspecs/Synthetic.podspec'],
  ['path', 'build/generated/ios'],
  ['path', '../node_modules/@synthetic/native-module'],
]) test(`allow only generated dependency locations for ${option}: ${value}`, t => {
  const f = fixture(t, POD.replace(':path: "../node_modules/synthetic"', `:${option}: "${value}"`));
  const result = validate(f); assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('finite Symbol vocabulary supports HTTPS checkout options without converting keys', t => {
  const source = `:git: https://github.com/synthetic/native.git\n    :commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
  const pod = POD.replace(':path: "../node_modules/synthetic"', source) + `\nCHECKOUT OPTIONS:\n  Synthetic:\n    ${source}\n`;
  const f = fixture(t, pod); const result = validate(f); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(f.root, 'Podfile.lock'), 'utf8'), /:git: https:\/\/github.com\/synthetic\/native.git/);
});
for (const [name, pod, phase] of [
  ['unknown Symbol key', POD.replace(':path:', ':unreviewed_option:'), 'POD_PARSE'],
  ['unknown Symbol scalar', POD.replace('Synthetic: aaaa', `Synthetic: :${marker}\n  Other: aaaa`), 'POD_PARSE'],
  ['Ruby object tag', POD.replace(':path: "../node_modules/synthetic"', `:path: !ruby/object:${marker} {}`), 'POD_PARSE'],
  ['YAML alias', POD.replace('PODS:\n', 'PODS: &items\n').replace('DEPENDENCIES:\n  - Synthetic (from `../node_modules/synthetic`)', 'DEPENDENCIES: *items'), 'POD_PARSE'],
  ['absolute path', POD.replace('../node_modules/synthetic"', `/${marker}"`), 'POD_SOURCES'],
  ['escaping path', POD.replace('../node_modules/synthetic"', `../node_modules/../../${marker}"`), 'POD_SOURCES'],
  ['unknown source option', POD.replace(':path:', 'unreviewed_option:'), 'POD_SOURCES'],
  ['Symbol outside source options', POD.replace('Synthetic: aaaa', ':path: aaaa'), 'POD_CHECKSUMS'],
  ['credential URL', POD.replace(':path: "../node_modules/synthetic"', `:git: "https://${marker}@github.com/synthetic/native.git"`), 'POD_SOURCES'],
  ['query URL', POD.replace(':path: "../node_modules/synthetic"', `:http: "https://repo.reactnative.dev/synthetic.tar.gz?secret=${marker}"`), 'POD_SOURCES'],
  ['unapproved host', POD.replace(':path: "../node_modules/synthetic"', ':http: "https://unapproved.invalid/native.tar.gz"'), 'POD_SOURCES'],
  ['unknown top-level key', POD + `\n${marker}: hidden\n`, 'POD_STRUCTURE_KEYS'],
  ['non-map YAML root', '- Synthetic\n', 'POD_STRUCTURE_ROOT'],
  ['unexpected CocoaPods version value', POD.replace('COCOAPODS: 1.16.2', `COCOAPODS: ${marker}`), 'POD_STRUCTURE_VERSION'],
  ['non-array dependencies', POD.replace('DEPENDENCIES:\n  - Synthetic (from `../node_modules/synthetic`)', 'DEPENDENCIES: {}'), 'POD_DEPENDENCY_ARRAY'],
  ['invalid pod entry key', POD.replace('  - Synthetic (1.0.0)', `  - "${marker}:invalid": []`), 'POD_ENTRY_KEY'],
  ['unsupported pod value type', POD.replace('  - Synthetic (1.0.0)', '  - false'), 'POD_ENTRY_TYPE'],
  ['invalid dependency reference', POD.replace('Synthetic (from `../node_modules/synthetic`)', `Synthetic (from [${marker}])`), 'POD_ENTRY_REFERENCE'],
  ['escaping dependency reference', POD.replace('Synthetic (from `../node_modules/synthetic`)', `Synthetic (from \`../../${marker}\`)`), 'POD_ENTRY_LOCAL_PATH'],
  ['unknown spec repository', POD + `\nSPEC REPOS:\n  ${marker}: []\n`, 'POD_REPOSITORIES'],
  ['NUL content', POD + '\0', 'POD_FORMAT'],
]) test(`reject ${name} without disclosing values or modifying either lock`, t => reject(t, pod, phase));
test('safe reconstruction removes YAML comments rather than publishing unparsed text', t => {
  const f = fixture(t, `# ${marker}\n` + POD); const result = validate(f); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.root, 'Podfile.lock'), 'utf8').includes(marker), false);
});
for (const [name, gem, phase] of [
  ['unknown Gem remote', GEM.replace('https://rubygems.org/', 'https://unapproved.invalid/'), 'GEM_FORMAT'],
  ['unparsed Gem comment', GEM + `# ${marker}\n`, 'GEM_FORMAT'],
  ['different CocoaPods version', GEM.replaceAll('1.16.2', '1.16.1'), 'GEM_CONSTRAINTS'],
  ['different Bundler version', GEM.replaceAll('2.6.9', '2.6.8'), 'GEM_CONSTRAINTS'],
]) test(`reject ${name}`, t => reject(t, POD, phase, gem));
