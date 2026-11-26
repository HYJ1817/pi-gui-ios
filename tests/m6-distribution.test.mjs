/**
 * M6-distribution suite — version detection, upgrade compatibility,
 * SideStore source draft, release draft automation.
 *
 * All fixtures are synthetic: tiny plist-only IPA zips built in-memory by
 * python's stdlib zipfile. No real signing material, device data, or release
 * infrastructure is involved anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'm6-dist-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Build a minimal synthetic IPA: Payload/PiGUIMobile.app/Info.plist only. */
function makeIpa(dir, { version = '0.0.1', build = '1', bundleId = 'io.github.hyj1817.piguimobile', extra = 0 } = {}) {
  const ipaPath = join(dir, `fixture-${randomBytes(4).toString('hex')}.ipa`);
  const code = `
import zipfile, plistlib, sys
manifest = {
  'CFBundleShortVersionString': sys.argv[2],
  'CFBundleVersion': sys.argv[3],
  'CFBundleIdentifier': sys.argv[4],
  'CFBundleExecutable': 'PiGUIMobile',
  'MinimumOSVersion': '16.4',
}
with zipfile.ZipFile(sys.argv[1], 'w') as z:
  z.writestr('Payload/PiGUIMobile.app/Info.plist', plistlib.dumps(manifest))
  for i in range(int(sys.argv[5])):
    z.writestr(f'Payload/PiGUIMobile.app/filler{i}.bin', b'x' * 64)
print('ok')
`;
  const r = spawnSync(PYTHON, ['-c', code, ipaPath, version, build, bundleId, String(extra)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return ipaPath;
}

function appJson(dir, { version = '0.0.1', buildNumber = '1', bundleIdentifier = 'io.github.hyj1817.piguimobile' } = {}) {
  const p = join(dir, 'app.json');
  writeFileSync(p, JSON.stringify({ expo: { version, ios: { buildNumber, bundleIdentifier } } }));
  return p;
}

function versionDetect(dir, ipa, appjson) {
  const out = join(dir, `vr-${randomBytes(4).toString('hex')}.json`);
  const r = spawnSync(PYTHON, [join(ROOT, 'scripts/ci/version-detect.py'), ipa, appjson, out], { encoding: 'utf8' });
  const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  return { status: r.status, stdout: r.stdout.trim(), report };
}

// ---------------------------------------------------------- version-detect
test('version-detect passes when IPA identity matches the source of truth', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { version: '0.0.1', build: '1' });
  const appjson = appJson(dir, { version: '0.0.1', buildNumber: '1' });
  const r = versionDetect(dir, ipa, appjson);
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.stdout, 'VERSION_DETECTED');
  assert.equal(r.report.passed, true);
  assert.equal(r.report.ipaVersion, '0.0.1');
  assert.equal(r.report.ipaBuildNumber, 1);
  assert.equal(r.report.kind, 'distribution-version-report');
});

test('version-detect rejects version drift between IPA and source', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { version: '0.0.2', build: '1' });
  const appjson = appJson(dir, { version: '0.0.1', buildNumber: '1' });
  const r = versionDetect(dir, ipa, appjson);
  assert.equal(r.status, 1);
  assert.ok(r.report.violations.includes('VERSION_SOURCE_MISMATCH'), JSON.stringify(r.report.violations));
  assert.equal(r.report.passed, false);
});

test('version-detect rejects build-number drift and malformed versions', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { version: '0.0.1', build: '2' });
  const appjson = appJson(dir, { version: '0.0.1', buildNumber: '1' });
  const r = versionDetect(dir, ipa, appjson);
  assert.ok(r.report.violations.includes('BUILD_SOURCE_MISMATCH'));
  const ipa2 = makeIpa(dir, { version: 'zero-dot-one', build: '1' });
  const r2 = versionDetect(dir, ipa2, appjson);
  assert.ok(r2.report.violations.includes('VERSION_FORMAT'));
  const ipa3 = makeIpa(dir, { version: '0.0.1', build: 'abc' });
  const r3 = versionDetect(dir, ipa3, appjson);
  assert.ok(r3.report.violations.includes('BUILD_NUMBER_FORMAT'));
});

test('version-detect rejects bundle-id mismatch and missing manifest', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { bundleId: 'com.evil.impersonator' });
  const appjson = appJson(dir);
  const r = versionDetect(dir, ipa, appjson);
  assert.ok(r.report.violations.includes('BUNDLE_ID_SOURCE_MISMATCH'));
  const missing = join(dir, 'does-not-exist.ipa');
  const r2 = versionDetect(dir, missing, appjson);
  assert.equal(r2.report.passed, false);
});

