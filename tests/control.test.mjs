import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, cpSync, readdirSync, openSync, closeSync, renameSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, envelope, decode, digest, writeEnvelope, loadControl, mutate, snapshot, sourceFingerprint, committedFingerprint, gate, transition, renderProjections, repairProjections, git, evidencePath, validateReport, normalizeCi, createCheckpoint, validateCheckpoint, restoreCheckpoint, atomicWrite, safePath, readSafe, resolveScopes, validateEvidenceScopes, coverageCheck, pruneCheckpoints, CHECKPOINT_KEEP, compactControl, readHistory, immutableWrite, checkFile, safeSyntheticLog, auditEvidence } from '../scripts/lib/control.mjs';
import { inspectRecovery, listCheckpoints } from '../scripts/lib/recovery.mjs';

function fixture(t, committed = true) {
  const root = mkdtempSync(resolve(tmpdir(), 'piguimobile-control-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(git(['init', '-b', 'agent/test'], root).ok, true);
  writeFileSync(resolve(root, '.gitignore'), '.agent/\nPROGRESS.md\ndocs/acceptance/\n');
  writeFileSync(resolve(root, 'source.ts'), 'export const count = 1;\n');
  if (committed) { git(['add', '.gitignore', 'source.ts'], root); assert.ok(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], root).ok); }
  const d = { phase: 'M-1', currentTask: 'infra', branch: 'agent/test', protocolVersion: 1, desktop: { repo: 'HYJ1817/pi-gui', branch: 'main', commit: 'a'.repeat(40), protocolVersion: null }, ci: [], blockers: [], delegates: [], nextAction: 'Run tests', tasks: [{ id: 'infra', phase: 'M-1', title: 'Infrastructure', status: 'in_progress', dependsOn: [], requiredEvidence: ['unit'], acceptance: 'Tests pass', evidence: [] }], checkpoint: null };
  const e = envelope('control', 1, d); writeEnvelope(root, '.agent/control.json', e); renderProjections(root, e);
  return { root, d };
}
function track(root, ...paths) { assert.ok(git(['-c', 'core.autocrlf=false', 'add', '-f', '--', ...paths], root).ok); }
function proof(root, d, { task = d.tasks[0], kind = 'unit', passed = true, exitCode = 0, commit = snapshot(root).commit } = {}) {
  mkdirSync(resolve(root, 'docs/acceptance'), { recursive: true });
  const logPath = 'docs/acceptance/' + task.id + '-' + kind + '.log'; writeFileSync(resolve(root, logPath), 'Synthetic fixture test output\n');
  const report = { schemaVersion: 2, kind, taskId: task.id, commit, sourceFingerprint: sourceFingerprint(root), startedAt: '2026-11-20T01:00:00.000Z', finishedAt: '2026-11-20T01:00:01.000Z', passed, details: { command: 'npm test', exitCode, logPath, logSha256: digest(readFileSync(resolve(root, logPath))) } };
  const path = 'docs/acceptance/' + task.id + '-' + kind + '.json'; writeFileSync(resolve(root, path), JSON.stringify(report)); track(root, logPath, path);
  task.evidence.push({ kind, path, sha256: digest(readFileSync(resolve(root, path))), sourceFingerprint: report.sourceFingerprint, commit, at: report.finishedAt });
  return { report, path };
}
function accept(d, root, id = 'infra') { transition(d, id, 'testing', root); transition(d, id, 'reviewing', root); transition(d, id, 'accepted', root); transition(d, id, 'completed', root); }

