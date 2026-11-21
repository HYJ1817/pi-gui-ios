import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, realpathSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/control.mjs';

const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-I', '-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required; do not skip filesystem security tests');
const observed = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/hermes-versioned-aliases.json')));
const framework = 'hermes-engine/destroot/Library/Frameworks/macosx/hermesvm.framework';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-alias-synthetic-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/ci', 'ios/Pods', 'node_modules', 'private', 'native']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['native-dependencies.py', 'verify-ipa.py', 'verify-template.py']) cpSync(join(ROOT, 'scripts/ci', file), join(root, 'scripts/ci', file));
  for (const file of ['Gemfile', 'package-lock.json', 'ios/Podfile', 'private/Gemfile.lock', 'private/Podfile.lock']) writeFileSync(join(root, file), 'synthetic fixture only');
  return root;
}
function py(root, body, ...args) {
  const code = `import importlib.util,pathlib,json,os,stat,shutil\ns=importlib.util.spec_from_file_location('native_dependencies',pathlib.Path('scripts/ci/native-dependencies.py')); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nroot=pathlib.Path.cwd(); pods=root/'ios/Pods'\n${body}`;
  return spawnSync(PYTHON, ['-I', '-c', code, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
}
function passed(result, code) { assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout.trim(), code); }
const setup = `
for prefix in m.HERMES_FRAMEWORK_ROOTS:
 fw=pods/prefix.removeprefix('pods/'); version=fw/'Versions/1'
 (version/'Resources').mkdir(parents=True)
 (version/'Resources/Info.plist').write_bytes(b'synthetic plist')
 (version/'hermesvm').write_bytes(b'\\xcf\\xfa\\xed\\xfe' + b'synthetic binary')
 os.symlink('1',fw/'Versions/Current',target_is_directory=True)
 os.symlink('Versions/Current/Resources',fw/'Resources',target_is_directory=True)
 os.symlink('Versions/Current/hermesvm',fw/'hermesvm')
fw=pods/'${framework}'
`;

test('dependency alias policy equals all six observed pinned Hermes Debug/Release archive links', t => {
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'node_modules/react-native/package.json'))).version, observed.reactNativeVersion);
  assert.equal(readFileSync(join(ROOT, 'node_modules/react-native/sdks/hermes-engine/version.properties'), 'utf8').trim(), 'HERMES_VERSION_NAME=' + observed.hermesVersion);
  assert.deepEqual(observed.archives.map(a => a.configuration), ['debug', 'release']);
  const result = py(fixture(t), `
import sys
observed=json.loads(pathlib.Path(sys.argv[1]).read_text())
expected={'pods/hermes-engine/'+row['path']:row['target'] for row in observed['links']}
assert {path:rule['target'] for path,rule in m.HERMES_ALIASES.items()} == expected
assert len(m.HERMES_ALIASES) == 6
print('EXACT_OBSERVED_SIX_ALIASES')`, join(ROOT, 'tests/fixtures/hermes-versioned-aliases.json'));
  passed(result, 'EXACT_OBSERVED_SIX_ALIASES');
});
test('manifest v2 includes an explicit deterministic alias inventory even without links', t => {
  const root = fixture(t);
  passed(py(root, `
a=m.inventory(root); b=m.inventory(root)
assert a == b == {'schemaVersion':2,'files':[],'links':[]}
print('MANIFEST_V2_EMPTY_ALIASES')`), 'MANIFEST_V2_EMPTY_ALIASES');
});
test('macOS canonical tests are required before generating any native project', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  const ios = workflow.slice(workflow.indexOf('  ios:'));
  const canonical = ios.indexOf('run: npm test');
  assert.ok(canonical > ios.indexOf('Install locked JavaScript dependencies'));
  assert.ok(canonical < ios.indexOf('Generate native project'));
});