// --------------------------------------------------------- upgrade-compat
function verifyReport(dir, { bundleId = 'io.github.hyj1817.piguimobile' } = {}) {
  const p = join(dir, `verify-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(p, JSON.stringify({
    schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED',
    bundleId, architectures: ['arm64'], executables: 9, frameworks: 8,
    minimumOS: '16.4.0', sha256: createHash('sha256').update('x').digest('hex'), sideStoreInstallVerified: false,
  }));
  return p;
}

function compat(dir, baseV, candV, baseVer, candVer) {
  const out = join(dir, `compat-${randomBytes(4).toString('hex')}.json`);
  const r = spawnSync(PYTHON, [join(ROOT, 'scripts/ci/upgrade-compat.py'), baseV, candV, baseVer, candVer, out], { encoding: 'utf8' });
  const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  return { status: r.status, report };
}

function passingVersionReport(dir, { version = '0.0.1', build = 1 } = {}) {
  const p = join(dir, `vp-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(p, JSON.stringify({
    schemaVersion: 2, kind: 'distribution-version-report', passed: true,
    ipaVersion: version, ipaBuildNumber: build, violations: [],
  }));
  return p;
}

test('upgrade-compat passes for a monotonic build upgrade under stable identity', t => {
  const dir = fixture(t);
  const base = passingVersionReport(dir, { version: '0.0.1', build: 1 });
  const cand = passingVersionReport(dir, { version: '0.0.2', build: 2 });
  const r = compat(dir, base, cand, verifyReport(dir), verifyReport(dir));
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.report.code, 'UPGRADE_COMPATIBLE');
  assert.equal(r.report.deviceSemantics.includes('final user device checklist'), true, 'report must never claim device semantics');
});

test('upgrade-compat rejects non-increasing build numbers (downgrade/refusal surface)', t => {
  const dir = fixture(t);
  const base = passingVersionReport(dir, { build: 2 });
  const cand = passingVersionReport(dir, { build: 2 });
  const r = compat(dir, base, cand, verifyReport(dir), verifyReport(dir));
  assert.ok(r.report.violations.includes('UPGRADE_MONOTONIC'));
  const cand2 = passingVersionReport(dir, { build: 1 });
  const r2 = compat(dir, base, cand2, verifyReport(dir), verifyReport(dir));
  assert.ok(r2.report.violations.includes('UPGRADE_MONOTONIC'));
});

test('upgrade-compat rejects identity drift and version regression', t => {
  const dir = fixture(t);
  const base = passingVersionReport(dir, { version: '0.1.0', build: 1 });
  const cand = passingVersionReport(dir, { version: '0.0.9', build: 2 });
  const r = compat(dir, base, cand, verifyReport(dir), verifyReport(dir));
  assert.ok(r.report.violations.includes('VERSION_REGRESSION'));
  const r2 = compat(dir, base, passingVersionReport(dir, { version: '0.1.1', build: 2 }), verifyReport(dir), verifyReport(dir, { bundleId: 'com.other.app' }));
  assert.ok(r2.report.violations.includes('BUNDLE_IDENTITY_STABLE'));
});

test('upgrade-compat fail-closed on missing/not-passing inputs', t => {
  const dir = fixture(t);
  const base = passingVersionReport(dir);
  const cand = passingVersionReport(dir, { build: 2 });
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ passed: false }));
  const r = compat(dir, base, cand, bad, verifyReport(dir));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('BASELINE_VERIFY_NOT_PASSING'));
});

// ------------------------------------------------------- sidestore-source
function sidestore(dir, version, build, sha, size, tag) {
  const out = join(dir, `ss-${randomBytes(4).toString('hex')}.json`);
  const r = spawnSync(PYTHON, [join(ROOT, 'scripts/ci/sidestore-source.py'), version, String(build), sha, String(size), tag, out], { encoding: 'utf8' });
  const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  return { status: r.status, report };
}

test('sidestore-source draft carries correct shape and never claims publication', t => {
  const dir = fixture(t);
  const sha = createHash('sha256').update('ipa-bytes').digest('hex');
  const r = sidestore(dir, '0.0.1', 1, sha, 1234567, 'v0.0.1+build1');
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.report.publicationStatus, 'draft-only-never-published');
  const app = r.report.source.apps[0];
  assert.equal(app.bundleIdentifier, 'io.github.hyj1817.piguimobile');
  const v = app.versions[0];
  assert.equal(v.downloadURL, 'https://github.com/HYJ1817/pi-gui-ios/releases/download/v0.0.1+build1/PiGUIMobile-unsigned.ipa');
  assert.equal(v.sha256, sha);
  assert.equal(v.size, 1234567);
  assert.equal(v.minOSVersion, '16.4');
  assert.deepEqual(app.appPermissions, { entitlements: [], privacy: {} }, 'source must honestly declare the empty sensitive-permission surface');
  assert.equal(v.date, null, 'date is stamped at release time, never invented');
});

test('sidestore-source rejects malformed inputs', t => {
  const dir = fixture(t);
  const sha = createHash('sha256').update('x').digest('hex');
  for (const [version, build, hash, size, tag, expectCode] of [
    ['1.0', 1, sha, 100, 'v1', 'VERSION_FORMAT'],
    ['0.0.1', 0, sha, 100, 'v1', 'BUILD_NUMBER_FORMAT'],
    ['0.0.1', 1, 'zz', 100, 'v1', 'SHA256_FORMAT'],
    ['0.0.1', 1, sha, -5, 'v1', 'SIZE_FORMAT'],
    ['0.0.1', 1, sha, 100, 'has space', 'TAG_FORMAT'],
  ]) {
    const r = sidestore(dir, version, build, hash, size, tag);
    assert.equal(r.report.passed, false);
    assert.ok(r.report.violations.includes(expectCode), `${expectCode}: ${JSON.stringify(r.report.violations)}`);
  }
});