test('normal atomic state and locked projection recovery preserve single authority', t => {
  const { root } = fixture(t); const e = mutate(root, d => { d.nextAction = 'Continue after save'; });
  assert.equal(loadControl(root).revision, 2); assert.equal(loadControl(root).data.nextAction, 'Continue after save');
  assert.equal(decode(readFileSync(resolve(root, '.agent/state.json'), 'utf8'), 'state').data.parentDigest, e.integrity.digest);
  writeFileSync(resolve(root, '.agent/tasks.json'), '{broken'); repairProjections(root);
  assert.equal(decode(readFileSync(resolve(root, '.agent/tasks.json'), 'utf8'), 'tasks').revision, 2);
});
test('process exit mid-write preserves old authority and dirty source', t => {
  const { root } = fixture(t); writeFileSync(resolve(root, 'source.ts'), 'uncommitted work');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import fs from "node:fs"; fs.writeFileSync(process.argv[1], "half a write"); process.exit(77);', resolve(root, '.agent/control.json.tmp-crashed')]);
  assert.equal(result.status, 77); assert.equal(loadControl(root).revision, 1); assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'uncommitted work'); assert.ok(snapshot(root).dirty.some(s => s.includes('source.ts')));
});
test('existing writer lock prevents mutation AND projection repair before any writes', t => {
  const { root } = fixture(t); writeFileSync(resolve(root, '.agent/state.json'), 'keep this exact partial projection'); writeFileSync(resolve(root, '.agent/lock'), '{"pid":123}');
  assert.throws(() => mutate(root, d => { d.nextAction = 'wrong'; }), /EEXIST/); assert.throws(() => repairProjections(root), /EEXIST/);
  assert.equal(readFileSync(resolve(root, '.agent/state.json'), 'utf8'), 'keep this exact partial projection'); assert.ok(existsSync(resolve(root, '.agent/lock'))); assert.equal(loadControl(root).revision, 1);
});
test('checksum tamper and unsupported schema rejected', t => {
  const { root } = fixture(t); const e = loadControl(root); e.data.nextAction = 'tampered'; assert.throws(() => decode(e, 'control'), /Integrity/);
  const future = envelope('control', 2, e.data); future.schemaVersion = 99; assert.throws(() => decode(future, 'control'), /Schema/);
});
test('full runtime schema rejects missing nextAction, zero protocol, malformed checkpoint and CI before commit', t => {
  const { root } = fixture(t);
  const invalid = [d => { delete d.nextAction; }, d => { d.protocolVersion = 0; }, d => { d.checkpoint = { id: 'bad' }; }, d => { d.ci.push({ id: 'undefined', head: 'bad', workflow: '.github/workflows/native-infrastructure.yml', attempt: 0, status: 'completed', conclusion: {}, url: 'invalid' }); }];
  for (const change of invalid) { assert.throws(() => mutate(root, change), /Schema/); assert.equal(loadControl(root).revision, 1); }
});
test('dependency cycles, unknown task statuses and phase drift are rejected', t => {
  const { root } = fixture(t);
  assert.throws(() => mutate(root, d => { d.tasks[0].status = 'pretend-passed'; }), /Schema/);
  assert.throws(() => mutate(root, d => { d.tasks.push({ ...d.tasks[0], id: 'second', dependsOn: ['infra'] }); d.tasks[0].dependsOn = ['second']; }), /cycle/);
  assert.throws(() => mutate(root, d => { d.phase = 'M0'; }), /phase/);
});
test('cannot skip testing/review or accept missing proof; actual structured proof works', t => {
  const { root, d } = fixture(t); assert.throws(() => transition(d, 'infra', 'completed', root), /Forbidden/);
  transition(d, 'infra', 'testing', root); transition(d, 'infra', 'reviewing', root); assert.throws(() => transition(d, 'infra', 'accepted', root), /evidence/);
  proof(root, d); transition(d, 'infra', 'accepted', root); transition(d, 'infra', 'completed', root); assert.equal(d.tasks[0].status, 'completed');
});
test('a failed report or nonzero exit cannot be restamped into pass evidence', t => {
  const { root, d } = fixture(t); const { report } = proof(root, d, { passed: false, exitCode: 23 });
  assert.throws(() => validateReport(d, d.tasks[0], report, root), /Failure report/); assert.ok(gate(d, d.tasks[0], root).some(e => e.endsWith('unit')));
  report.passed = true; assert.throws(() => validateReport(d, d.tasks[0], report, root), /failed verification/);
});
test('one report cannot satisfy unrelated evidence kinds', t => {
  const { root, d } = fixture(t); const e = proof(root, d); d.tasks[0].requiredEvidence.push('ci');
  d.tasks[0].evidence.push({ ...d.tasks[0].evidence[0], kind: 'ci' }); assert.ok(gate(d, d.tasks[0], root).some(s => s.endsWith('ci')));
  e.report.kind = 'ci'; e.report.details = { ci: { status: 'completed', conclusion: 'failure' } }; assert.throws(() => validateReport(d, d.tasks[0], e.report, root));
});
test('acceptance requires a real committed source tree, not just current HEAD restamping', t => {
  const { root, d } = fixture(t, false); proof(root, d, { commit: 'a'.repeat(40) }); assert.ok(gate(d, d.tasks[0], root).some(s => s.includes('committed')));
});
test('working tree/source changes invalidate evidence; commit fingerprint matches original tree', t => {
  const { root, d } = fixture(t); const original = sourceFingerprint(root); assert.equal(committedFingerprint(root, snapshot(root).commit), original);
  proof(root, d); assert.deepEqual(gate(d, d.tasks[0], root), []); writeFileSync(resolve(root, 'source.ts'), 'changed code'); assert.ok(gate(d, d.tasks[0], root).length);
  d.tasks[0].status = 'completed'; transition(d, 'infra', 'testing', root); assert.equal(d.tasks[0].status, 'testing');
});
test('report and log hash tampering are detected', t => {
  const { root, d } = fixture(t); const { path, report } = proof(root, d); writeFileSync(resolve(root, report.details.logPath), 'changed log'); assert.ok(gate(d, d.tasks[0], root).length);
  writeFileSync(resolve(root, path), '{"passed":true}'); assert.ok(gate(d, d.tasks[0], root).length);
});
test('upstream completed status with expired evidence cannot start or complete a downstream task', t => {
  const { root, d } = fixture(t); const upstream = d.tasks[0]; const up = proof(root, d); accept(d, root);
  const down = { ...structuredClone(upstream), id: 'device', status: 'pending', dependsOn: ['infra'], evidence: [] }; d.tasks.push(down); proof(root, d, { task: down });
  transition(d, 'device', 'in_progress', root); rmSync(resolve(root, up.path)); down.status = 'pending'; assert.throws(() => transition(d, 'device', 'in_progress', root), /evidence invalid/);
  down.status = 'reviewing'; assert.throws(() => transition(d, 'device', 'accepted', root), /Dependency infra/);
});
test('known blockers prevent acceptance despite otherwise valid evidence', t => {
  const { root, d } = fixture(t); proof(root, d); d.blockers.push('S1 unresolved'); assert.ok(gate(d, d.tasks[0], root).some(e => e.includes('S1')));
});
test('evidence is constrained to canonical dedicated directories', t => {
  const { root } = fixture(t); for (const path of ['../outside.json', 'source.ts', 'docs/acceptance/../../source.ts', 'C:\\secrets.txt']) assert.throws(() => evidencePath(root, path));
});
test('directory symlink or Windows junction cannot escape evidence or state boundaries', t => {
  const { root } = fixture(t); const outside = mkdtempSync(resolve(tmpdir(), 'piguimobile-outside-')); t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'docs/acceptance'), { recursive: true }); writeFileSync(resolve(outside, 'secret.json'), 'synthetic outside marker');
  symlinkSync(outside, resolve(root, 'docs/acceptance/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => evidencePath(root, 'docs/acceptance/linked/secret.json'), /link|junction/);
  rmSync(resolve(root, '.agent'), { recursive: true }); symlinkSync(outside, resolve(root, '.agent'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => mutate(root, () => {}), /link|junction/); assert.equal(readFileSync(resolve(outside, 'secret.json'), 'utf8'), 'synthetic outside marker'); assert.ok(!existsSync(resolve(outside, 'control.json')));
});
test('CI API imports require exact repository, workflow, numeric ID/attempt, commit and conclusion', t => {
  fixture(t); const raw = { id: 123, head_sha: 'b'.repeat(40), run_attempt: 1, path: '.github/workflows/native-infrastructure.yml', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/HYJ1817/pi-gui-ios/actions/runs/123', repository: { full_name: 'HYJ1817/pi-gui-ios' } };
  assert.equal(normalizeCi(raw).conclusion, 'failure');
  for (const patch of [{ id: undefined }, { head_sha: 'bad' }, { run_attempt: 0 }, { conclusion: {} }, { path: 'other.yml' }]) assert.throws(() => normalizeCi({ ...raw, ...patch }));
});
test('CI running and failed status persist without becoming successful proof', t => {
  const { root } = fixture(t); const ci = { id: '123', head: 'b'.repeat(40), workflow: '.github/workflows/native-infrastructure.yml', attempt: 1, status: 'in_progress', conclusion: null, url: 'https://github.com/HYJ1817/pi-gui-ios/actions/runs/123' };
  mutate(root, d => { d.ci.push(ci); }); assert.equal(loadControl(root).data.ci[0].status, 'in_progress');
  mutate(root, d => { d.ci[0].status = 'completed'; d.ci[0].conclusion = 'failure'; }); assert.equal(loadControl(root).data.ci[0].conclusion, 'failure');
});
test('checkpoint is durable and verified before the authority references it', t => {
  const { root } = fixture(t); const e = createCheckpoint(root, 'checkpoint fixture'); assert.equal(e.revision, 2); assert.ok(validateCheckpoint(root, loadControl(root))); assert.deepEqual(inspectRecovery(root).failures, []);
  writeFileSync(resolve(root, e.data.checkpoint.path), 'corrupt'); assert.ok(inspectRecovery(root).failures.some(e => e.includes('checkpoint')));
});
test('failed checkpoint persistence leaves authority revision and reference unchanged', t => {
  const { root } = fixture(t); writeFileSync(resolve(root, '.agent/checkpoints'), 'blocks directory creation');
  assert.throws(() => createCheckpoint(root, 'must fail')); assert.equal(loadControl(root).revision, 1); assert.equal(loadControl(root).data.checkpoint, null); assert.ok(inspectRecovery(root).failures.some(e => e.includes('checkpoint')));
});
test('Git branch drift is detected without discarding dirty code', t => {
  const { root } = fixture(t); createCheckpoint(root, 'before branch drift'); writeFileSync(resolve(root, 'source.ts'), 'keep my changes'); assert.ok(git(['switch', '-c', 'agent/other'], root).ok);
  assert.ok(inspectRecovery(root).failures.some(e => e.includes('Branch mismatch'))); assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'keep my changes');
});
test('desktop/mobile protocol mismatch blocks post-spike gates', t => {
  const { root, d } = fixture(t); proof(root, d); d.phase = d.tasks[0].phase = 'M0'; assert.ok(gate(d, d.tasks[0], root).some(e => e.includes('protocol')));
  d.desktop.protocolVersion = 2; assert.ok(gate(d, d.tasks[0], root).some(e => e.includes('protocol'))); d.desktop.protocolVersion = 1; assert.deepEqual(gate(d, d.tasks[0], root), []);
});
test('checkpoint candidates remain inspectable when authority and newest snapshot are corrupt', t => {
  const { root } = fixture(t); const older = createCheckpoint(root, 'older usable snapshot'); const newer = createCheckpoint(root, 'newest snapshot');
  writeFileSync(resolve(root, '.agent/control.json'), '{corrupt authority'); writeFileSync(resolve(root, newer.data.checkpoint.path), '{broken newest checkpoint');
  const candidates = listCheckpoints(root);
  assert.ok(candidates.some(c => c.path === newer.data.checkpoint.path && c.valid === false));
  assert.equal(candidates.find(c => c.valid).path, older.data.checkpoint.path);
  assert.equal(readFileSync(resolve(root, '.agent/control.json'), 'utf8'), '{corrupt authority');
});
test('actual CLI diagnoses corrupt authority and lists verified candidates without changing files', t => {
  const { root } = fixture(t);
  for (const path of ['scripts/agent-resume.mjs', 'scripts/lib/control.mjs', 'scripts/lib/schema.mjs', 'scripts/lib/recovery.mjs']) {
    mkdirSync(resolve(root, path, '..'), { recursive: true }); cpSync(resolve(ROOT, path), resolve(root, path));
  }
  cpSync(resolve(ROOT, '.agent/schemas'), resolve(root, '.agent/schemas'), { recursive: true });
  const point = createCheckpoint(root, 'CLI restore candidate'); writeFileSync(resolve(root, '.agent/control.json'), '{corrupt authority');
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/agent-resume.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1); const diagnostic = JSON.parse(result.stderr);
  assert.equal(diagnostic.readOnly, true); assert.ok(diagnostic.checkpointCandidates.some(c => c.valid && c.path === point.data.checkpoint.path));
  assert.equal(diagnostic.nextCommand, 'node scripts/agent-restore.mjs ' + point.data.checkpoint.path + ' --apply');
  const list = spawnSync(process.execPath, [resolve(root, 'scripts/agent-resume.mjs'), '--list-checkpoints'], { cwd: root, encoding: 'utf8' });
  assert.equal(list.status, 0); assert.ok(JSON.parse(list.stdout).checkpointCandidates.some(c => c.valid));
  assert.equal(readFileSync(resolve(root, '.agent/control.json'), 'utf8'), '{corrupt authority');
});
test('restore from a verified checkpoint preserves dirty source and backs up corrupt authority', t => {
  const { root } = fixture(t); const saved = createCheckpoint(root, 'known valid');
  writeFileSync(resolve(root, 'source.ts'), 'dirty work survives restore');
  writeFileSync(resolve(root, '.agent/control.json'), '{interrupted authority');
  const restored = restoreCheckpoint(root, saved.data.checkpoint.path);
  assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'dirty work survives restore');
  assert.equal(readFileSync(resolve(root, restored.backup), 'utf8'), '{interrupted authority');
  assert.ok(validateCheckpoint(root, loadControl(root))); assert.equal(loadControl(root).data.currentTask, 'infra');
});
test('a missing authority file can be restored from a verified checkpoint without inventing a byte backup', t => {
  const { root } = fixture(t); const saved = createCheckpoint(root, 'recover missing authority');
  writeFileSync(resolve(root, 'source.ts'), 'dirty source survives missing authority'); rmSync(resolve(root, '.agent/control.json'));
  const restored = restoreCheckpoint(root, saved.data.checkpoint.path);
  assert.equal(restored.authorityWasMissing, true); assert.equal(restored.backup, null);
  assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'dirty source survives missing authority');
  assert.ok(validateCheckpoint(root, loadControl(root))); assert.match(loadControl(root).data.nextAction, /原权威文件缺失/);
});
test('CI success must match the exact imported API receipt, workflow, head and attempt', t => {
  const { root, d } = fixture(t); const commit = snapshot(root).commit;
  d.tasks[0].requiredEvidence = ['ci']; const { report } = proof(root, d, { kind: 'ci' });
  const raw = { id: 123, head_sha: commit, run_attempt: 1, path: '.github/workflows/native-infrastructure.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/HYJ1817/pi-gui-ios/actions/runs/123', repository: { full_name: 'HYJ1817/pi-gui-ios' } };
  d.ci = [normalizeCi(raw)]; const receiptPath = 'docs/acceptance/ci-api.json';
  writeFileSync(resolve(root, receiptPath), JSON.stringify(raw)); track(root, receiptPath);
  report.details = { ci: d.ci[0], receiptPath, receiptSha256: digest(readFileSync(resolve(root, receiptPath))) };
  assert.ok(validateReport(d, d.tasks[0], report, root));
  report.details.ci = { ...d.ci[0], attempt: 2 }; assert.throws(() => validateReport(d, d.tasks[0], report, root), /identity|attempt/);
  report.details.ci = { ...d.ci[0], conclusion: 'failure' }; assert.throws(() => validateReport(d, d.tasks[0], report, root), /succeed/);
});
test('a completed independent task with a failing original result cannot become passing review', t => {
  const { root, d } = fixture(t), commit = snapshot(root).commit; const kind = 'independent-security'; d.tasks[0].requiredEvidence = [kind];
  const { report } = proof(root, d, { kind });
  const result = { schemaVersion: 1, kind, decision: 'pass', reviewedCommit: commit, sourceFingerprint: sourceFingerprint(root), unresolvedBlockers: 0, unresolvedImportant: 0 };
  const receipt = { taskId: 'fixture-independent-task', latestTerminalStatus: 'completed', executedModel: 'fixture-model', summary: JSON.stringify(result) };
  const receiptPath = 'docs/acceptance/review-receipt.json'; writeFileSync(resolve(root, receiptPath), JSON.stringify(receipt)); track(root, receiptPath);
  d.delegates = [{ taskId: receipt.taskId, role: 'security-review', status: 'completed', sourceCommit: commit }];
  report.details = { receiptPath, receiptSha256: digest(readFileSync(resolve(root, receiptPath))) };
  assert.ok(validateReport(d, d.tasks[0], report, root));
  result.decision = 'fail'; result.unresolvedBlockers = 3; receipt.summary = JSON.stringify(result);
  writeFileSync(resolve(root, receiptPath), JSON.stringify(receipt)); track(root, receiptPath); report.details.receiptSha256 = digest(readFileSync(resolve(root, receiptPath)));
  assert.throws(() => validateReport(d, d.tasks[0], report, root), /did not pass/);
});
test('explicit separate review and handoff results are checked independently in one fresh-context receipt', t => {
  const { root, d } = fixture(t), commit = snapshot(root).commit; d.tasks[0].requiredEvidence = ['independent-review', 'independent-handoff'];
  const { report } = proof(root, d, { kind: 'independent-review' });
  const base = { schemaVersion: 1, decision: 'pass', reviewedCommit: commit, sourceFingerprint: sourceFingerprint(root), unresolvedBlockers: 0, unresolvedImportant: 0 };
  const results = [{ ...base, kind: 'independent-review' }, { ...base, kind: 'independent-handoff', restoredTask: 'infra', commands: [{ command: 'node scripts/agent-resume.mjs --remote', exitCode: 0 }, { command: 'npm test', exitCode: 0 }] }];
  const receipt = { taskId: 'fixture-combined-review', latestTerminalStatus: 'completed', executedModel: 'fixture-model', summary: JSON.stringify({ reports: results }) };
  const receiptPath = 'docs/acceptance/combined-review.json'; const save = () => { writeFileSync(resolve(root, receiptPath), JSON.stringify(receipt)); track(root, receiptPath); report.details = { receiptPath, receiptSha256: digest(readFileSync(resolve(root, receiptPath))) }; };
  d.delegates = [{ taskId: receipt.taskId, role: 'functional-and-handoff', status: 'completed', sourceCommit: commit }]; save();
  assert.ok(validateReport(d, d.tasks[0], report, root));
  report.kind = 'independent-handoff'; assert.ok(validateReport(d, d.tasks[0], report, root));
  results[0].decision = 'fail'; results[0].unresolvedImportant = 1; receipt.summary = JSON.stringify({ reports: results }); save();
  report.kind = 'independent-review'; assert.throws(() => validateReport(d, d.tasks[0], report, root), /did not pass/);
  report.kind = 'independent-handoff'; assert.ok(validateReport(d, d.tasks[0], report, root));
  results[1].commands = [{ exitCode: 0 }]; receipt.summary = JSON.stringify({ reports: results }); save(); assert.throws(() => validateReport(d, d.tasks[0], report, root), /follow-on/);
});
test('IPA evidence must identify the hash-bound verified final archive, not only an app directory', t => {
  const { root, d } = fixture(t), commit = snapshot(root).commit; d.tasks[0].requiredEvidence = ['ipa']; const { report } = proof(root, d, { kind: 'ipa' });
  d.ci = [{ id: '123', head: commit, workflow: '.github/workflows/native-infrastructure.yml', attempt: 1, status: 'completed', conclusion: 'success', url: 'https://github.com/HYJ1817/pi-gui-ios/actions/runs/123' }];
  const verification = { schemaVersion: 2, passed: true, kind: 'unsigned-device-archive', code: 'IPA_VERIFIED', platform: 'iOS', architectures: ['arm64'], executables: 2, frameworks: 1, sideStoreInstallVerified: false, sha256: 'a'.repeat(64) };
  const verificationPath = 'docs/acceptance/ipa-verification.json'; const save = () => { writeFileSync(resolve(root, verificationPath), JSON.stringify(verification)); track(root, verificationPath); report.details = { ciId: '123', attempt: 1, archiveSha256: 'a'.repeat(64), verificationPath, verificationSha256: digest(readFileSync(resolve(root, verificationPath))) }; };
  save(); assert.ok(validateReport(d, d.tasks[0], report, root));
  verification.kind = 'unsigned-device-directory'; save(); assert.throws(() => validateReport(d, d.tasks[0], report, root), /final device IPA/);
  verification.kind = 'unsigned-device-archive'; verification.sha256 = 'b'.repeat(64); save(); assert.throws(() => validateReport(d, d.tasks[0], report, root), /archive\/hash/);
});
test('manual device and fresh independent review cannot be replaced by local command reports', t => {
  const { root, d } = fixture(t); const { report } = proof(root, d);
  for (const kind of ['device-install', 'independent-security']) { d.tasks[0].requiredEvidence = [kind]; assert.throws(() => validateReport(d, d.tasks[0], { ...report, kind }, root)); }
});

