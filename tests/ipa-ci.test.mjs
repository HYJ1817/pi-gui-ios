import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required; no skipped security tests');
const executable = spawnSync(PYTHON, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim().replaceAll('\\', '/');
const marker = 'SYNTHETIC-PRIVATE-DO-NOT-UPLOAD';
const policy = { schemaVersion: 1, mode: 'bootstrap-required', ruby: '3.3.8', bundler: '2.6.9', cocoapods: '1.16.2' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ipa-ci-synthetic-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); cpSync(join(ROOT, 'scripts/ci'), join(root, 'scripts/ci'), { recursive: true });
  for (const dir of ['runner-temp', 'private', 'native', 'ios/Pods', 'node_modules']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'native/dependency-policy.json'), JSON.stringify(policy));
  writeFileSync(join(root, 'Gemfile'), readFileSync(join(ROOT, 'Gemfile')));
  writeFileSync(join(root, 'package-lock.json'), '{"fixture":true}');
  writeFileSync(join(root, 'ios/Podfile'), '# synthetic offline fixture only\n');
  const env = { ...process.env, PYTHON: executable, RUNNER_TEMP: join(root, 'runner-temp').replaceAll('\\', '/'), PYTHONDONTWRITEBYTECODE: '1' };
  return { root, env, options: { cwd: root, env, encoding: 'utf8' } };
}
function py(f, code, ...args) { return spawnSync(PYTHON, ['-c', code, ...args], f.options); }
function gate(f, mode = 'prepare') { return spawnSync(PYTHON, ['scripts/ci/native-dependencies.py', mode, f.root, join(f.root, 'private')], f.options); }
function moduleCode(name, body) { return `import importlib.util,pathlib,json,hashlib\ns=importlib.util.spec_from_file_location('fixture_module', pathlib.Path('scripts/ci/${name}')); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nroot=pathlib.Path.cwd()\n${body}`; }
function collect(f) { return spawnSync(PYTHON, ['scripts/ci/collect-evidence.py'], f.options); }

