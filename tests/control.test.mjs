import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { envelope, decode, digest, writeEnvelope, loadControl, mutate, snapshot, sourceFingerprint, committedFingerprint, gate, transition, renderProjections, repairProjections, git, evidencePath, validateReport, normalizeCi, createCheckpoint, validateCheckpoint, restoreCheckpoint, atomicWrite } from '../scripts/lib/control.mjs';
import { inspectRecovery } from '../scripts/lib/recovery.mjs';

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
function proof(root, d, { task = d.tasks[0], kind = 'unit', passed = true, exitCode = 0, commit = snapshot(root).commit } = {}) {
  mkdirSync(resolve(root, 'docs/acceptance'), { recursive: true });
  const logPath = 'docs/acceptance/' + task.id + '-' + kind + '.log'; writeFileSync(resolve(root, logPath), 'Synthetic fixture test output\n');
  const report = { schemaVersion: 2, kind, taskId: task.id, commit, sourceFingerprint: sourceFingerprint(root), startedAt: '2026-11-20T01:00:00.000Z', finishedAt: '2026-11-20T01:00:01.000Z', passed, details: { command: 'npm test', exitCode, logPath, logSha256: digest(readFileSync(resolve(root, logPath))) } };
  const path = 'docs/acceptance/' + task.id + '-' + kind + '.json'; writeFileSync(resolve(root, path), JSON.stringify(report));
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
test('restore from a verified checkpoint preserves dirty source and backs up corrupt authority', t => {
  const { root } = fixture(t); const saved = createCheckpoint(root, 'known valid');
  writeFileSync(resolve(root, 'source.ts'), 'dirty work survives restore');
  writeFileSync(resolve(root, '.agent/control.json'), '{interrupted authority');
  const restored = restoreCheckpoint(root, saved.data.checkpoint.path);
  assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'dirty work survives restore');
  assert.equal(readFileSync(resolve(root, restored.backup), 'utf8'), '{interrupted authority');
  assert.ok(validateCheckpoint(root, loadControl(root))); assert.equal(loadControl(root).data.currentTask, 'infra');
});
test('CI success must match the exact imported API receipt, workflow, head and attempt', t => {
  const { root, d } = fixture(t); const commit = snapshot(root).commit;
  d.tasks[0].requiredEvidence = ['ci']; const { report } = proof(root, d, { kind: 'ci' });
  const raw = { id: 123, head_sha: commit, run_attempt: 1, path: '.github/workflows/native-infrastructure.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/HYJ1817/pi-gui-ios/actions/runs/123', repository: { full_name: 'HYJ1817/pi-gui-ios' } };
  d.ci = [normalizeCi(raw)]; const receiptPath = 'docs/acceptance/ci-api.json';
  writeFileSync(resolve(root, receiptPath), JSON.stringify(raw));
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
  const receiptPath = 'docs/acceptance/review-receipt.json'; writeFileSync(resolve(root, receiptPath), JSON.stringify(receipt));
  d.delegates = [{ taskId: receipt.taskId, role: 'security-review', status: 'completed', sourceCommit: commit }];
  report.details = { receiptPath, receiptSha256: digest(readFileSync(resolve(root, receiptPath))) };
  assert.ok(validateReport(d, d.tasks[0], report, root));
  result.decision = 'fail'; result.unresolvedBlockers = 3; receipt.summary = JSON.stringify(result);
  writeFileSync(resolve(root, receiptPath), JSON.stringify(receipt)); report.details.receiptSha256 = digest(readFileSync(resolve(root, receiptPath)));
  assert.throws(() => validateReport(d, d.tasks[0], report, root), /did not pass/);
});
test('manual device and fresh independent review cannot be replaced by local command reports', t => {
  const { root, d } = fixture(t); const { report } = proof(root, d);
  for (const kind of ['device-install', 'independent-security']) { d.tasks[0].requiredEvidence = [kind]; assert.throws(() => validateReport(d, d.tasks[0], { ...report, kind }, root)); }
});