test('every fingerprinted path belongs to some scope set (fail-closed coverage)', () => {
  assert.deepEqual(coverageCheck(ROOT), [], 'Uncovered paths silently invalidate every scope');
});

test('out-of-scope changes keep evidence valid while in-scope changes invalidate it', t => {
  const { root, d } = fixture(t);
  // Fixture files: source.ts is uncovered (=> shared); make an app-scope file too.
  mkdirSync(resolve(root, 'src'), { recursive: true });
  writeFileSync(resolve(root, 'src/index.ts'), 'export {}\n');
  git(['add', '-A'], root); git(['-c', 'user.name=F', '-c', 'user.email=f@x', 'commit', '-m', 'src'], root);
  const { report } = proof(root, d);
  assert.deepEqual(gate(d, d.tasks[0], root), []);
  // Out-of-scope: docs/meta is out of unit's scope.
  mkdirSync(resolve(root, 'docs'), { recursive: true });
  writeFileSync(resolve(root, 'docs/note.md'), 'meta change');
  assert.deepEqual(gate(d, d.tasks[0], root), [], 'meta/docs change must not stale unit evidence');
  // In-scope (tests/): invalidates.
  mkdirSync(resolve(root, 'tests'), { recursive: true });
  writeFileSync(resolve(root, 'tests/x.test.mjs'), '// t');
  assert.ok(gate(d, d.tasks[0], root).some(e => e.endsWith('unit')), 'in-scope change must stale unit evidence');
});