// Windows cannot create POSIX links without extra privileges. It executes real
// junction/reparse negatives, not a fake positive. The same canonical file runs
// actual os.symlink positives + negatives on the macOS runner before prebuild.
if (process.platform === 'win32') {
  for (const alias of ['Resources', 'Versions/Current']) test(`reject Windows junction even at reviewed Hermes alias ${alias}`, t => {
    const root = fixture(t); const fw = join(root, 'ios/Pods', framework);
    mkdirSync(join(fw, 'Versions/1/Resources'), { recursive: true });
    const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'private.a'), 'SYNTHETIC-OUTSIDE');
    symlinkSync(outside, join(fw, alias), 'junction');
    passed(py(root, `
try: m.inventory(root)
except m.GateError as e: assert str(e) == 'NATIVE_PREBUILT_LINK_REJECTED'
else: raise AssertionError('junction accepted')
print('REAL_WINDOWS_JUNCTION_REJECTED')`), 'REAL_WINDOWS_JUNCTION_REJECTED');
  });
} else {
  test('real POSIX Hermes aliases are recorded while only physical target bytes are hashed', t => {
    passed(py(fixture(t), setup + `
manifest=m.inventory(root)
assert manifest['schemaVersion'] == 2 and len(manifest['links']) == 6 and len(manifest['files']) == 4
assert manifest == m.inventory(root)
assert manifest['links'] == sorted([{'path':path,'target':rule['target']} for path,rule in m.HERMES_ALIASES.items()],key=lambda x:x['path'])
assert all('/Versions/1/' in row['path'] for row in manifest['files'])
print('REAL_POSIX_ALIASES_AND_BYTES')`), 'REAL_POSIX_ALIASES_AND_BYTES');
  });
  const negatives = [
    ['absolute alias', `(fw/'Resources').unlink(); os.symlink(str(fw/'Versions/1/Resources'),fw/'Resources',target_is_directory=True)`],
    ['traversal alias', `(fw/'Resources').unlink(); os.symlink('Versions/1/../1/Resources',fw/'Resources',target_is_directory=True)`],
    ['backslash alias', `(fw/'Resources').unlink(); os.symlink('Versions\\\\Current\\\\Resources',fw/'Resources',target_is_directory=True)`],
    ['different current version', `(fw/'Versions/Current').unlink(); (fw/'Versions/2').mkdir(); os.symlink('2',fw/'Versions/Current',target_is_directory=True)`],
    ['dangling target', `(fw/'Versions/1/hermesvm').unlink()`],
    ['target is another symlink', `(fw/'Versions/1/hermesvm').unlink(); os.symlink('Resources/Info.plist',fw/'Versions/1/hermesvm')`],
    ['binary target is directory', `(fw/'Versions/1/hermesvm').unlink(); (fw/'Versions/1/hermesvm').mkdir()`],
    ['resources target is file', `shutil.rmtree(fw/'Versions/1/Resources'); (fw/'Versions/1/Resources').write_text('synthetic')`],
    ['unknown alias', `os.symlink('Versions/1',fw/'Headers',target_is_directory=True)`],
    ['partly removed alias group', `(fw/'Resources').unlink()`],
    ['cross-framework target', `(fw/'hermesvm').unlink(); os.symlink('../../other.framework/Versions/1/hermesvm',fw/'hermesvm')`],
    ['physical version directory is link', `shutil.rmtree(fw/'Versions/1'); outside=root/'outside'; outside.mkdir(); (outside/'private.a').write_text('SYNTHETIC-PRIVATE'); os.symlink(str(outside),fw/'Versions/1',target_is_directory=True)`],
    ['nested resource escape', `outside=root/'outside'; outside.mkdir(); (outside/'private.a').write_text('SYNTHETIC-PRIVATE'); os.symlink(str(outside),fw/'Versions/1/Resources/escape',target_is_directory=True)`],
    ['unreviewed framework name', `fw.rename(fw.with_name('other.framework'))`],
    ['framework ancestor alias', `destination=fw.with_name('moved.framework'); fw.rename(destination); os.symlink(destination.name,fw,target_is_directory=True)`],
  ];
  for (const [name, mutation] of negatives) test(`real POSIX inventory rejects ${name}`, t => {
    passed(py(fixture(t), setup + '\n' + mutation + `
try: m.inventory(root)
except m.GateError as e: assert str(e) == 'NATIVE_PREBUILT_LINK_REJECTED'
else: raise AssertionError('unsafe alias accepted')
print('REAL_POSIX_LINK_REJECTED')`), 'REAL_POSIX_LINK_REJECTED');
  });
  test('locked verification binds aliases as well as physical bytes and rejects drift', t => {
    passed(py(fixture(t), setup + `
manifest=m.inventory(root); candidate=root/'private'
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(manifest))
(root/'native/prebuilt-dependencies.json').write_text(json.dumps(manifest))
review={'schemaVersion':1,'approved':True,'hashes':m.hashes(root,candidate)}
(root/'native/lock-review.json').write_text(json.dumps(review))
m.verify_locked(root,candidate,manifest)
(fw/'Versions/1/hermesvm').write_bytes(b'changed synthetic binary')
changed=m.inventory(root)
assert changed['links'] == manifest['links'] and changed['files'] != manifest['files']
try: m.verify_locked(root,candidate,changed)
except m.GateError: pass
else: raise AssertionError('physical byte drift accepted')
changed=json.loads(json.dumps(manifest)); changed['links'][0]['target']='unreviewed'
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(changed))
try: m.verify_locked(root,candidate,changed)
except m.GateError: pass
else: raise AssertionError('alias manifest drift accepted')
print('LOCKED_ALIASES_AND_BYTES_BOUND')`), 'LOCKED_ALIASES_AND_BYTES_BOUND');
  });
}
