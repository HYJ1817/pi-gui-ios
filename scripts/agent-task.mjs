import { ROOT, mutate, transition, digest, evidencePath, validateReport, readSafe, safePath, atomicWrite, normalizeCi, run, assert, createCheckpoint, stable } from './lib/control.mjs';
import { validateSchema } from './lib/schema.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const [action, id, value] = process.argv.slice(2);
if (action === 'transition') {
  const result = mutate(ROOT, d => transition(d, id, value)); console.log(id + ': ' + result.data.tasks.find(t => t.id === id).status);
} else if (action === 'evidence') {
  // Import the report's original identity/result. Never restamp a caller's file as passed.
  evidencePath(ROOT, value);
  const bytes = readSafe(ROOT, value), report = JSON.parse(bytes.toString('utf8'));
  validateSchema(report, 'evidence.schema.json');
  if (report.kind === 'ci') {
    validateSchema(report.details.ci, 'ci.schema.json');
    const live = run('gh', ['api', 'repos/HYJ1817/pi-gui-ios/actions/runs/' + report.details.ci.id + '/attempts/' + report.details.ci.attempt]);
    assert(live.ok, 'Cannot independently verify CI run/attempt');
    const actual = normalizeCi(JSON.parse(live.stdout));
    assert(stable(actual) === stable(report.details.ci), 'CI live result does not match report');
  }
  mutate(ROOT, d => {
    const task = d.tasks.find(t => t.id === id); assert(task, 'Unknown task'); validateReport(d, task, report);
    // FSEC-006 evidence immutability: the imported bytes are copied into the
    // content-addressed evidence store BEFORE being referenced. The recorded
    // path can never be overwritten by a later run — the caller's own file
    // may be a scratch clone or a canonical report path that gets regenerated,
    // but the authority always points at bytes identical to what was imported.
    const storeRel = '.agent/evidence/' + digest(bytes) + '.json';
    // FSEC-006-R4-001: the content-addressed destination goes through the same
    // safe-path boundary as every other authoritative write. A Windows
    // junction or symlink at .agent/evidence (or anywhere in the parent
    // chain) is rejected BEFORE any byte is written outside the repository,
    // and existing store entries are read through the protected path so the
    // collision check cannot be redirected either.
    const storeAbs = safePath(ROOT, resolve(ROOT, storeRel), { allowMissing: true });
    if (!existsSync(storeAbs)) {
      atomicWrite(storeAbs, bytes, ROOT);
    } else {
      const existing = readSafe(ROOT, storeRel);
      assert(digest(existing) === digest(bytes), 'Evidence store collision: content-addressed path holds different bytes');
    }
    const record = { kind: report.kind, path: storeRel, originalPath: value, sha256: digest(bytes), sourceFingerprint: report.sourceFingerprint, commit: report.commit, at: new Date().toISOString() };
    if (report.scopeFingerprint !== undefined) { record.scopes = report.scopes; record.scopeFingerprint = report.scopeFingerprint; }
    task.evidence.push(record);
  });
  console.log('Imported verified ' + report.kind + ' report into the immutable content-addressed store.');
} else if (action === 'ci') {
  const raw = JSON.parse(readSafe(ROOT, value, 'utf8')), record = normalizeCi(raw);
  const live = run('gh', ['api', 'repos/HYJ1817/pi-gui-ios/actions/runs/' + record.id + '/attempts/' + record.attempt]);
  assert(live.ok, 'Cannot verify CI API import');
  const actual = normalizeCi(JSON.parse(live.stdout));
  mutate(ROOT, d => { const at = d.ci.findIndex(c => c.id === actual.id && c.attempt === actual.attempt); if (at < 0) d.ci.push(actual); else d.ci[at] = actual; });
  console.log('Imported actual CI identity/status/attempt');
} else throw new Error('Use transition <task> <status>, evidence <task> <report.json>, ci current <raw-GitHub-run.json>');
createCheckpoint(ROOT, 'agent-task ' + action + ' ' + id);