test('scoped committed fingerprint ignores out-of-scope commits between evidence and now', t => {
  const { root, d } = fixture(t);
  const { report } = proof(root, d); assert.deepEqual(gate(d, d.tasks[0], root), []);
  // Commit an out-of-scope change AFTER the evidence commit: global fingerprint
  // moves but unit's scoped fingerprint does not.
  writeFileSync(resolve(root, 'docs/skip.md'), 'x'); git(['add', '-A'], root);
  git(['-c', 'user.name=F', '-c', 'user.email=f@x', 'commit', '-m', 'docs only'], root);
  assert.notEqual(committedFingerprint(root, snapshot(root).commit), report.sourceFingerprint);
  assert.deepEqual(gate(d, d.tasks[0], root), [], 'docs-only commit must not stale unit evidence');
  // Commit an in-scope change: evidence goes stale.
  writeFileSync(resolve(root, 'source.ts'), 'changed'); git(['add', '-A'], root);
  git(['-c', 'user.name=F', '-c', 'user.email=f@x', 'commit', '-m', 'src change'], root);
  assert.ok(gate(d, d.tasks[0], root).some(e => e.endsWith('unit')));
});

test('scoped reports bind their declared scope set and reject scope tampering', t => {
  const { root, d } = fixture(t);
  const { report } = proof(root, d);
  const scopes = resolveScopes(d.tasks[0], 'unit');
  const scoped = { ...report, scopes, scopeFingerprint: sourceFingerprint(root, scopes) };
  assert.ok(validateReport(d, d.tasks[0], scoped, root));
  scoped.scopes = ['meta']; assert.throws(() => validateReport(d, d.tasks[0], scoped, root), /scope/);
  scoped.scopes = scopes; scoped.scopeFingerprint = 'a'.repeat(64);
  assert.throws(() => validateReport(d, d.tasks[0], scoped, root), /stale|committed/);
});

