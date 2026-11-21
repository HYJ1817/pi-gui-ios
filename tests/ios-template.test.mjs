import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from '../scripts/lib/control.mjs';
const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required; no template policy tests are skipped');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'expo-template-policy-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); cpSync(join(ROOT, 'scripts/ci'), join(root, 'scripts/ci'), { recursive: true });
  mkdirSync(join(root, 'ios/PiGUIMobile'), { recursive: true }); cpSync(join(ROOT, 'tests/fixtures/expo58-template-info.plist'), join(root, 'ios/PiGUIMobile/Info.plist'));
  const options = { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }; return { root, options };
}
function configure(f) { return spawnSync(PYTHON, ['scripts/ci/configure-native.py'], f.options); }
function mutate(f, statement) { const result = spawnSync(PYTHON, ['-c', `import plistlib,pathlib\np=pathlib.Path('ios/PiGUIMobile/Info.plist');v=plistlib.loads(p.read_bytes())\n${statement}\np.write_bytes(plistlib.dumps(v))`], f.options); assert.equal(result.status, 0, result.stderr); }

test('official pinned Expo template fixture retains its source checksum and copyright notice', () => {
  const source = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/expo58-template-source.json'))); const body = readFileSync(join(ROOT, 'tests/fixtures/expo58-template-info.plist'));
  assert.equal(createHash('sha256').update(body).digest('hex'), source.sha256); assert.equal(source.version, '58.0.35'); assert.match(readFileSync(join(ROOT, 'tests/fixtures/EXPO_TEMPLATE_LICENSE.txt'), 'utf8'), /650 Industries/);
});
test('actual SDK single-scene template is accepted while its local-network ATS exemption is closed', t => {
  const f = fixture(t), result = configure(f); assert.equal(result.status, 0, result.stdout + result.stderr);
  const check = spawnSync(PYTHON, ['-c', "import pathlib,plistlib;v=plistlib.loads(pathlib.Path('ios/PiGUIMobile/Info.plist').read_bytes());assert v['NSAppTransportSecurity']=={'NSAllowsArbitraryLoads':False,'NSAllowsLocalNetworking':False};assert v['UIApplicationSceneManifest']['UIApplicationSupportsMultipleScenes'] is False;print('SINGLE_SCENE_AND_CLOSED_ATS')"], f.options);
  assert.equal(check.status, 0, check.stderr); assert.match(check.stdout, /SINGLE_SCENE_AND_CLOSED_ATS/);
});
for (const [name, statement] of [
  ['multiple scenes', "v['UIApplicationSceneManifest']['UIApplicationSupportsMultipleScenes']=True"],
  ['non-boolean scene capability', "v['UIApplicationSceneManifest']['UIApplicationSupportsMultipleScenes']=0"],
  ['unexpected scene role', "v['UIApplicationSceneManifest']['UISceneConfigurations']['ExternalRole']=[]"],
  ['extra scene field', "v['UIApplicationSceneManifest']['UISceneConfigurations']['UIWindowSceneSessionRoleApplication'][0]['UISceneClassName']='Unapproved'"],
  ['unapproved delegate', "v['UIApplicationSceneManifest']['UISceneConfigurations']['UIWindowSceneSessionRoleApplication'][0]['UISceneDelegateClassName']='OtherModule.SecretDelegate'"],
  ['second scene', "s=v['UIApplicationSceneManifest']['UISceneConfigurations']['UIWindowSceneSessionRoleApplication'];s.append(dict(s[0]))"],
]) test('scene policy rejects ' + name, t => {
  const f = fixture(t); mutate(f, statement); const result = configure(f); assert.equal(result.status, 1); assert.match(result.stdout, /PLIST_SCENE_CONFIGURATION/);
});
for (const [name, statement] of [
  ['global insecure ATS', "v['NSAppTransportSecurity']['NSAllowsArbitraryLoads']=True"],
  ['localhost insecure exception', "v['NSAppTransportSecurity']['NSExceptionDomains']={'localhost':{'NSExceptionAllowsInsecureHTTPLoads':True}}"],
  ['unknown sensitive permission', "v['NSFutureSensitiveUsageDescription']='SYNTHETIC_PRIVATE_VALUE'"],
]) test('template compatibility does not relax ' + name, t => {
  const f = fixture(t); mutate(f, statement); const result = configure(f); assert.equal(result.status, 1); assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_PRIVATE_VALUE'), false);
});
test('unpinned or changed template archive is rejected before extraction', t => {
  const f = fixture(t); const input = join(f.root, 'untrusted.tgz'); writeFileSync(input, 'SYNTHETIC_PRIVATE_TARBALL');
  const result = spawnSync(PYTHON, ['scripts/ci/verify-template.py', input], f.options); assert.equal(result.status, 1); assert.equal(result.stdout.trim(), 'NATIVE_TEMPLATE_REJECTED'); assert.equal(result.stderr, '');
});
test('workflow pins template version, ignores fetch lifecycle scripts and verifies bytes before prebuild', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  assert.match(workflow, /npm pack expo-template-bare-minimum@58\.0\.35 --ignore-scripts/);
  const verify = workflow.indexOf('python3 scripts/ci/verify-template.py'); const prebuild = workflow.indexOf('npx expo prebuild'); assert.ok(verify >= 0 && prebuild > verify); assert.match(workflow, /prebuild --platform ios --no-install --template/);
});