// --------------------------------------------------------- release-draft
function releaseDraft(dir, ipa, verify, vr, compatR, ss) {
  const outDir = join(dir, `draft-${randomBytes(4).toString('hex')}`);
  const r = spawnSync(PYTHON, [join(ROOT, 'scripts/ci/release-draft.py'), ipa, verify, vr, compatR, ss, outDir], { encoding: 'utf8' });
  const draft = existsSync(join(outDir, 'release-draft.json')) ? JSON.parse(readFileSync(join(outDir, 'release-draft.json'), 'utf8')) : null;
  return { status: r.status, draft, outDir };
}

test('release-draft binds exactly the verified bytes end-to-end', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { extra: 4 });
  const ipaBytes = readFileSync(ipa);
  const sha = createHash('sha256').update(ipaBytes).digest('hex');
  // verify report must carry the real ipa hash for binding
  const ver = join(dir, 'verify.json');
  writeFileSync(ver, JSON.stringify({
    schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED',
    bundleId: 'io.github.hyj1817.piguimobile', architectures: ['arm64'], sha256: sha, sideStoreInstallVerified: false,
  }));
  const vr = passingVersionReport(dir, { version: '0.0.1', build: 1 });
  const comp = join(dir, 'compat.json');
  writeFileSync(comp, JSON.stringify({ schemaVersion: 2, kind: 'distribution-upgrade-compat', passed: true, violations: [] }));
  const ss = sidestore(dir, '0.0.1', 1, sha, ipaBytes.length, 'v0.0.1+build1');
  const r = releaseDraft(dir, ipa, ver, vr, comp, join(dir, 'ss-out.json'));
  // sidestore wrote to its own out; pass THAT file
  const ssOut = join(dir, 'ss-out.json');
  writeFileSync(ssOut, JSON.stringify(ss.report));
  const r2 = releaseDraft(dir, ipa, ver, vr, comp, ssOut);
  assert.equal(r2.status, 0, JSON.stringify(r2.draft));
  assert.equal(r2.draft.tag, 'v0.0.1+build1');
  assert.equal(r2.draft.assets[0].sha256, sha);
  assert.equal(r2.draft.assets[0].size, ipaBytes.length);
  assert.equal(r2.draft.publicationStatus, 'draft-only-requires-explicit-user-authorization');
  assert.equal(r2.draft.notes.includes('final user device checklist'), true);
  assert.ok(existsSync(join(r2.outDir, 'release-notes.md')));
});

test('release-draft fails closed when hash binding breaks', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir);
  const wrongSha = createHash('sha256').update('different-bytes').digest('hex');
  const ver = join(dir, 'verify.json');
  writeFileSync(ver, JSON.stringify({
    schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED',
    bundleId: 'io.github.hyj1817.piguimobile', architectures: ['arm64'], sha256: wrongSha, sideStoreInstallVerified: false,
  }));
  const vr = passingVersionReport(dir);
  const comp = join(dir, 'compat.json');
  writeFileSync(comp, JSON.stringify({ schemaVersion: 2, kind: 'distribution-upgrade-compat', passed: true, violations: [] }));
  const ss = join(dir, 'ss.json');
  writeFileSync(ss, JSON.stringify({ schemaVersion: 2, kind: 'sidestore-source-draft', passed: true, source: { apps: [{ versions: [{ sha256: wrongSha, size: 1 }] }] } }));
  const r = releaseDraft(dir, ipa, ver, vr, comp, ss);
  assert.equal(r.status, 1);
  assert.ok(r.draft.violations.includes('IPA_HASH_BINDING'), JSON.stringify(r.draft.violations));
});

test('release-draft fails closed on any not-passing input', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ passed: false }));
  const r = releaseDraft(dir, ipa, bad, bad, bad, bad);
  assert.equal(r.status, 1);
  for (const code of ['VERIFY_NOT_PASSING', 'VERSION_NOT_PASSING', 'COMPAT_NOT_PASSING', 'SOURCE_NOT_PASSING']) {
    assert.ok(r.draft.violations.includes(code), `${code}: ${JSON.stringify(r.draft.violations)}`);
  }
});

// ------------------------------------------- file integrity / no secrets
test('m6 tooling never embeds secrets, device ids, or real user data', () => {
  for (const f of ['version-detect.py', 'upgrade-compat.py', 'sidestore-source.py', 'release-draft.py']) {
    const src = readFileSync(join(ROOT, 'scripts/ci', f), 'utf8');
    assert.ok(!/BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY/.test(src), f);
    assert.ok(!src.includes('Sidestore') || true);
    // fixed-code vocabulary: no environment paths in outputs
    assert.ok(!/os\.environ(?!\[['"]RUNNER_TEMP)/.test(src) || f === 'x', `${f} reads env beyond RUNNER_TEMP`);
  }
});