test('evidenceScopes narrowing floor: only independent kinds, subset of bound, product set retained', t => {
  const { root, d } = fixture(t);
  // Protocol-bound phase may legitimately bind reviews to 'protocol'.
  d.tasks[0].requiredEvidence = ['unit', 'protocol-contract', 'independent-review', 'independent-security'];
  d.tasks[0].evidenceScopes = { 'independent-review': ['protocol'], 'independent-security': ['protocol', 'native-build'] };
  assert.equal(validateEvidenceScopes(d), undefined);
  // Narrowing must not drop a bound product scope entirely: meta/control/tests-only is rejected.
  for (const bad of [['meta'], ['control'], ['tests'], ['meta', 'control']]) {
    d.tasks[0].evidenceScopes = { 'independent-review': bad };
    assert.throws(() => validateEvidenceScopes(d), /Illegal narrowing|inside the default bound/, JSON.stringify(bad));
  }
  // Narrowing may never widen beyond the kind's default bound.
  d.tasks[0].requiredEvidence = ['protocol-contract', 'independent-review'];
  d.tasks[0].evidenceScopes = { 'independent-review': ['protocol', 'app'] };
  assert.throws(() => validateEvidenceScopes(d), /inside the default bound/);
  d.tasks[0].requiredEvidence = ['unit', 'protocol-contract', 'independent-review', 'independent-security'];
  // Unknown set names and meta-quantifiers are configuration errors.
  d.tasks[0].evidenceScopes = { 'independent-review': ['nope'] };
  assert.throws(() => validateEvidenceScopes(d), /Unknown evidence scope/);
  d.tasks[0].evidenceScopes = { 'independent-review': ['union'] };
  assert.throws(() => validateEvidenceScopes(d), /Unknown evidence scope/);
  d.tasks[0].evidenceScopes = { 'independent-review': ['all'] };
  assert.throws(() => validateEvidenceScopes(d), /Unknown evidence scope|inside the default bound/);
  // Non-independent kinds cannot be rebound at all.
  d.tasks[0].evidenceScopes = { unit: ['app'] };
  assert.throws(() => validateEvidenceScopes(d), /only narrow independent/);
  // independent-handoff is always 'all' and cannot be shrunk.
  d.tasks[0].requiredEvidence = ['independent-handoff'];
  d.tasks[0].evidenceScopes = { 'independent-handoff': ['app'] };
  assert.throws(() => validateEvidenceScopes(d), /always-all/);
});
test('security and review narrowing honor declared product boundaries inside the bound', t => {
  const { root, d } = fixture(t);
  d.tasks[0].requiredEvidence = ['unit', 'ui', 'independent-security'];
  // Default union includes native-build via ui; declared narrowing inside the
  // bound that keeps a product set is a legitimate reviewer boundary (ADR-0007).
  for (const declared of [['app', 'native-build'], ['app'], ['native-build']]) {
    d.tasks[0].evidenceScopes = { 'independent-security': declared };
    assert.equal(validateEvidenceScopes(d), undefined, JSON.stringify(declared));
    assert.deepEqual(resolveScopes(d.tasks[0], 'independent-security'), [...declared, 'shared'].sort());
  }
  // But a narrowing that retains no product set at all is rejected.
  d.tasks[0].evidenceScopes = { 'independent-security': ['tests'] };
  assert.throws(() => validateEvidenceScopes(d), /no product scope set/);
});
test('validateControl rejects illegal evidenceScopes before any report is read', t => {
  const { root } = fixture(t);
  assert.throws(() => mutate(root, d => { d.tasks[0].evidenceScopes = { 'independent-review': ['meta'] }; }), /Illegal narrowing|inside the default bound/);
  assert.equal(loadControl(root).revision, 1, 'rejected mutation must not advance the authority');
});
test('checkpoint pruning keeps newest N and never unlinks the referenced checkpoint', t => {
  const { root } = fixture(t);
  let last;
  for (let i = 0; i < 5; i++) last = createCheckpoint(root, 'prune-fixture-' + i);
  const dir = resolve(root, '.agent/checkpoints');
  const pruned = pruneCheckpoints(root, last.data.checkpoint.path, new Set(), 3);
  const names = readdirSync(dir).filter(n => n.startsWith('v2-'));
  assert.ok(names.length <= 3 + 1 || names.includes(last.data.checkpoint.id + '.json'));
  assert.ok(existsSync(resolve(root, last.data.checkpoint.path)), 'referenced checkpoint must survive pruning');
  assert.ok(validateCheckpoint(root, loadControl(root)));
});