test('bootstrap is explicit and never synthesizes committed native locks', t => {
  const f = fixture(t); const result = gate(f); assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /BOOTSTRAP_REQUIRED/);
  assert.equal(existsSync(join(f.root, 'Gemfile.lock')), false); assert.equal(existsSync(join(f.root, 'ios/Podfile.lock')), false);
  const actual = JSON.parse(readFileSync(join(ROOT, 'native/dependency-policy.json')));
  if (actual.mode === 'bootstrap-required') {
    assert.equal(existsSync(join(ROOT, 'Gemfile.lock')), false, 'Bootstrap must not invent resolved locks');
    assert.equal(existsSync(join(ROOT, 'native/Podfile.lock')), false);
  } else {
    assert.equal(actual.mode, 'locked');
    assert.equal(JSON.parse(readFileSync(join(ROOT, 'native/lock-review.json'))).approved, true);
    for (const name of ['Gemfile.lock', 'native/Podfile.lock', 'native/prebuilt-dependencies.json']) assert.ok(existsSync(join(ROOT, name)));
  }
});
test('a partly committed bootstrap lock set fails closed', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'native/Podfile.lock'), 'fixture'); const result = gate(f); assert.equal(result.status, 1); assert.equal(result.stdout.trim(), 'NATIVE_DEPENDENCIES_REJECTED');
});
test('locked mode without reviewed hashes cannot install', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'native/dependency-policy.json'), JSON.stringify({ ...policy, mode: 'locked' })); assert.equal(gate(f).status, 1);
});
for (const field of ['bundler', 'cocoapods', 'ruby']) test(`reject unpinned ${field}`, t => {
  const f = fixture(t); writeFileSync(join(f.root, 'native/dependency-policy.json'), JSON.stringify({ ...policy, [field]: 'latest' })); assert.equal(gate(f).status, 1);
});
test('byte inventory detects changed, added, removed archives and native binaries', t => {
  const f = fixture(t);
  const result = py(f, moduleCode('native-dependencies.py', `
pods=root/'ios/Pods'; npm=root/'node_modules'; native=root/'native'; candidate=root/'private'
archive=pods/'hermes-release.tar.gz'; archive.write_bytes(b'synthetic archive bytes')
framework=pods/'Hermes.xcframework'/'ios-arm64'/'Hermes.framework'; framework.mkdir(parents=True)
binary=framework/'Hermes'; binary.write_bytes(b'\\xcf\\xfa\\xed\\xfe' + b'synthetic native bytes')
(candidate/'Gemfile.lock').write_text('synthetic gem lock')
(candidate/'Podfile.lock').write_text('synthetic pod lock')
manifest=m.inventory(root)
assert len(manifest['files']) == 2
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\\n')
(native/'prebuilt-dependencies.json').write_text((candidate/'prebuilt-dependencies.json').read_text())
review={'schemaVersion':1,'approved':True,'hashes':m.hashes(root,candidate)}
(native/'lock-review.json').write_text(json.dumps(review))
m.verify_locked(root,candidate,manifest)
for operation in ('change','add','remove'):
 archive.write_bytes(b'changed bytes' if operation == 'change' else b'synthetic archive bytes')
 extra=pods/'extra.a'
 if operation == 'add': extra.write_bytes(b'extra synthetic archive')
 if operation == 'remove':
  extra.unlink(); archive.unlink()
 changed=m.inventory(root)
 assert changed != manifest
 (candidate/'prebuilt-dependencies.json').write_text(json.dumps(changed,sort_keys=True,indent=2)+'\\n')
 try: m.verify_locked(root,candidate,changed)
 except m.GateError: pass
 else: raise AssertionError('unreviewed bytes accepted')
print('THREE_MUTATIONS_REJECTED')`));
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /THREE_MUTATIONS_REJECTED/);
});
test('source/Podfile/lock drift invalidates a previously reviewed native set', t => {
  const f = fixture(t); const result = py(f, moduleCode('native-dependencies.py', `
native=root/'native'; candidate=root/'private'
for name in ('Gemfile.lock','Podfile.lock'): (candidate/name).write_text('synthetic lock')
manifest=m.inventory(root)
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(manifest))
(native/'prebuilt-dependencies.json').write_text(json.dumps(manifest))
(native/'lock-review.json').write_text(json.dumps({'schemaVersion':1,'approved':True,'hashes':m.hashes(root,candidate)}))
for path in (root/'Gemfile',root/'package-lock.json',root/'ios/Podfile',candidate/'Gemfile.lock',candidate/'Podfile.lock'):
 original=path.read_bytes(); path.write_bytes(original+b'changed')
 try: m.verify_locked(root,candidate,manifest)
 except m.GateError: pass
 else: raise AssertionError('drift accepted')
 path.write_bytes(original)
print('FIVE_DRIFTS_REJECTED')`));
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /FIVE_DRIFTS_REJECTED/);
});
test('pod install failure survives a successful tee and cleans all private material', t => {
  const f = fixture(t); const bin = join(f.root, 'bin'); mkdirSync(bin);
  const stub = join(bin, 'bundle'); writeFileSync(stub, `#!/usr/bin/env bash\nif [[ "$2" == install ]]; then exit 0; fi\nif [[ "$4" == --version ]]; then printf '1.16.2\\n'; exit 0; fi\nprintf '%s\\n' '${marker}'\nexit 23\n`); chmodSync(stub, 0o755);
  const env = { ...f.env, PATH: bin + delimiter + process.env.PATH };
  const result = spawnSync('bash', ['scripts/ci/install-pods.sh'], { ...f.options, env });
  assert.equal(result.status, 23, result.stdout + result.stderr); assert.equal((result.stdout + result.stderr).includes(marker), false);
  assert.deepEqual(readdirSync(join(f.root, 'runner-temp')), []); assert.equal(existsSync(join(f.root, 'artifacts/lock-candidates')), false);
});
test('step wrapper exposes only fixed step and status, keeping command details private', t => {
  const f = fixture(t); const result = spawnSync('bash', ['scripts/ci/run-step.sh', 'device-build', 'bash', '-c', `printf '%s' '${marker}'; exit 7`], f.options);
  assert.equal(result.status, 7, result.stdout + result.stderr); assert.equal(result.stdout.trim(), 'NATIVE_STEP_device-build_failed'); assert.equal(result.stderr, '');
  assert.equal(readFileSync(join(f.root, 'runner-temp/native-private/logs/device-build.log'), 'utf8'), marker);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'runner-temp/native-private/steps/device-build.json'))), { step: 'device-build', status: 'failed' });
});
test('collector preserves JUnit failures but strips test strings, stdout, PNG metadata, logs and inventory', t => {
  const f = fixture(t); const result = py(f, `import pathlib,os,struct,zlib\np=pathlib.Path(os.environ['RUNNER_TEMP'])/'native-private'; (p/'ui/iphone').mkdir(parents=True); (p/'screenshots/iphone').mkdir(parents=True); (p/'logs').mkdir()\nmarker=${JSON.stringify(marker)}\n(p/'logs/build.log').write_text(marker); (p/'simulators.json').write_text(marker)\n(p/'ui/iphone/native.xml').write_text('<testsuite tests="2" failures="1"><testcase name="'+marker+'"><failure message="'+marker+'">'+marker+'</failure><system-out>'+marker+'</system-out></testcase><testcase name="pass"/></testsuite>')\ndef chunk(k,b): return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)\npng=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'tEXt',marker.encode())+chunk(b'IDAT',zlib.compress(bytes([0,255,0,0,255])))+chunk(b'IEND',b'')\n(p/'screenshots/iphone/01-native-glass.png').write_bytes(png); (p/'screenshots/iphone/unapproved.png').write_bytes(png)\n`);
  assert.equal(result.status, 0, result.stderr); const collected = collect(f); assert.equal(collected.status, 0, collected.stdout + collected.stderr);
  const publicRoot = join(f.root, 'artifacts'); const xml = readFileSync(join(publicRoot, 'reports/iphone-native.xml'), 'utf8'); assert.match(xml, /tests="2" failures="1"/); assert.match(xml, /MAESTRO_ASSERTION_FAILED/); assert.equal(xml.includes(marker), false);
  const png = readFileSync(join(publicRoot, 'screenshots/iphone/01-native-glass.png')); assert.equal(png.includes(Buffer.from(marker)), false); assert.equal(png.includes(Buffer.from('tEXt')), false);
  assert.equal(existsSync(join(publicRoot, 'screenshots/iphone/unapproved.png')), false); assert.deepEqual(readdirSync(publicRoot).sort(), ['reports', 'screenshots']);
});
for (const xml of ['<!DOCTYPE a [<!ENTITY b SYSTEM "file:///SYNTHETIC-PRIVATE">]><testsuite/>', '<testsuite failures="1"><testcase name="x"/></testsuite>', '<testsuites errors="1"><testsuite><testcase name="x"/></testsuite></testsuites>', '<testsuite tests="2"><testcase name="missing"/></testsuite>', '<broken>']) test('unsafe/unrepresented JUnit is rejected', t => {
  const f = fixture(t); const dir = join(f.root, 'runner-temp/native-private/ui/iphone'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'native.xml'), xml);
  const result = collect(f); assert.equal(result.status, 1); assert.equal(result.stdout.trim(), 'SYNTHETIC_EVIDENCE_REJECTED'); assert.equal(existsSync(join(f.root, 'artifacts/reports/iphone-native.xml')), false);
});
test('malformed screenshot never enters publish scope', t => {
  const f = fixture(t); const dir = join(f.root, 'runner-temp/native-private/screenshots/iphone'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, '01-native-glass.png'), marker);
  assert.equal(collect(f).status, 1); assert.equal(existsSync(join(f.root, 'artifacts/screenshots/iphone/01-native-glass.png')), false);
});
test('unknown diagnostic step/status content cannot become a public report', t => {
  const f = fixture(t); const dir = join(f.root, 'runner-temp/native-private/steps'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'pods.json'), JSON.stringify({ step: 'pods', status: marker }));
  assert.equal(collect(f).status, 1); assert.equal(existsSync(join(f.root, 'artifacts/reports/steps.json')), false);
});
test('interrupted step is distinguished from never started, using fixed public codes', t => {
  const f = fixture(t); const dir = join(f.root, 'runner-temp/native-private/steps'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'iphone.json'), JSON.stringify({ step: 'iphone', status: 'running' }));
  assert.equal(collect(f).status, 0); const report = JSON.parse(readFileSync(join(f.root, 'artifacts/reports/steps.json')));
  assert.deepEqual(report.steps.find(s => s.step === 'iphone'), { step: 'iphone', status: 'interrupted', code: 'NATIVE_STEP_IPHONE_INTERRUPTED' }); assert.equal(report.steps.find(s => s.step === 'ipad').status, 'not-run');
});
test('uploads require explicit verification/sanitization/bootstrap outcomes', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  assert.match(workflow, /if: success\(\) && steps\.ipa\.outputs\.result == 'passed'/);
  assert.match(workflow, /if: always\(\) && steps\.evidence\.outcome == 'success'/);
  assert.match(workflow, /if: always\(\) && steps\.pods\.outputs\.result == 'bootstrap-required'/);
  assert.equal(/continue-on-error/.test(workflow), false);
});
test('native cache has fixed action SHA, exact reviewed key and no loose restore keys or build products', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  const actions = [...workflow.matchAll(/uses: actions\/cache\/(restore|save)@([a-f0-9]{40})/g)]; assert.equal(actions.length, 2); assert.equal(actions[0][2], actions[1][2]);
  assert.equal(/restore-keys/.test(workflow), false); assert.match(workflow, /if: hashFiles\('native\/lock-review.json'\) != ''/);
  const keys = workflow.split('\n').filter(l => l.trim().startsWith('key: native-v1')); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  for (const name of ['Gemfile.lock', 'package-lock.json', 'native/Podfile.lock', 'native/prebuilt-dependencies.json', 'native/lock-review.json']) assert.ok(keys[0].includes(name));
  assert.match(workflow, /if: steps\.pods\.outputs\.result == 'passed'/);
  const cached = workflow.split('\n').filter(l => /^            (?:~\/|ios\/Pods\/)/.test(l)); assert.equal(cached.length, 12); assert.ok(cached.every(l => !/Payload|build\/|DerivedData|native-private|\.mobileprovision|ipa/.test(l)));
});
test('all Python security scripts compile without writing pycache', () => {
  const result = spawnSync(PYTHON, ['-c', "import pathlib; [compile(p.read_bytes(), str(p), 'exec') for p in pathlib.Path('scripts/ci').glob('*.py')]"], { cwd: ROOT, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
});
