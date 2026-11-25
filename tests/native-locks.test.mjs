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
// Exercise the installed, package-lock-pinned RN helper methods. Reading its
// documented paths alone would miss changes to facade_path(name)'s behavior.
const facadeRuntime = spawnSync(RUBY, ['-e', `require 'json'
require File.join(ARGV[0], 'scripts/cocoapods/rncore_facades.rb')
require File.join(ARGV[0], 'scripts/cocoapods/rndeps_facades.rb')
paths = {}
[RNCoreFacades, RNDepsFacades].each do |family|
  family::FACADE_PODS.each_key { |name| paths[name] = family.facade_path(name) }
end
puts JSON.generate(paths)`, join(ROOT, 'node_modules/react-native')], { encoding: 'utf8' });
assert.equal(facadeRuntime.status, 0, facadeRuntime.stderr);
const facadePaths = JSON.parse(facadeRuntime.stdout);
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
test('locked React Native facade helpers expose only the reviewed 14 generated pod locations', () => {
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'node_modules/react-native/package.json'))).version, '0.88.1');
  const core = ['FBLazyVector', 'RCTDeprecation', 'RCTRequired', 'React-Core', 'React-RCTFabric', 'React-RCTRuntime', 'Yoga'];
  const deps = ['DoubleConversion', 'RCT-Folly', 'SocketRocket', 'boost', 'fast_float', 'fmt', 'glog'];
  assert.deepEqual(facadePaths, Object.fromEntries([
    ...core.map(name => [name, 'build/rncore-facades/' + name]),
    ...deps.map(name => [name, 'build/rndeps-facades/' + name]),
  ]));
});
for (const [name, path] of Object.entries(facadePaths)) test(`locked React Native facade source is accepted only for its real pod: ${name}`, t => {
  const pod = POD.replaceAll('Synthetic', name).replaceAll('../node_modules/synthetic', path);
  const f = fixture(t, pod); const first = validate(f); assert.equal(first.status, 0, first.stdout + first.stderr);
  const before = readFileSync(join(f.root, 'Podfile.lock'));
  const second = validate(f); assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.deepEqual(readFileSync(join(f.root, 'Podfile.lock')), before);
});
for (const [description, pod, phase] of [
  ['unknown facade pod', POD.replaceAll('../node_modules/synthetic', 'build/rncore-facades/Synthetic'), 'POD_ENTRY_LOCAL_PATH'],
  ['known directory bound to another pod', POD.replaceAll('../node_modules/synthetic', facadePaths['React-Core']), 'POD_ENTRY_LOCAL_PATH'],
  ['core pod bound to deps directory', POD.replaceAll('Synthetic', 'React-Core').replaceAll('../node_modules/synthetic', 'build/rndeps-facades/React-Core'), 'POD_ENTRY_LOCAL_PATH'],
  ['facade path child', POD.replaceAll('Synthetic', 'React-Core').replaceAll('../node_modules/synthetic', facadePaths['React-Core'] + '/Headers'), 'POD_ENTRY_LOCAL_PATH'],
  ['facade path traversal', POD.replaceAll('Synthetic', 'React-Core').replaceAll('../node_modules/synthetic', facadePaths['React-Core'] + '/../React-Core'), 'POD_ENTRY_LOCAL_PATH'],
  ['arbitrary build path', POD.replaceAll('../node_modules/synthetic', 'build/arbitrary/Synthetic'), 'POD_ENTRY_LOCAL_PATH'],
  ['source option wrong pod binding', POD.replace(':path: "../node_modules/synthetic"', ':path: "' + facadePaths['React-Core'] + '"'), 'POD_SOURCES'],
  ['facade directory as podspec', POD.replace(':path: "../node_modules/synthetic"', ':podspec: "' + facadePaths['React-Core'] + '"').replaceAll('Synthetic', 'React-Core'), 'POD_SOURCES'],
]) test(`reject ${description} without allowing arbitrary generated paths`, t => reject(t, pod, phase));
test('reviewed core subspec uses the same root facade path', t => {
  const pod = POD.replaceAll('Synthetic', 'React-Core').replaceAll('../node_modules/synthetic', facadePaths['React-Core'])
    .replace('  - React-Core (from ', '  - React-Core/RCTWebSocket (from ');
  const f = fixture(t, pod); const result = validate(f); assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('M5 first-party source pod is accepted only at its reviewed exact directory', t => {
  const pod = POD.replaceAll('Synthetic', 'PiGuiRemote').replaceAll('../node_modules/synthetic', '../modules/pi-gui-remote/ios');
  const f = fixture(t, pod); const result = validate(f);
  assert.equal(result.status, 0, result.stderr);
});
for (const [name, pod] of [
  ['wrong pod identity', POD.replaceAll('../node_modules/synthetic', '../modules/pi-gui-remote/ios')],
  ['module source child', POD.replaceAll('Synthetic', 'PiGuiRemote').replaceAll('../node_modules/synthetic', '../modules/pi-gui-remote/ios/child')],
  ['another local module', POD.replaceAll('Synthetic', 'PiGuiRemote').replaceAll('../node_modules/synthetic', '../modules/another/ios')],
  ['local module traversal', POD.replaceAll('Synthetic', 'PiGuiRemote').replaceAll('../node_modules/synthetic', '../modules/pi-gui-remote/ios/../ios')],
]) test(`first-party local pod rejects ${name}`, t => reject(t, pod, 'POD_ENTRY_LOCAL_PATH'));

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

// Pods Manifest.lock stamping: install-pods.sh may copy the reviewed Podfile.lock
// onto Pods/Manifest.lock only to defeat byte-level serialization drift. The
// manifest-compare mode must prove semantic equality first — equal resolutions
// may differ in bytes, real differences must always block the stamp.
function compare(t, left, right) {
  const f = fixture(t);
  writeFileSync(join(f.root, 'podfile.lock'), left);
  writeFileSync(join(f.root, 'manifest.lock'), right);
  return spawnSync(RUBY, [join(ROOT, 'scripts/ci/validate-locks.rb'), 'manifest-compare', join(f.root, 'podfile.lock'), join(f.root, 'manifest.lock')], f.options);
}
test('Manifest.lock stamping: byte-format drift passes semantic compare', t => {
  const reformatted = POD.replace('  - Synthetic (1.0.0)', '  - Synthetic (1.0.0) ').replace('COCOAPODS: 1.16.2\n', 'COCOAPODS: 1.16.2\n\n');
  const result = compare(t, POD, reformatted);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /POD_MANIFEST_MATCH/);
});
for (const [name, mutation] of [
  ['different pod version', POD.replace('Synthetic (1.0.0)', 'Synthetic (1.0.1)')],
  ['different spec checksum', POD.replace('SPEC CHECKSUMS:\n  Synthetic: aaaa', 'SPEC CHECKSUMS:\n  Synthetic: bbbb')],
  ['different source path', POD.replace('../node_modules/synthetic', '../node_modules/other')],
  ['unparseable manifest', 'not: [valid'],
  ['empty manifest', ''],
]) test(`Manifest.lock stamping refused on ${name}`, t => {
  const result = compare(t, POD, mutation);
  assert.equal(result.status, 1); assert.match(result.stderr, /POD_MANIFEST_DRIFT/);
  assert.equal(result.stderr.includes(marker), false);
});