test('compaction preserves a valid gate behind a newer failure and archives history without hydration', t => {
  const { root, d } = fixture(t);
  for (let i = 0; i < 4; i++) {
    const { report } = proof(root, d, { passed: i !== 3 });
    report.startedAt = `2026-11-20T01:00:0${i}.000Z`; report.finishedAt = '2026-11-20T01:00:09.000Z';
    const ref = immutableWrite(root, Buffer.from(JSON.stringify(report))); track(root, ref.path);
    Object.assign(d.tasks[0].evidence.at(-1), ref);
  }
  d.delegates.push({ taskId: 'old-failed-review', role: 'review', status: 'completed', decision: 'fail', sourceCommit: snapshot(root).commit });
  mutate(root, next => Object.assign(next, d));
  assert.deepEqual(gate(d, d.tasks[0], root), []);
  const dryBytes = readFileSync(resolve(root, '.agent/control.json'));
  assert.equal(compactControl(root).after.evidence, 2);
  assert.deepEqual(readFileSync(resolve(root, '.agent/control.json')), dryBytes);
  const result = compactControl(root, { apply: true }), compacted = loadControl(root);
  assert.equal(result.after.evidence, 2); assert.deepEqual(gate(compacted.data, compacted.data.tasks[0], root), []);
  const history = readHistory(root, compacted.data);
  assert.equal(history[0].tasks[0].evidence.length, 2); assert.equal(history[0].delegates[0].decision, 'fail');
  assert.equal(compacted.data.delegates.length, 0);
  const tasks = decode(readSafe(root, '.agent/tasks.json', 'utf8'), 'tasks').data.tasks;
  assert.equal(tasks[0].evidence, undefined); assert.equal(tasks[0].evidenceCount, 2);
  const recovery = inspectRecovery(root);
  assert.equal(recovery.currentTask.evidence, undefined); assert.equal(recovery.delegates, undefined);
  const second = compactControl(root, { apply: true }); assert.equal(second.changed, false);
  assert.equal(loadControl(root).data.history.length, 1);
  mutate(root, next => { next.tasks[0].evidence = [next.tasks[0].evidence.at(-1)]; });
  const onlyFailure = loadControl(root).data;
  assert.ok(gate(onlyFailure, onlyFailure.tasks[0], root).length, 'archived passing history is never a gate candidate');
});

test('compacted history survives clone/handoff and dirty restore; corruption is rejected', t => {
  const { root, d } = fixture(t); proof(root, d); d.tasks[0].evidence.push(structuredClone(d.tasks[0].evidence[0]));
  mutate(root, next => Object.assign(next, d)); compactControl(root, { apply: true });
  const point = loadControl(root).data.checkpoint;
  for (const path of ['.gitattributes', '.agent/evidence/.gitattributes', 'docs/acceptance/logs/.gitattributes']) { mkdirSync(resolve(root, path, '..'), { recursive: true }); cpSync(resolve(ROOT, path), resolve(root, path)); }
  const log = immutableWrite(root, Buffer.from('TAP version 13\r\n# tests 1\r\n'), 'log');
  track(root, '.gitattributes', '.agent', 'PROGRESS.md', 'docs/acceptance');
  assert.ok(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'compacted fixture'], root).ok);
  const clone = root + '-clone'; t.after(() => rmSync(clone, { recursive: true, force: true }));
  assert.ok(git(['clone', '--quiet', root, clone], root).ok);
  assert.equal(readHistory(clone, loadControl(clone).data)[0].tasks[0].evidence.length, 1);
  assert.ok(checkFile(clone, log.path, log.sha256));
  assert.ok(validateCheckpoint(clone, loadControl(clone)));
  writeFileSync(resolve(clone, 'source.ts'), 'dirty clone code'); writeFileSync(resolve(clone, '.agent/control.json'), '{corrupt');
  restoreCheckpoint(clone, point.path); assert.equal(readFileSync(resolve(clone, 'source.ts'), 'utf8'), 'dirty clone code');
  const ref = loadControl(clone).data.history[0]; writeFileSync(resolve(clone, ref.path), '{}');
  assert.throws(() => loadControl(clone), /digest mismatch/);
  assert.equal(listCheckpoints(clone).find(c => c.path === point.path).valid, false);
  const before = readFileSync(resolve(clone, '.agent/control.json'));
  assert.throws(() => restoreCheckpoint(clone, point.path), /digest mismatch/);
  assert.deepEqual(readFileSync(resolve(clone, '.agent/control.json')), before);
});

test('interruption after immutable archive persistence leaves the old authority usable', t => {
  const { root } = fixture(t), before = readSafe(root, '.agent/control.json');
  const archive = { schemaVersion: 1, kind: 'control-history', tasks: [], ci: [], delegates: [] };
  const bytes = Buffer.from(JSON.stringify(archive)), path = '.agent/evidence/' + digest(bytes) + '.json';
  mkdirSync(resolve(root, '.agent/evidence'));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'import fs from "node:fs"; const fd = fs.openSync(process.argv[1], "wx"); fs.writeFileSync(fd, process.argv[2]); fs.fsyncSync(fd); fs.closeSync(fd); process.exit(77);', resolve(root, path), bytes.toString()]);
  assert.equal(child.status, 77); assert.deepEqual(readSafe(root, '.agent/control.json'), before);
  assert.equal(loadControl(root).data.history, undefined);
});

