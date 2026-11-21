import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/control.mjs';

const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required; diagnostic privacy tests must run');
const SECRET = 'SYNTHETIC_PRIVATE_MARKER_NEVER_PUBLISH';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-diagnostics-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); cpSync(resolve(ROOT, 'scripts/ci'), join(root, 'scripts/ci'), { recursive: true });
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/public-source.ts'), `export const fieldValue = '${SECRET}';\n`);
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/react-native': { version: '0.88.1' } } }));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', 'src/public-source.ts', 'package-lock.json', 'scripts/ci/verify-ipa.py', 'scripts/ci/native-dependencies.py', 'scripts/ci/configure-native.py', 'scripts/ci/validate-locks.rb'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], { cwd: root }).status, 0);
  const privateRoot = join(root, 'runner-temp/native-private'); mkdirSync(join(privateRoot, 'logs'), { recursive: true }); mkdirSync(join(privateRoot, 'steps'));
  const options = { cwd: root, env: { ...process.env, RUNNER_TEMP: join(root, 'runner-temp'), PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' };
  return { root, privateRoot, options };
}
function scan(f, content) {
  const path = join(f.privateRoot, 'logs/pods.log'); writeFileSync(path, content);
  return spawnSync(PYTHON, ['scripts/ci/safe-diagnostics.py', 'pods', path], f.options);
}

test('diagnostics preserve known validator codes and public-source locations without raw messages', t => {
  const f = fixture(t);
  const result = scan(f, `NATIVE_LOCKS_REJECTED_GEM_PARSE\n${f.root.replaceAll('\\', '/')}/src/public-source.ts:1:7: error: has no member 'fieldValue' '${SECRET}'\n${SECRET}\n`);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes(SECRET), false);
  const report = JSON.parse(result.stdout); assert.ok(report.codes.includes('NATIVE_LOCKS_REJECTED_GEM_PARSE')); assert.ok(report.codes.includes('COMPILER_MEMBER_NOT_FOUND'));
  assert.deepEqual(report.sourceLocations, [{ path: 'src/public-source.ts', line: 1 }]);
  assert.equal(Object.hasOwn(report, 'message'), false);
});
test('unknown private text and outside-source paths yield only a fixed diagnostic', t => {
  const f = fixture(t); const result = scan(f, `${SECRET}\n/elsewhere/src/../../outside-private.ts:1: error text ${SECRET}\n`);
  assert.equal(result.status, 0); const report = JSON.parse(result.stdout); assert.equal(result.stdout.includes(SECRET), false); assert.deepEqual(report.sourceLocations, []);
  assert.ok(report.codes.every(code => code === 'COMPILER_ERROR_REPORTED' || code === 'NATIVE_FAILURE_DETAILS_WITHHELD'));
});
test('generated source names and quoted values cannot become diagnostics; locked package names remain useful', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'src/generated-secret.ts'), `export const fieldValue = '${SECRET}';`);
  const result = scan(f, `${f.root.replaceAll('\\', '/')}/src/generated-secret.ts:1:7: error: has no member '${SECRET}'\n${f.root.replaceAll('\\', '/')}/node_modules/react-native/unreviewed-private-${SECRET}.h:12: error: has no member '${SECRET}'\n`);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes(SECRET), false);
  const report = JSON.parse(result.stdout); assert.deepEqual(report.sourceLocations, [{ dependency: 'react-native', line: 12 }]);
});
test('artifact diagnostics and environment are structural allowlisted data, never raw runner logs', t => {
  const f = fixture(t);
  writeFileSync(join(f.privateRoot, 'steps/pods.json'), JSON.stringify({ step: 'pods', status: 'failed' }));
  writeFileSync(join(f.privateRoot, 'logs/pods.log'), `NATIVE_LOCKS_REJECTED_POD_SOURCES\n${SECRET}\n`);
  writeFileSync(join(f.privateRoot, 'logs/environment.log'), `ProductVersion:\t26.7.2\nBuildVersion:\t25G332\nXcode 26.6\nBuild version 17F113\nv24.22.1\n11.19.1\nruby 3.3.8 (synthetic fixture)\nBundler version 2.6.9\n${SECRET}\n`);
  const result = spawnSync(PYTHON, ['scripts/ci/collect-evidence.py'], f.options); assert.equal(result.status, 0, result.stdout + result.stderr);
  const diagnostics = readFileSync(join(f.root, 'artifacts/reports/diagnostics.json'), 'utf8'); const environment = readFileSync(join(f.root, 'artifacts/reports/environment.json'), 'utf8');
  assert.equal((diagnostics + environment).includes(SECRET), false); assert.match(diagnostics, /NATIVE_LOCKS_REJECTED_POD_SOURCES/);
  const value = JSON.parse(environment); assert.equal(value.observed, true); assert.equal(value.versions.ruby, '3.3.8'); assert.equal(value.versions.xcode, '26.6');
});
test('failed synthetic UI screenshot is retained with metadata removed', t => {
  const f = fixture(t); const result = spawnSync(PYTHON, ['-c', `import pathlib,os,struct,zlib\np=pathlib.Path(os.environ['RUNNER_TEMP'])/'native-private/screenshots/iphone'; p.mkdir(parents=True)\ndef chunk(k,b): return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)\nimage=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'tEXt',b'${SECRET}')+chunk(b'IDAT',zlib.compress(bytes([0,255,0,0,255])))+chunk(b'IEND',b'')\n(p/'failure.png').write_bytes(image)`], f.options);
  assert.equal(result.status, 0, result.stderr); const collected = spawnSync(PYTHON, ['scripts/ci/collect-evidence.py'], f.options); assert.equal(collected.status, 0, collected.stdout + collected.stderr);
  const image = readFileSync(join(f.root, 'artifacts/screenshots/iphone/failure.png')); assert.equal(image.includes(Buffer.from(SECRET)), false); assert.equal(image.includes(Buffer.from('tEXt')), false);
});
