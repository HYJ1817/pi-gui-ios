/**
 * M6-distribution suite (hardened round) — version detection, upgrade
 * compatibility, SideStore source draft, release draft automation.
 *
 * Negative cases mirror the independent-review reproductions FSEC-001..004
 * and the functional-review important findings: bounded parsing, sanitized
 * failures, strict schemas, chain binding, canonical tag grammar. Synthetic
 * fixtures only — no real signing material, device data, or release infra.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
const sha = data => createHash('sha256').update(data).digest('hex');
const rid = () => randomBytes(4).toString('hex');

function makeIpa(dir, { version = '0.0.1', build = '1', bundleId = 'io.github.hyj1817.piguimobile', plistRoot = 'dict', inflate = 0 } = {}) {
  const ipaPath = join(dir, `fixture-${rid()}.ipa`);
  const code = `
import zipfile, plistlib, sys
if sys.argv[5] == 'dict':
    manifest = {
      'CFBundleShortVersionString': sys.argv[2],
      'CFBundleVersion': sys.argv[3],
      'CFBundleIdentifier': sys.argv[4],
      'CFBundleExecutable': 'PiGUIMobile',
      'MinimumOSVersion': '16.4',
    }
else:
    manifest = ['not', 'a', 'dict']
raw = plistlib.dumps(manifest)
pad = int(sys.argv[6])
if pad:
    # inflate the manifest entry: large compressible padding inside the plist
    # is impossible post-serialization, so pad via an inflated duplicate-name
    # decoy trick is wrong — instead append whitespace padding plistlib accepts?
    # plistlib does not accept trailing padding; emulate a large entry by
    # storing raw inside a zip with a huge extra comment field is invalid too.
    # Honest approach: write the real manifest plus a filler sibling entry.
    pass
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('Payload/PiGUIMobile.app/Info.plist', raw)
    if pad:
        z.writestr('Payload/PiGUIMobile.app/filler.bin', b'A' * pad)
print('ok')
`;
  const r = spawnSync(PYTHON, ['-c', code, ipaPath, version, build, bundleId, plistRoot, String(inflate)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return ipaPath;
}

function makeBombIpa(dir) {
  // High-ratio manifest: a plist-valid comment-free document cannot compress
  // extremely, so craft directly: zip entry whose compressed stream is tiny
  // but whose declared uncompressed size is huge. Python zipfile won't write
  // that — construct it manually for a genuine ratio test.
  const ipaPath = join(dir, `bomb-${rid()}.ipa`);
  const code = `
import zipfile, sys
# A manifest that is valid plist xml of repeated spaces inside a dict value —
# highly compressible, plist-valid after inflate: use a large string value.
import plistlib
big = {'CFBundleShortVersionString': '0.0.1', 'CFBundleVersion': '1',
       'CFBundleIdentifier': 'io.github.hyj1817.piguimobile', 'Pad': ' ' * 200000}
raw = plistlib.dumps(big)
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr('Payload/PiGUIMobile.app/Info.plist', raw)
print('ratio-test-size', len(raw))
`;
  const r = spawnSync(PYTHON, ['-c', code, ipaPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return ipaPath;
}

function appJson(dir, { version = '0.0.1', buildNumber = '1', bundleIdentifier = 'io.github.hyj1817.piguimobile' } = {}) {
  const p = join(dir, 'app.json');
  writeFileSync(p, JSON.stringify({ expo: { version, ios: { buildNumber, bundleIdentifier } } }));
  return p;
}

function run(script, args) {
  return spawnSync(PYTHON, [join(ROOT, 'scripts/ci', script), ...args], { encoding: 'utf8' });
}
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

// ---------------------------------------------------------- version-detect
function versionDetect(dir, ipa, appjson) {
  const out = join(dir, `vr-${rid()}.json`);
  const r = run('version-detect.py', [ipa, appjson, out]);
  const report = existsSync(out) ? readJson(out) : null;
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr, report };
}

test('version-detect passes with correct identity and carries ipaSha256 binding', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir);
  const r = versionDetect(dir, ipa, appJson(dir));
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.report.passed, true);
  assert.equal(r.report.ipaSha256, sha(readFileSync(ipa)), 'report must bind the inspected bytes');
  assert.equal(r.report.ipaVersion, '0.0.1');
  assert.equal(r.report.ipaBuildNumber, 1);
  assert.equal(r.report.bundleId, 'io.github.hyj1817.piguimobile');
});

test('FSEC-001: non-zip input produces a fixed-code report, never a traceback', t => {
  const dir = fixture(t);
  const notzip = join(dir, 'notzip.ipa');
  writeFileSync(notzip, 'this is not a zip archive at all');
  const r = versionDetect(dir, notzip, appJson(dir));
  assert.equal(r.status, 1);
  assert.ok(r.report, 'a report file must exist even for garbage input');
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('ARCHIVE_NOT_ZIP'), JSON.stringify(r.report.violations));
  assert.equal(r.stderr.includes('Traceback'), false, 'no raw traceback may reach stderr');
});

test('FSEC-001: plist array root and malformed plist produce fixed codes', t => {
  const dir = fixture(t);
  const arr = makeIpa(dir, { plistRoot: 'list' });
  const r = versionDetect(dir, arr, appJson(dir));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('MANIFEST_INVALID'), JSON.stringify(r.report.violations));
  assert.equal(r.stderr.includes('Traceback'), false);
  assert.equal(r.stderr.includes('AttributeError'), false);
});

test('FSEC-001: high-ratio manifest is rejected by metadata before inflation', t => {
  const dir = fixture(t);
  const bomb = makeBombIpa(dir);
  const r = versionDetect(dir, bomb, appJson(dir));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('MANIFEST_RATIO') || r.report.violations.includes('MANIFEST_SIZE'),
    `ratio/size bound must fire before decompression: ${JSON.stringify(r.report.violations)}`);
});

test('FSEC-001: unicode digits in build number are rejected, never coerced', t => {
  const dir = fixture(t);
  // Arabic-Indic digit 1 — Python str.isdigit() accepts it, int() parses it.
  const ipa = makeIpa(dir, { build: '١' });
  const r = versionDetect(dir, ipa, appJson(dir));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('BUILD_NUMBER_FORMAT'), JSON.stringify(r.report.violations));
});

test('FSEC-001: failure reports never echo input values or paths', t => {
  const dir = fixture(t);
  const ipa = makeIpa(dir, { version: 'zero.dot.one', build: '99999' });
  const r = versionDetect(dir, ipa, appJson(dir));
  const blob = JSON.stringify(r.report);
  assert.equal(blob.includes('zero.dot.one'), false, 'invalid input values must never be echoed');
  assert.equal(blob.includes(dir.replaceAll('\\', '/')), false, 'no filesystem paths in reports');
  assert.equal(r.report.sourceVersion, null, 'unvalidated source values stay out');
});

test('version-detect rejects version/build/bundle drift (regression)', t => {
  const dir = fixture(t);
  for (const [opts, app, code] of [
    [{ version: '0.0.2' }, {}, 'VERSION_SOURCE_MISMATCH'],
    [{ build: '2' }, {}, 'BUILD_SOURCE_MISMATCH'],
    [{ bundleId: 'com.evil.impersonator' }, {}, 'BUNDLE_ID_SOURCE_MISMATCH'],
  ]) {
    const r = versionDetect(dir, makeIpa(dir, opts), appJson(dir, app));
    assert.equal(r.report.passed, false);
    assert.ok(r.report.violations.includes(code), `${code}: ${JSON.stringify(r.report.violations)}`);
  }
});

// --------------------------------------------------------- upgrade-compat
function versionReport(dir, { version = '0.0.1', build = 1, ipaSha = null, complete = true } = {}) {
  const p = join(dir, `vp-${rid()}.json`);
  const base = {
    schemaVersion: 2, kind: 'distribution-version-report', passed: true,
    ipaVersion: version, ipaBuildNumber: build,
    ipaSha256: ipaSha ?? sha(`bytes-${version}-${build}`), violations: [],
  };
  writeFileSync(p, JSON.stringify(complete ? base : { passed: true, ipaBuildNumber: build }));
  return p;
}
function verifyReport(dir, { ipaSha = null, bundleId = 'io.github.hyj1817.piguimobile', complete = true } = {}) {
  const p = join(dir, `verify-${rid()}.json`);
  writeFileSync(p, JSON.stringify(complete ? {
    schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED',
    bundleId, architectures: ['arm64'], sha256: ipaSha ?? sha('ipa-bytes'),
  } : { passed: true, architectures: ['arm64'] }));
  return p;
}
function compat(dir, baseV, candV, baseVer, candVer) {
  const out = join(dir, `compat-${rid()}.json`);
  const r = run('upgrade-compat.py', [baseV, candV, baseVer, candVer, out]);
  const report = existsSync(out) ? readJson(out) : null;
  return { status: r.status, report };
}

test('upgrade-compat passes for a real monotonic upgrade with chain binding', t => {
  const dir = fixture(t);
  const baseSha = sha('ipa-v1-bytes');
  const candSha = sha('ipa-v2-bytes');
  const r = compat(dir,
    versionReport(dir, { version: '0.0.1', build: 1, ipaSha: baseSha }),
    versionReport(dir, { version: '0.0.2', build: 2, ipaSha: candSha }),
    verifyReport(dir, { ipaSha: baseSha }),
    verifyReport(dir, { ipaSha: candSha }));
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.report.bindings.candidateSha256, candSha, 'bindings record what was compared');
  assert.equal(r.report.deviceSemantics.includes('final user device checklist'), true);
});

test('FSEC-003/functional-1: incomplete reports are schema violations, never compatible', t => {
  const dir = fixture(t);
  const incompleteV = join(dir, 'loose-v.json');
  writeFileSync(incompleteV, JSON.stringify({ passed: true, ipaBuildNumber: 1 }));
  const incompleteV2 = join(dir, 'loose-v2.json');
  writeFileSync(incompleteV2, JSON.stringify({ passed: true, ipaBuildNumber: 2 }));
  const incompleteVer = join(dir, 'loose-ver.json');
  writeFileSync(incompleteVer, JSON.stringify({ passed: true, architectures: ['arm64'] }));
  const r = compat(dir, incompleteV, incompleteV2, incompleteVer, incompleteVer);
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.some(v => v.endsWith('_SCHEMA')), JSON.stringify(r.report.violations));
});

test('FSEC-003: boolean build numbers are rejected even though Python bool is int', t => {
  const dir = fixture(t);
  const boolV = join(dir, 'bool-v.json');
  writeFileSync(boolV, JSON.stringify({
    schemaVersion: 2, kind: 'distribution-version-report', passed: true,
    ipaVersion: '0.0.1', ipaBuildNumber: true, ipaSha256: sha('x'),
  }));
  const okV = versionReport(dir, { build: 2, ipaSha: sha('y') });
  const r = compat(dir, boolV, okV, verifyReport(dir), verifyReport(dir));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('BASELINE_VERSION_SCHEMA'), JSON.stringify(r.report.violations));
});

test('FSEC-002 chain binding: mismatched verify/version digests are rejected', t => {
  const dir = fixture(t);
  const r = compat(dir,
    versionReport(dir, { version: '0.0.1', build: 1, ipaSha: sha('a1') }),
    versionReport(dir, { version: '0.0.2', build: 2, ipaSha: sha('a2') }),
    verifyReport(dir, { ipaSha: sha('DIFFERENT') }),
    verifyReport(dir, { ipaSha: sha('a2') }));
  assert.equal(r.report.passed, false);
  assert.ok(r.report.violations.includes('BASELINE_CHAIN_BINDING'), JSON.stringify(r.report.violations));
});

test('upgrade-compat still rejects monotonicity/identity regression (regression)', t => {
  const dir = fixture(t);
  const s1 = sha('b1'), s2 = sha('b2');
  const mkV = (v, b, s) => versionReport(dir, { version: v, build: b, ipaSha: s });
  const mkVer = (s, b) => verifyReport(dir, { ipaSha: s, bundleId: b });
  const same = compat(dir, mkV('0.0.1', 2, s1), mkV('0.0.2', 2, s2), mkVer(s1), mkVer(s2));
  assert.ok(same.report.violations.includes('UPGRADE_MONOTONIC'));
  const regress = compat(dir, mkV('0.1.0', 1, s1), mkV('0.0.9', 2, s2), mkVer(s1), mkVer(s2));
  assert.ok(regress.report.violations.includes('VERSION_REGRESSION'));
  const drift = compat(dir, mkV('0.0.1', 1, s1), mkV('0.0.2', 2, s2), mkVer(s1), mkVer(s2, 'com.other.app'));
  assert.ok(drift.report.violations.includes('BUNDLE_IDENTITY_STABLE'));
});

// ------------------------------------------------------- sidestore-source
function sidestore(dir, version, build, shaHex, size, tag) {
  const out = join(dir, `ss-${rid()}.json`);
  const r = run('sidestore-source.py', [version, String(build), shaHex, String(size), tag, out]);
  const report = existsSync(out) ? readJson(out) : null;
  return { status: r.status, report };
}

test('sidestore-source happy path carries honest shape (regression)', t => {
  const dir = fixture(t);
  const s = sha('ipa-bytes');
  const r = sidestore(dir, '0.0.1', 1, s, 1234567, 'v0.0.1+build1');
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.equal(r.report.publicationStatus, 'draft-only-never-published');
  const v = r.report.source.apps[0].versions[0];
  assert.equal(v.downloadURL, 'https://github.com/HYJ1817/pi-gui-ios/releases/download/v0.0.1+build1/PiGUIMobile-unsigned.ipa');
  assert.equal(v.date, null);
  assert.deepEqual(r.report.source.apps[0].appPermissions, { entitlements: [], privacy: {} });
});

test('FSEC-004: tags escaping the release path are rejected — traversal, newline, query, fragment, mismatch', t => {
  const dir = fixture(t);
  const s = sha('x');
  for (const tag of [
    '../../../../evil?download=other#',
    'v0.0.1+build1\ninjected',
    'v0.0.1+build1?query=1',
    'v0.0.1+build1#frag',
    'v0.0.1+build1/extra',
    '..',
    'v9.9.9+build99',  // valid grammar but not the tag derived from these inputs
  ]) {
    const r = sidestore(dir, '0.0.1', 1, s, 100, tag);
    assert.equal(r.report.passed, false, `tag must be rejected: ${JSON.stringify(tag)}`);
    assert.ok(r.report.violations.includes('TAG_FORMAT'), `${tag}: ${JSON.stringify(r.report.violations)}`);
  }
});

// --------------------------------------------------------- release-draft
function fullChain(dir, { version = '0.0.1', build = 1 } = {}) {
  const ipa = makeIpa(dir, { version, build: String(build) });
  const ipaBytes = readFileSync(ipa);
  const ipaSha = sha(ipaBytes);
  const ver = verifyReport(dir, { ipaSha });
  const vr = versionReport(dir, { version, build, ipaSha });
  const comp = join(dir, `comp-${rid()}.json`);
  writeFileSync(comp, JSON.stringify({
    schemaVersion: 2, kind: 'distribution-upgrade-compat', passed: true, violations: [],
    bindings: { candidateSha256: ipaSha, baselineSha256: sha('older'), candidateBuild: build, baselineBuild: build - 1 },
  }));
  const ssOut = join(dir, `sso-${rid()}.json`);
  const ssr = run('sidestore-source.py', [version, String(build), ipaSha, String(ipaBytes.length), `v${version}+build${build}`, ssOut]);
  assert.equal(ssr.status, 0, 'fixture sidestore generation must pass');
  return { ipa, ipaBytes, ipaSha, ver, vr, comp, ss: ssOut };
}
function releaseDraft(dir, chain, overrides = {}) {
  const outDir = join(dir, `draft-${rid()}`);
  const r = run('release-draft.py', [
    overrides.ipa ?? chain.ipa, overrides.ver ?? chain.ver, overrides.vr ?? chain.vr,
    overrides.comp ?? chain.comp, overrides.ss ?? chain.ss, outDir,
  ]);
  const draft = existsSync(join(outDir, 'release-draft.json')) ? readJson(join(outDir, 'release-draft.json')) : null;
  return { status: r.status, draft, outDir };
}

test('release-draft passes only when the entire chain binds to the same bytes', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const r = releaseDraft(dir, chain);
  assert.equal(r.status, 0, JSON.stringify(r.draft?.violations));
  assert.equal(r.draft.tag, 'v0.0.1+build1');
  assert.equal(r.draft.assets[0].sha256, chain.ipaSha);
  assert.equal(r.draft.assets[0].size, chain.ipaBytes.length);
  assert.equal(r.draft.publicationStatus, 'draft-only-requires-explicit-user-authorization');
});

test('FSEC-002: version report of a DIFFERENT ipa cannot attach to this draft', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const alienVr = versionReport(dir, { version: '9.9.9', build: 99, ipaSha: sha('alien ipa bytes') });
  const r = releaseDraft(dir, chain, { vr: alienVr });
  assert.equal(r.status, 1);
  assert.ok(r.draft.violations.includes('VERSION_HASH_BINDING'), JSON.stringify(r.draft.violations));
  assert.equal(r.draft.tag, null, 'a failed draft mints no tag');
});

test('FSEC-002/functional-2: source metadata mismatched to version report is rejected', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  // Source with correct hash/size but wrong version metadata.
  const evilSs = join(dir, 'evil-ss.json');
  writeFileSync(evilSs, JSON.stringify({
    schemaVersion: 2, kind: 'sidestore-source-draft', passed: true,
    source: { apps: [{ bundleIdentifier: 'io.github.hyj1817.piguimobile', versions: [{
      version: '9.9.9', buildVersion: '1', downloadURL: 'https://github.com/HYJ1817/pi-gui-ios/releases/download/v0.0.1+build1/PiGUIMobile-unsigned.ipa',
      size: chain.ipaBytes.length, sha256: chain.ipaSha, date: null, minOSVersion: '16.4',
    }] }] },
  }));
  const r = releaseDraft(dir, chain, { ss: evilSs });
  assert.equal(r.status, 1);
  assert.ok(r.draft.violations.includes('SOURCE_VERSION_BINDING'), JSON.stringify(r.draft.violations));
});

test('FSEC-002: external download URL is rejected even with correct hash', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const evilSs = join(dir, 'evil-url-ss.json');
  writeFileSync(evilSs, JSON.stringify({
    schemaVersion: 2, kind: 'sidestore-source-draft', passed: true,
    source: { apps: [{ bundleIdentifier: 'io.github.hyj1817.piguimobile', versions: [{
      version: '0.0.1', buildVersion: '1', downloadURL: 'https://example.invalid/malware.ipa',
      size: chain.ipaBytes.length, sha256: chain.ipaSha, date: null, minOSVersion: '16.4',
    }] }] },
  }));
  const r = releaseDraft(dir, chain, { ss: evilSs });
  assert.equal(r.status, 1);
  assert.ok(r.draft.violations.includes('SOURCE_URL_BINDING'), JSON.stringify(r.report?.violations ?? r.draft.violations));
});

test('FSEC-001: incorrectly typed source containers are violations, never crashes', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const badSs = join(dir, 'badtype-ss.json');
  writeFileSync(badSs, JSON.stringify({
    schemaVersion: 2, kind: 'sidestore-source-draft', passed: true,
    source: { apps: ['not-a-dict'] },
  }));
  const r = run('release-draft.py', [chain.ipa, chain.ver, chain.vr, chain.comp, badSs, join(dir, 'out-bad')]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.includes('Traceback'), false, 'no crash on typed input abuse');
  assert.equal(r.stderr.includes('TypeError'), false);
});

test('first-release sentinel compat is accepted and notes say not-applicable', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const sentinel = join(dir, 'sentinel.json');
  writeFileSync(sentinel, JSON.stringify({
    schemaVersion: 2, kind: 'distribution-upgrade-compat-absent', passed: true,
    code: 'NO_BASELINE_FIRST_RELEASE', violations: [], bindings: {},
  }));
  const r = releaseDraft(dir, chain, { comp: sentinel });
  assert.equal(r.status, 0, JSON.stringify(r.draft?.violations));
  assert.equal(r.draft.notes.includes('not applicable — first release'), true, 'notes must not claim verification that never ran');
  assert.equal(r.draft.notes.includes('verified against the recorded baseline'), false);
});

test('release-draft fails closed on any not-passing input (regression)', t => {
  const dir = fixture(t);
  const chain = fullChain(dir);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ passed: false }));
  const r = releaseDraft(dir, chain, { ver: bad, vr: bad, comp: bad, ss: bad });
  assert.equal(r.status, 1);
  for (const code of ['VERIFY_NOT_PASSING', 'VERSION_NOT_PASSING', 'COMPAT_NOT_PASSING', 'SOURCE_NOT_PASSING']) {
    assert.ok(r.draft.violations.includes(code), `${code}: ${JSON.stringify(r.draft.violations)}`);
  }
});

// ------------------------------------------- file integrity / no secrets
test('m6 tooling never embeds secrets or env-dependent behavior', () => {
  for (const f of ['version-detect.py', 'upgrade-compat.py', 'sidestore-source.py', 'release-draft.py']) {
    const src = readFileSync(join(ROOT, 'scripts/ci', f), 'utf8');
    assert.ok(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(src), f);
    // no environment reads — these tools are pure functions of their inputs
    assert.equal(/os\.environ|getenv/.test(src), false, `${f} must not read the environment`);
    // no traceback-prone bare excepts leaking values: fixed vocabulary only
    assert.equal(/print\(.*traceback/.test(src), false);
  }
});

// ------------------------------------------- M6-CI-BASELINE-001 regression
// Behavior-level pins: the test executes the REAL driver against fixture
// directories — never a hard-coded mirror of the decision logic.

function baselineDir(dir, { version = false, verify = false } = {}) {
  const bdir = join(dir, `baseline-${rid()}`);
  mkdirSync(bdir, { recursive: true });
  if (version) writeFileSync(join(bdir, 'baseline-version.json'), JSON.stringify({
    schemaVersion: 2, kind: 'distribution-version-report', passed: true,
    ipaVersion: '0.0.1', ipaBuildNumber: 1, ipaSha256: sha('baseline-bytes'), violations: [],
  }));
  if (verify) writeFileSync(join(bdir, 'baseline-verify.json'), JSON.stringify({
    schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED',
    bundleId: 'io.github.hyj1817.piguimobile', architectures: ['arm64'], sha256: sha('baseline-bytes'),
  }));
  return bdir;
}

function driver(dir, baseline, candV, candVer) {
  const out = join(dir, `compat-out-${rid()}.json`);
  const r = run('baseline-compat.py', [baseline, candV, candVer, out]);
  return {
    status: r.status,
    stdout: r.stdout.trim(),
    stderr: r.stderr,
    out,
    report: existsSync(out) ? readJson(out) : null,
  };
}

test('M6-CI-BASELINE-001: exactly-one baseline file hard-fails and writes NO sentinel', t => {
  const dir = fixture(t);
  const candSha = sha('cand-bytes');
  const candV = versionReport(dir, { version: '0.0.2', build: 2, ipaSha: candSha });
  const candVer = verifyReport(dir, { ipaSha: candSha });
  for (const which of ['version-only', 'verify-only']) {
    const baseline = baselineDir(dir, which === 'version-only' ? { version: true } : { verify: true });
    const r = driver(dir, baseline, candV, candVer);
    assert.equal(r.status, 1, `${which}: partial baseline must exit nonzero`);
    assert.equal(r.stdout, 'REJECTED', `${which}: driver reports the rejected state`);
    assert.ok(r.stderr.includes('PARTIAL_BASELINE_REJECTED'), `${which}: stderr carries the fixed code`);
    assert.equal(r.report, null, `${which}: no output report may be written — especially not a sentinel`);
  }
});

test('M6-CI-BASELINE-001: neither baseline file writes exactly the first-release sentinel', t => {
  const dir = fixture(t);
  const candSha = sha('cand-bytes');
  const candV = versionReport(dir, { version: '0.0.1', build: 1, ipaSha: candSha });
  const candVer = verifyReport(dir, { ipaSha: candSha });
  const baseline = baselineDir(dir, {});
  const r = driver(dir, baseline, candV, candVer);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'SENTINEL');
  assert.equal(r.report.kind, 'distribution-upgrade-compat-absent');
  assert.equal(r.report.code, 'NO_BASELINE_FIRST_RELEASE');
  assert.equal(r.report.passed, true);
});

test('M6-CI-BASELINE-001: complete baseline runs the real comparison end-to-end', t => {
  const dir = fixture(t);
  const baseSha = sha('baseline-bytes');
  const candSha = sha('cand-bytes');
  const candV = versionReport(dir, { version: '0.0.2', build: 2, ipaSha: candSha });
  const candVer = verifyReport(dir, { ipaSha: candSha });
  const baseline = baselineDir(dir, { version: true, verify: true });
  const r = driver(dir, baseline, candV, candVer);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'COMPARE');
  assert.equal(r.report.kind, 'distribution-upgrade-compat');
  assert.equal(r.report.passed, true, 'monotonic upgrade of a real pair passes');
  assert.equal(r.report.bindings.candidateSha256, candSha);
  // And a regression inside the pair must fail through the same path.
  const regressionV = versionReport(dir, { version: '0.0.1', build: 1, ipaSha: candSha });
  const r2 = driver(dir, baseline, regressionV, candVer);
  assert.equal(r2.status, 1, 'non-monotonic candidate fails through the compare path');
  assert.equal(r2.report.passed, false);
});

test('M6-CI-BASELINE-001: workflow delegates to the executable driver', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/native-infrastructure.yml'), 'utf8');
  assert.ok(workflow.includes('scripts/ci/baseline-compat.py'), 'workflow must invoke the driver');
  assert.equal(/elif |HAS_V=/.test(workflow), false, 'branch logic must not be mirrored in shell — it lives in the executable');
});