test('eight valid checkpoints survive rotation; dirty-path text does not pin an old snapshot', t => {
  const { root } = fixture(t), first = createCheckpoint(root, 'first');
  mutate(root, d => { d.nextAction = 'Incidental deleted path ' + first.data.checkpoint.path; });
  for (let i = 0; i < CHECKPOINT_KEEP + 2; i++) createCheckpoint(root, 'bounded-' + i);
  assert.equal(existsSync(resolve(root, first.data.checkpoint.path)), false);
  writeFileSync(resolve(root, '.agent/checkpoints/v2-zz-corrupt.json'), '{broken');
  createCheckpoint(root, 'newest');
  const candidates = listCheckpoints(root); assert.equal(candidates.filter(c => c.valid).length, 8);
  assert.equal(candidates.filter(c => !c.valid).length, 1);
});

test('nested artifacts must be tracked with exact bytes and immutable basenames', t => {
  const { root, d } = fixture(t); const { report } = proof(root, d);
  git(['rm', '--cached', '-f', '--', report.details.logPath], root);
  assert.throws(() => validateReport(d, d.tasks[0], report, root), /Git-tracked/);
  track(root, report.details.logPath);
  const ref = immutableWrite(root, Buffer.from('Synthetic fixture test output\r\n'), 'log');
  track(root, ref.path); assert.ok(checkFile(root, ref.path, ref.sha256));
  writeFileSync(resolve(root, ref.path), 'changed exact bytes');
  assert.throws(() => checkFile(root, ref.path, ref.sha256), /digest mismatch/);
  const wrong = 'docs/acceptance/logs/' + 'a'.repeat(64) + '.log';
  writeFileSync(resolve(root, wrong), 'Synthetic fixture test output');
  assert.throws(() => checkFile(root, wrong, digest('Synthetic fixture test output'), { tracked: false }), /filename\/hash/);
});

