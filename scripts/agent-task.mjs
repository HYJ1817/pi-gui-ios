import { ROOT, mutate, transition, digest, evidencePath, validateReport, readSafe, immutableWrite, normalizeCi, run, assert, createCheckpoint, stable } from './lib/control.mjs';
import { validateSchema } from './lib/schema.mjs';
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
    const storeRel = immutableWrite(ROOT, bytes).path;
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
// Evidence/CI events are already durable in the single authority. Full
// recovery snapshots belong at task boundaries or explicit checkpoints.
if (action === 'transition') createCheckpoint(ROOT, 'agent-task transition ' + id);
