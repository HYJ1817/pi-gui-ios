import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { envelope, decode, digest, writeEnvelope, loadControl, mutate, snapshot, sourceFingerprint, gate, transition, renderProjections, git, evidencePath } from '../scripts/lib/control.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'piguimobile-control-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(git(['init', '-b', 'agent/test'], root).ok, true);
  writeFileSync(resolve(root, '.gitignore'), '.agent/\nPROGRESS.md\nreport.json\n');
  writeFileSync(resolve(root, 'source.ts'), 'export const count = 1;\n');
  const d = { phase: 'M-1', currentTask: 'infra', branch: 'agent/test', protocolVersion: 1, desktop: { repo: 'HYJ1817/pi-gui', branch: 'main', commit: 'a'.repeat(40), protocolVersion: null }, ci: [], blockers: [], nextAction: 'Run tests', tasks: [{ id: 'infra', phase: 'M-1', title: 'Infrastructure', status: 'in_progress', dependsOn: [], requiredEvidence: ['unit', 'independent-review'], acceptance: 'Tests and review pass', evidence: [] }], checkpoint: null };
  const e = envelope('control', 1, d); writeEnvelope(root, '.agent/control.json', e); renderProjections(root, e);
  return { root, d };
}
function addProof(root, d, kind) {
  writeFileSync(resolve(root, 'report.json'), JSON.stringify({ passed: true, fixture: true }));
  d.tasks[0].evidence.push({ kind, passed: true, path: 'report.json', sha256: digest(readFileSync(resolve(root, 'report.json'))), sourceFingerprint: sourceFingerprint(root), commit: snapshot(root).commit, at: new Date().toISOString() });
}

test('normal atomic state save and projection recovery preserve single authority', t => {
  const { root } = fixture(t); const e = mutate(root, d => { d.nextAction = 'Continue after save'; });
  assert.equal(loadControl(root).revision, 2); assert.equal(loadControl(root).data.nextAction, 'Continue after save');
  const projection = decode(readFileSync(resolve(root, '.agent/state.json'), 'utf8'), 'state'); assert.equal(projection.data.parentDigest, e.integrity.digest);
  writeFileSync(resolve(root, '.agent/tasks.json'), '{broken'); renderProjections(root, loadControl(root));
  assert.equal(decode(readFileSync(resolve(root, '.agent/tasks.json'), 'utf8'), 'tasks').revision, 2);
});
test('unexpected process termination leaves previous authority usable and uncommitted code intact', t => {
  const { root } = fixture(t); writeFileSync(resolve(root, 'source.ts'), 'uncommitted work');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import fs from "node:fs"; fs.writeFileSync(process.argv[1], "half a write"); process.exit(77);', resolve(root, '.agent/control.json.tmp-crashed')]);
  assert.equal(result.status, 77); assert.equal(loadControl(root).revision, 1); assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'uncommitted work');
  assert.ok(snapshot(root).dirty.some(line => line.includes('source.ts')));
});
test('writer lock fails closed without deleting another writer lock', t => {
  const { root } = fixture(t); writeFileSync(resolve(root, '.agent/lock'), '{"pid":123}');
  assert.throws(() => mutate(root, d => { d.nextAction = 'wrong'; }), /EEXIST/); assert.ok(existsSync(resolve(root, '.agent/lock'))); assert.equal(loadControl(root).revision, 1);
});
test('corrupt checksum and unknown schema are rejected', t => {
  const { root } = fixture(t); const e = loadControl(root); e.data.nextAction = 'tampered'; assert.throws(() => decode(e, 'control'), /Integrity/);
  const future = envelope('control', 2, e.data); future.schemaVersion = 99; assert.throws(() => decode(future, 'control'), /schema/);
});
test('dependency cycles and invalid status fail structural validation', t => {
  const { root, d } = fixture(t); d.tasks[0].status = 'pretend-passed'; assert.throws(() => decode(envelope('control', 2, d), 'control'), /task/);
  d.tasks[0].status = 'pending'; d.tasks.push({ ...d.tasks[0], id: 'second', dependsOn: ['infra'] }); d.tasks[0].dependsOn = ['second']; assert.throws(() => decode(envelope('control', 2, d), 'control'), /cycle/);
});
test('cannot skip testing/review or complete without actual proof', t => {
  const { root, d } = fixture(t); assert.throws(() => transition(d, 'infra', 'completed', root), /Forbidden/);
  transition(d, 'infra', 'testing', root); transition(d, 'infra', 'reviewing', root); assert.throws(() => transition(d, 'infra', 'accepted', root), /evidence/);
  addProof(root, d, 'unit'); addProof(root, d, 'independent-review'); transition(d, 'infra', 'accepted', root); transition(d, 'infra', 'completed', root); assert.equal(d.tasks[0].status, 'completed');
});
test('source changes invalidate accepted proof and allow explicit revalidation', t => {
  const { root, d } = fixture(t); addProof(root, d, 'unit'); addProof(root, d, 'independent-review'); assert.deepEqual(gate(d, d.tasks[0], root), []);
  writeFileSync(resolve(root, 'source.ts'), 'changed code'); assert.equal(gate(d, d.tasks[0], root).length, 2);
  d.tasks[0].status = 'completed'; transition(d, 'infra', 'testing', root); assert.equal(d.tasks[0].status, 'testing');
});
test('tampered, missing, escaped evidence never satisfies gate', t => {
  const { root, d } = fixture(t); addProof(root, d, 'unit'); writeFileSync(resolve(root, 'report.json'), 'tampered'); assert.ok(gate(d, d.tasks[0], root).some(s => s.endsWith('unit')));
  assert.throws(() => evidencePath(root, '../outside.txt'), /escapes/); assert.throws(() => evidencePath(root, 'C:\\secrets.txt'), /relative/);
});
test('CI running and failure survive save/recovery, without becoming pass evidence', t => {
  const { root } = fixture(t); mutate(root, d => { d.ci.push({ id: '123', head: 'b'.repeat(40), status: 'in_progress', conclusion: null }); });
  assert.equal(loadControl(root).data.ci[0].status, 'in_progress'); mutate(root, d => { d.ci[0].status = 'completed'; d.ci[0].conclusion = 'failure'; });
  assert.equal(loadControl(root).data.ci[0].conclusion, 'failure'); assert.ok(gate(loadControl(root).data, loadControl(root).data.tasks[0], root).length);
});
test('Git HEAD and branch drift can be detected without reset or losing dirty work', t => {
  const { root } = fixture(t); const before = snapshot(root); assert.equal(before.commit, null);
  git(['add', '.gitignore', 'source.ts'], root); assert.ok(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], root).ok);
  writeFileSync(resolve(root, 'source.ts'), 'keep my changes'); assert.ok(git(['switch', '-c', 'agent/other'], root).ok);
  const after = snapshot(root); assert.notEqual(after.commit, before.commit); assert.notEqual(after.branch, loadControl(root).data.branch); assert.equal(readFileSync(resolve(root, 'source.ts'), 'utf8'), 'keep my changes');
});
test('desktop/mobile protocol mismatch blocks post-spike acceptance', t => {
  const { root, d } = fixture(t); d.tasks[0].phase = 'M0'; d.tasks[0].requiredEvidence = [];
  assert.ok(gate(d, d.tasks[0], root).some(s => s.includes('protocol'))); d.desktop.protocolVersion = 2; assert.ok(gate(d, d.tasks[0], root).length); d.desktop.protocolVersion = 1; assert.deepEqual(gate(d, d.tasks[0], root), []);
});