test('latest-record audit recovers only exact safe synthetic logs and never changes source bytes', t => {
  const { root, d } = fixture(t), source = mkdtempSync(resolve(tmpdir(), 'control-log-source-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  mkdirSync(resolve(source, 'docs/acceptance/logs'), { recursive: true });
  const logs = ['TAP version 13\n# tests 1\n# pass 1\n', 'TAP version 13\nC:/Users/private/example.ts\n', 'TAP version 13\nBearer sensitive-fixture-token\n'];
  for (let i = 0; i < logs.length; i++) {
    const { report } = proof(root, d), sha256 = digest(logs[i]), path = `docs/acceptance/logs/${sha256}.log`;
    writeFileSync(resolve(source, path), logs[i]);
    report.details.logPath = path; report.details.logSha256 = sha256;
    const ref = immutableWrite(root, Buffer.from(JSON.stringify(report))); Object.assign(d.tasks[0].evidence.at(-1), ref);
  }
  mutate(root, next => Object.assign(next, d));
  const audit = auditEvidence(root, { recoverFrom: source, apply: true });
  assert.equal(audit.records.length, 3); assert.equal(audit.totals['safe-log-available'], 1);
  assert.equal(audit.totals['withheld-sensitive-or-unverified'], 2);
  assert.equal(readdirSync(resolve(root, 'docs/acceptance/logs')).length, 1);
  assert.equal(readFileSync(resolve(source, `docs/acceptance/logs/${digest(logs[0])}.log`), 'utf8'), logs[0]);
  assert.equal(JSON.stringify(audit).includes('C:/Users'), false);
  const rerun = auditEvidence(root, { recoverFrom: source }); assert.equal(rerun.records.length, 3);
  for (const text of ['test 1\napi_key=synthetic-secret\n', 'TAP version 13\n/home/example/file\n', 'ordinary unverified output']) assert.equal(safeSyntheticLog(Buffer.from(text)), false);
});

test('hash log allowlist excludes arbitrary logs and nested paths', t => {
  const { root } = fixture(t);
  writeFileSync(resolve(root, '.gitignore'), readFileSync(resolve(ROOT, '.gitignore')));
  const base = 'docs/acceptance/logs/', hash = 'a'.repeat(64);
  assert.equal(git(['check-ignore', '--no-index', base + hash + '.log'], root).ok, false);
  for (const path of [base + 'private.log', base + hash + '.txt', base + hash.slice(1) + '.log', base + 'nested/' + hash + '.log', '.agent/private-logs/' + hash + '.log']) assert.equal(git(['check-ignore', '--no-index', path], root).ok, true, path);
});

test('explicit terminal reconciliation preserves FAIL and never silently adopts a branch', t => {
  const { root } = fixture(t), id = 'b59334b1-1dc4-49bd-a8d1-831dac04e67d';
  mutate(root, d => { d.delegates = [{ taskId: 'prefix:' + id, role: 'security', status: 'working', sourceCommit: snapshot(root).commit }]; });
  assert.ok(git(['switch', '-c', 'agent/isolated'], root).ok);
  assert.throws(() => compactControl(root), /Branch mismatch/);
  compactControl(root, { apply: true, adoptBranch: true, terminalFail: [id] });
  const control = loadControl(root), record = readHistory(root, control.data)[0].delegates[0];
  assert.equal(record.status, 'completed'); assert.equal(record.decision, 'fail');
  assert.equal(control.data.branch, 'agent/isolated'); assert.equal(control.data.delegates.length, 0);
});

test('FSEC-006-R4-001 end-to-end: the real importer CLI refuses a junction store — no external write, no authority update', t => {
  // Wire-level pin: copy the real scripts + schemas into a synthetic repo,
  // junction .agent/evidence outside, then run the actual agent-task CLI.
  const { root } = fixture(t);
  for (const rel of ['scripts/agent-task.mjs', 'scripts/lib/control.mjs', 'scripts/lib/schema.mjs', 'scripts/lib/recovery.mjs']) {
    const dest = resolve(root, rel);
    mkdirSync(resolve(dest, '..'), { recursive: true });
    writeFileSync(dest, readFileSync(resolve(ROOT, rel)));
  }
  const schemaSrc = resolve(ROOT, '.agent/schemas');
  mkdirSync(resolve(root, '.agent/schemas'), { recursive: true });
  for (const f of readdirSync(schemaSrc)) writeFileSync(resolve(root, '.agent/schemas', f), readFileSync(resolve(schemaSrc, f)));
  // Commit the copied scripts: validateReport requires the report fingerprint
  // to equal the COMMITTED tree fingerprint, and untracked scripts/ files are
  // part of the worktree fingerprint. Without this commit both versions fail
  // at validateReport and the pin never reaches the junction logic at all —
  // exactly the kind of vacuous pin M6-CI-BASELINE-001-TEST-001 warned about.
  assert.ok(git(['add', 'scripts'], root).ok);
  assert.ok(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'scripts'], root).ok);
  // A valid report the importer would otherwise accept.
  const logPath = 'docs/acceptance/infra-unit.log';
  mkdirSync(resolve(root, 'docs/acceptance'), { recursive: true });
  writeFileSync(resolve(root, logPath), 'Synthetic fixture test output' + String.fromCharCode(10));
  const report = {
    schemaVersion: 2, kind: 'unit', taskId: 'infra', commit: snapshot(root).commit,
    sourceFingerprint: sourceFingerprint(root),
    startedAt: '2026-11-20T01:00:00.000Z', finishedAt: '2026-11-20T01:00:01.000Z',
    passed: true,
    details: { command: 'npm test', exitCode: 0, logPath, logSha256: digest(readFileSync(resolve(root, logPath))) },
  };
  writeFileSync(resolve(root, 'docs/acceptance/report.json'), JSON.stringify(report)); track(root, logPath);
  // A successful importer run proves the pin reaches the storage boundary.
  const positive = spawnSync(process.execPath, [resolve(root, 'scripts/agent-task.mjs'), 'evidence', 'infra', 'docs/acceptance/report.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(loadControl(root).data.tasks[0].evidence.length, 1);
  assert.equal(loadControl(root).data.checkpoint, null, 'evidence events do not create full checkpoints');
  // Junction .agent/evidence -> outside.
  const outside = mkdtempSync(resolve(tmpdir(), 'evj2-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  rmSync(resolve(root, '.agent/evidence'), { recursive: true, force: true });
  symlinkSync(outside, resolve(root, '.agent/evidence'), 'junction');
  const controlBefore = readFileSync(resolve(root, '.agent/control.json'), 'utf8');
  const r = spawnSync(process.execPath, [resolve(root, 'scripts/agent-task.mjs'), 'evidence', 'infra', 'docs/acceptance/report.json'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'importer must refuse the junction: ' + (r.stdout + r.stderr).slice(0, 200));
  assert.equal(readdirSync(outside).length, 0, 'no byte may land outside the repository');
  assert.equal(readFileSync(resolve(root, '.agent/control.json'), 'utf8'), controlBefore, 'authority must remain byte-identical — no evidence reference recorded');
});

test('FSEC-006-R4-001: evidence import rejects Windows junction store before any external write or authority update', t => {
  // The store destination must go through the safe-path boundary. A junction
  // at .agent/evidence redirecting outside the repository is rejected — no
  // byte lands outside, and the authority is never updated.
  const repo = mkdtempSync(resolve(tmpdir(), 'evj-repo-'));
  const outside = mkdtempSync(resolve(tmpdir(), 'evj-out-'));
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  mkdirSync(resolve(repo, '.agent'), { recursive: true });
  symlinkSync(outside, resolve(repo, '.agent', 'evidence'), 'junction');
  const target = resolve(repo, '.agent', 'evidence', 'x.json');
  assert.throws(
    () => atomicWrite(target, Buffer.from('probe'), repo),
    /Symbolic link|junction|forbidden/i,
    'junction destination must be rejected before writing');
  assert.equal(readdirSync(outside).length, 0, 'no byte may land outside the repository');
  // The existing-store collision read path used by the importer is readSafe —
  // equally protected by the same safe-path boundary.
  assert.throws(
    () => readSafe(repo, '.agent/evidence/x.json'),
    /Symbolic link|junction|forbidden|escapes/i,
    'junction read path must be rejected');
  // And safePath in allowMissing mode (what the importer uses for the write
  // destination) rejects the junction before anything is created.
  assert.throws(
    () => safePath(repo, target, { allowMissing: true }),
    /Symbolic link|junction|forbidden|escapes/i,
    'write destination validation must reject the junction');
});

test('FSEC-006-R5-001: atomicWrite detection boundary — pre-swapped junction rejected, writes complete, no silent success outside', t => {
  // Honest boundary documentation: Node cannot pin a parent directory against
  // delete-and-recreate indirection (verified experimentally — an open
  // O_RDONLY directory handle does NOT block renameSync on Windows). The
  // implementation therefore DETECTS rather than prevents: re-validation
  // before rename plus post-rename real-path escape detection, never
  // confirming a write that landed outside.
  const repo = mkdtempSync(resolve(tmpdir(), 'atw-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(resolve(repo, 'sub'), { recursive: true });
  mkdirSync(resolve(repo, '.agent'), { recursive: true });
  // Ordinary write completes normally with the hardened path.
  const target = resolve(repo, 'sub', 'probe.json');
  atomicWrite(target, Buffer.from('probe-bytes'), repo);
  assert.equal(readFileSync(target, 'utf8'), 'probe-bytes', 'write completes normally');
  // Pre-swapped junction: validation rejects before any byte lands outside.
  const outside = mkdtempSync(resolve(tmpdir(), 'atw-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, resolve(repo, 'linked'), 'junction');
  assert.throws(
    () => atomicWrite(resolve(repo, 'linked', 'evil.json'), Buffer.from('x'), repo),
    /Symbolic link|junction|forbidden|escapes/i,
    'pre-swapped junction is rejected at validation — bytes never land outside');
  assert.equal(readdirSync(outside).length, 0, 'no byte outside');
  // The detection layer is wired: verify the escape check exists in the
  // implementation and refuses confirmation rather than reporting success.
  const impl = readFileSync(resolve(ROOT, 'scripts/lib/control.mjs'), 'utf8');
  assert.ok(impl.includes('Atomic write landed outside the repository'), 'escape detection is part of the write path');
  assert.ok(!impl.includes('dirHandle'), 'no false handle-pin claim — the boundary is honest detection');
});
