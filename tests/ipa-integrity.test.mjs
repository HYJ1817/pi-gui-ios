import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);
const PYTHON = candidates.find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3, 11)'], { encoding: 'utf8' }).status === 0);
assert.ok(PYTHON, 'Python >= 3.11 is required; the security suite must not skip');
const executable = spawnSync(PYTHON, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim().replaceAll('\\', '/');
const VERIFY = join(ROOT, 'scripts/ci/verify-ipa.py');
const xml = value => {
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (typeof value === 'boolean') return `<${value}/>`;
  if (typeof value === 'number') return `<integer>${value}</integer>`;
  if (typeof value === 'string') return `<string>${escape(value)}</string>`;
  if (Array.isArray(value)) return `<array>${value.map(xml).join('')}</array>`;
  return `<dict>${Object.entries(value).map(([k, v]) => `<key>${escape(k)}</key>${xml(v)}`).join('')}</dict>`;
};
function writePlist(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `<?xml version="1.0"?><plist version="1.0">${xml(value)}</plist>`); }
function binary({ cpu = 0x100000c, subtype = 0, platform = 2, minimum = 0x0f0100, sdk = 0x1a0000, type = 2, signed = false, legacy = false, noBuild = false, environment = false } = {}) {
  const segment = Buffer.alloc(72); segment.writeUInt32LE(0x19); segment.writeUInt32LE(72, 4); segment.write('__TEXT', 8);
  segment.writeBigUInt64LE(4096n, 32); segment.writeUInt32LE(5, 56); segment.writeUInt32LE(5, 60);
  const build = Buffer.alloc(24); build.writeUInt32LE(legacy ? 0x25 : 0x32); build.writeUInt32LE(24, 4); build.writeUInt32LE(platform, 8); build.writeUInt32LE(minimum, 12); build.writeUInt32LE(sdk, 16);
  const commands = [segment]; if (!noBuild) commands.push(build);
  if (signed) { const command = Buffer.alloc(16); command.writeUInt32LE(0x1d); command.writeUInt32LE(16, 4); commands.push(command); }
  if (environment) { const command = Buffer.alloc(8); command.writeUInt32LE(0x27); command.writeUInt32LE(8, 4); commands.push(command); }
  const header = Buffer.alloc(32); [0xfeedfacf, cpu, subtype, type, commands.length, commands.reduce((n, c) => n + c.length, 0), 0, 0].forEach((n, i) => header.writeUInt32LE(n, i * 4));
  const length = 32 + commands.reduce((n, c) => n + c.length, 0) + (signed ? 16 : 0);
  segment.writeBigUInt64LE(BigInt(length), 48);
  if (signed) { const command = commands.find(c => c.readUInt32LE() === 0x1d); command.writeUInt32LE(length - 16, 8); command.writeUInt32LE(16, 12); }
  return Buffer.concat([header, ...commands, ...(signed ? [Buffer.from('SYNTHETIC-SIGNING')] : [])]);
}
function fat(data, count = 1) {
  const header = Buffer.alloc(64); header.writeUInt32BE(0xcafebabe); header.writeUInt32BE(count, 4); header.writeUInt32BE(0x100000c, 8); header.writeUInt32BE(64, 16); header.writeUInt32BE(data.length, 20); header.writeUInt32BE(6, 24);
  return Buffer.concat([header, data]);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ipa-synthetic-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'PiGUIMobile.app'); mkdirSync(app);
  const info = { CFBundleIdentifier: 'io.github.hyj1817.piguimobile', CFBundleExecutable: 'PiGUIMobile', CFBundleSupportedPlatforms: ['iPhoneOS'], UIDeviceFamily: [1, 2], MinimumOSVersion: '15.1', NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } };
  writePlist(join(app, 'Info.plist'), info); writeFileSync(join(app, 'PiGUIMobile'), binary());
  return { root, app, info, update() { writePlist(join(app, 'Info.plist'), info); } };
}
function verify(path) { const result = spawnSync(PYTHON, [VERIFY, path], { encoding: 'utf8' }); return { ...result, report: JSON.parse(result.stdout) }; }
function reject(path, code) { const result = verify(path); assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(result.report.passed, false); if (code) assert.equal(result.report.code, code); assert.equal(result.stdout.includes('SYNTHETIC-PRIVATE'), false); assert.equal(result.stderr, ''); }
function framework(f, opts = {}) {
  const dir = join(f.app, 'Frameworks', 'Synthetic.framework'); mkdirSync(dir, { recursive: true });
  writePlist(join(dir, 'Info.plist'), { CFBundleExecutable: 'Synthetic', CFBundleSupportedPlatforms: ['iPhoneOS'], MinimumOSVersion: '13.0' });
  writeFileSync(join(dir, 'Synthetic'), binary({ type: 6, minimum: 0x0d0000, ...opts })); return dir;
}
function archive(f, variant = '') {
  const target = join(f.root, 'fixture.ipa');
  const code = `import pathlib,sys,zipfile,stat\napp=pathlib.Path(sys.argv[1]); variant=sys.argv[3]\nwith zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:\n for p in sorted(app.rglob('*')):\n  if p.is_file(): z.write(p, 'Payload/PiGUIMobile.app/'+p.relative_to(app).as_posix())\n if variant == 'traversal': z.writestr('Payload/PiGUIMobile.app/../SYNTHETIC-PRIVATE', b'x')\n if variant == 'duplicate': z.writestr('Payload/PiGUIMobile.app/Info.plist', b'x')\n if variant == 'outside': z.writestr('SYNTHETIC-PRIVATE.txt', b'x')\n if variant == 'link':\n  e=zipfile.ZipInfo('Payload/PiGUIMobile.app/link'); e.create_system=3; e.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(e, '../../SYNTHETIC-PRIVATE')\n if variant == 'empty-framework': z.writestr('Payload/PiGUIMobile.app/Frameworks/Empty.framework/', b'')\n`;
  const result = spawnSync(PYTHON, ['-c', code, f.app, target, variant], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return target;
}
function fakeRepo(f) {
  mkdirSync(join(f.root, 'scripts'), { recursive: true }); cpSync(join(ROOT, 'scripts/ci'), join(f.root, 'scripts/ci'), { recursive: true });
  mkdirSync(join(f.root, 'runner-temp'));
  return { cwd: f.root, env: { ...process.env, PYTHON: executable, RUNNER_TEMP: join(f.root, 'runner-temp').replaceAll('\\', '/') }, encoding: 'utf8' };
}
function pack(f, options) { return spawnSync('bash', ['scripts/ci/package-ipa.sh', f.app.replaceAll('\\', '/')], options); }

test('valid directory and final IPA are inspected without lipo/codesign mocks', t => {
  const f = fixture(t); framework(f); assert.equal(verify(f.app).report.executables, 2);
  const result = verify(archive(f)); assert.equal(result.status, 0, result.stdout); assert.equal(result.report.kind, 'unsigned-device-archive'); assert.equal(result.report.sideStoreInstallVerified, false);
});
test('a genuine one-slice FAT arm64 header is parsed', t => { const f = fixture(t); writeFileSync(join(f.app, 'PiGUIMobile'), fat(binary())); assert.equal(verify(archive(f)).status, 0); });
for (const [name, options, code] of [
  ['arm64 simulator', { platform: 7 }, 'MACHO_NOT_IOS_DEVICE'], ['macOS', { platform: 1 }, 'MACHO_NOT_IOS_DEVICE'],
  ['x86_64', { cpu: 0x1000007 }, 'MACHO_ARCHITECTURES'], ['arm64e', { subtype: 2 }, 'MACHO_ARCHITECTURES'],
  ['signed', { signed: true }, 'MACHO_SIGNED'], ['zero minimum', { minimum: 0 }, 'MACHO_VERSION_INVALID'],
  ['newer minimum', { minimum: 0x1a0000 }, 'BUNDLE_MINIMUM_OS'], ['SDK older than deployment', { sdk: 0x0d0000 }, 'MACHO_SDK_VERSION'],
  ['legacy platform', { legacy: true }, 'MACHO_LEGACY_PLATFORM'], ['missing build command', { noBuild: true }, 'MACHO_BUILD_VERSION'],
  ['dyld environment', { environment: true }, 'MACHO_DYLD_ENVIRONMENT'], ['object file', { type: 1 }, 'MACHO_FILETYPE'],
]) test(`reject ${name} in actual final IPA bytes`, t => { const f = fixture(t); writeFileSync(join(f.app, 'PiGUIMobile'), binary(options)); reject(archive(f), code); });
test('reject FAT with additional architectures', t => { const f = fixture(t); writeFileSync(join(f.app, 'PiGUIMobile'), fat(binary(), 2)); reject(archive(f), 'MACHO_ARCHITECTURES'); });
test('reject malformed load command bounds', t => { const f = fixture(t); const data = binary(); data.writeUInt32LE(0xfffffff8, 36); writeFileSync(join(f.app, 'PiGUIMobile'), data); reject(archive(f), 'MACHO_COMMAND_BOUNDS'); });
test('reject corrupt segment bounds', t => { const f = fixture(t); const data = binary(); data.writeBigUInt64LE(999999n, 80); writeFileSync(join(f.app, 'PiGUIMobile'), data); reject(archive(f), 'MACHO_SEGMENT_BOUNDS'); });
test('reject unsigned-looking bundle with signed nested framework', t => { const f = fixture(t); framework(f, { signed: true }); reject(archive(f), 'MACHO_SIGNED'); });
test('reject simulator nested framework', t => { const f = fixture(t); framework(f, { platform: 7 }); reject(archive(f), 'MACHO_NOT_IOS_DEVICE'); });
test('reject extra architecture in nested framework', t => { const f = fixture(t); const dir = framework(f); writeFileSync(join(dir, 'Synthetic'), fat(binary({ type: 6 }), 2)); reject(archive(f), 'MACHO_ARCHITECTURES'); });
test('inspect unreferenced Mach-O executables as well', t => { const f = fixture(t); writeFileSync(join(f.app, 'hidden-plugin'), binary({ platform: 7 })); reject(archive(f), 'MACHO_NOT_IOS_DEVICE'); });
test('reject framework missing declared binary', t => { const f = fixture(t); rmSync(join(framework(f), 'Synthetic')); reject(archive(f), 'BUNDLE_EXECUTABLE_MISSING'); });
test('reject completely empty framework directory', t => { const f = fixture(t); mkdirSync(join(f.app, 'Empty.framework')); reject(f.app, 'FRAMEWORK_EXECUTABLE_MISSING'); reject(archive(f, 'empty-framework'), 'FRAMEWORK_EXECUTABLE_MISSING'); });
for (const [key, value, code] of [
  ['NSCameraUsageDescription', 'SYNTHETIC-PRIVATE', 'PLIST_SENSITIVE_KEY'], ['NSFutureSensitiveUsageDescription', 'x', 'PLIST_SENSITIVE_KEY'],
  ['NSBonjourServices', ['_example._tcp'], 'PLIST_SENSITIVE_KEY'], ['NSLocalNetworkUsageDescription', 'x', 'PLIST_SENSITIVE_KEY'],
  ['NFCReaderUsageDescription', 'x', 'PLIST_SENSITIVE_KEY'], ['LSFutureSensitivePolicy', true, 'PLIST_SENSITIVE_KEY'],
  ['UIBackgroundModes', ['audio'], 'PLIST_SENSITIVE_KEY'], ['UIFileSharingEnabled', true, 'PLIST_SENSITIVE_KEY'],
  ['com.apple.developer.future-entitlement', true, 'PLIST_SENSITIVE_KEY'], ['get-task-allow', true, 'PLIST_SENSITIVE_KEY'],
  ['LSApplicationQueriesSchemes', ['secret'], 'PLIST_SENSITIVE_KEY'], ['CFBundleURLTypes', [{ CFBundleURLSchemes: ['unexpected'] }], 'PLIST_URL_SCHEME'],
]) test(`deny sensitive/unknown plist field ${key}`, t => { const f = fixture(t); f.info[key] = value; f.update(); reject(archive(f), code); });
for (const ats of [{ NSAllowsArbitraryLoads: true }, { NSAllowsLocalNetworking: true }, { NSAllowsArbitraryLoadsInWebContent: true }, { NSFutureRelaxation: true }, { NSExceptionDomains: { 'example.invalid': { NSIncludesSubdomains: true } } }, { NSAllowsArbitraryLoads: 0 }]) {
  test(`deny ATS ${JSON.stringify(ats)}`, t => { const f = fixture(t); f.info.NSAppTransportSecurity = ats; f.update(); reject(archive(f), 'ATS_POLICY'); });
}
for (const minimum of ['bad', '0.0', '999.0', '15.999', false]) test(`deny invalid minimumOS ${minimum}`, t => { const f = fixture(t); f.info.MinimumOSVersion = minimum; f.update(); reject(archive(f), 'MINIMUM_OS_INVALID'); });
for (const name of ['embedded.mobileprovision', 'private.p12', 'arbitrary.entitlements', 'archived-expanded-entitlements.xcent', 'future-entitlements.plist', 'ResourceRules.plist', 'ExportOptions.plist', '_CodeSignature/CodeResources']) test(`deny signing material ${name}`, t => {
  const f = fixture(t); const path = join(f.app, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'SYNTHETIC-PRIVATE'); reject(archive(f), 'SIGNING_MATERIAL');
});
for (const [variant, code] of [['traversal', 'ARCHIVE_PATH'], ['duplicate', 'ARCHIVE_DUPLICATE'], ['outside', 'ARCHIVE_LAYOUT'], ['link', 'ARCHIVE_SPECIAL_FILE']]) test(`reject ZIP ${variant}`, t => { const f = fixture(t); reject(archive(f, variant), code); });
test('malformed archive returns fixed diagnostic without private path', t => { const f = fixture(t); const path = join(f.root, 'SYNTHETIC-PRIVATE.ipa'); writeFileSync(path, 'not a zip'); reject(path, 'IPA_INSPECTION_ERROR'); });
test('package succeeds, then a failed signed build removes stale IPA and all staging', t => {
  const f = fixture(t); framework(f); const options = fakeRepo(f);
  const first = pack(f, options); assert.equal(first.status, 0, first.stdout + first.stderr);
  const out = join(f.root, 'artifacts/ipa'); assert.deepEqual(readdirSync(out).sort(), ['PiGUIMobile-unsigned.ipa', 'SHA256SUMS', 'verification.json']);
  assert.equal(verify(join(out, 'PiGUIMobile-unsigned.ipa')).status, 0); assert.deepEqual(readdirSync(join(f.root, 'runner-temp')), []);
  writeFileSync(join(f.app, 'embedded.mobileprovision'), 'SYNTHETIC-PRIVATE');
  const second = pack(f, options); assert.notEqual(second.status, 0); assert.deepEqual(readdirSync(out), []); assert.deepEqual(readdirSync(join(f.root, 'runner-temp')), []);
  assert.equal(readFileSync(join(f.app, 'embedded.mobileprovision'), 'utf8'), 'SYNTHETIC-PRIVATE');
});
test('publication failure after first final copy leaves no final IPA or Payload', t => {
  const f = fixture(t); const options = fakeRepo(f); const script = join(f.root, 'scripts/ci/stage-ipa.py');
  const original = readFileSync(script, 'utf8'); writeFileSync(script, original.replace('shutil.copyfile(work / name, output / name)', "shutil.copyfile(work / name, output / name)\n        raise RuntimeError('SYNTHETIC-PRIVATE')"));
  const result = pack(f, options); assert.notEqual(result.status, 0); assert.deepEqual(readdirSync(join(f.root, 'artifacts/ipa')), []); assert.deepEqual(readdirSync(join(f.root, 'runner-temp')), []);
  assert.equal((result.stdout + result.stderr).includes('SYNTHETIC-PRIVATE'), false);
});
test('signature removal failure is closed and never publishes source framework material', t => {
  const f = fixture(t); framework(f, { signed: true }); const options = fakeRepo(f);
  // On macOS, use an intentionally invalid synthetic signature. Else normalization
  // explicitly refuses to claim that codesign ran on another platform.
  const result = pack(f, options); assert.notEqual(result.status, 0); assert.deepEqual(readdirSync(join(f.root, 'artifacts/ipa')), []); assert.deepEqual(readdirSync(join(f.root, 'runner-temp')), []);
});
test('explicit own URL schemes and closed ATS are allowed', t => {
  const f = fixture(t); f.info.CFBundleURLTypes = [{ CFBundleURLSchemes: ['piguimobile', f.info.CFBundleIdentifier] }]; f.info.NSAppTransportSecurity = { NSAllowsLocalNetworking: false, NSExceptionDomains: {} }; f.update(); assert.equal(verify(archive(f)).status, 0);
});
test('invalid or simulator SDK metadata cannot masquerade as iphoneos', t => {
  const f = fixture(t); f.info.DTSDKName = 'iphoneossimulator26.0'; f.update(); reject(archive(f), 'BUNDLE_PLATFORM');
});
test('case-insensitive duplicate ZIP entries fail closed', t => {
  const f = fixture(t); writeFileSync(join(f.app, 'RESOURCE.txt'), 'one'); writeFileSync(join(f.app, 'resource.TXT'), 'two');
  // Windows cannot create both files on disk; insert both names directly into ZIP.
  const target = archive(f); const result = spawnSync(PYTHON, ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'a'); z.writestr('Payload/PiGUIMobile.app/ReSoUrCe.TxT',b'three'); z.close()", target], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); reject(target, 'ARCHIVE_DUPLICATE');
});
test('workflow upload paths form an exact file whitelist and exclude raw logs/inventory', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  const paths = [...workflow.matchAll(/^            (artifacts\/[^\r\n]+)$/gm)].map(m => m[1]);
  const expected = ['artifacts/ipa/PiGUIMobile-unsigned.ipa', 'artifacts/ipa/verification.json', 'artifacts/ipa/SHA256SUMS', 'artifacts/reports/steps.json', 'artifacts/reports/diagnostics.json', 'artifacts/reports/environment.json', ...['iphone', 'ipad'].flatMap(device => ['native', 'dark', 'accessibility'].map(phase => `artifacts/reports/${device}-${phase}.xml`)), ...['iphone', 'ipad'].flatMap(device => ['01-native-glass.png', '02-interactions.png', '03-navigation.png', '04-keyboard-visible.png', '05-native-motion.png', '06-native-menu.png', 'dark/appearance.png', 'accessibility/reduce-transparency.png', 'accessibility/dynamic-type.png', 'final.png', 'failure.png'].map(shot => `artifacts/screenshots/${device}/${shot}`)), ...['Gemfile.lock', 'Podfile.lock', 'prebuilt-dependencies.json', 'review.json'].map(name => `artifacts/lock-candidates/${name}`)];
  assert.equal(paths.length, expected.length); assert.deepEqual([...paths].sort(), expected.sort()); assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every(p => !/[?*]/.test(p) && /\.(?:ipa|json|xml|png|lock)$|\/SHA256SUMS$/.test(p)));
  assert.ok(paths.every(p => !/Payload|log|simulators|entitlements|mobileprovision/.test(p)));
  assert.equal(/path: artifacts\//.test(workflow), false);
});
test('all CI shell scripts pass bash syntax checking', () => {
  for (const name of readdirSync(join(ROOT, 'scripts/ci')).filter(n => n.endsWith('.sh'))) {
    const result = spawnSync('bash', ['-n', join(ROOT, 'scripts/ci', name).replaceAll('\\', '/')], { encoding: 'utf8' }); assert.equal(result.status, 0, name + result.stderr);
  }
});
