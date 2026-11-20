import { ROOT, mutate, transition, digest, evidencePath, validateReport, readSafe, normalizeCi, run, assert, createCheckpoint, stable } from './lib/control.mjs';
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
    task.evidence.push({ kind: report.kind, path: value, sha256: digest(bytes), sourceFingerprint: report.sourceFingerprint, commit: report.commit, at: new Date().toISOString() });
  });
  console.log('Imported verified ' + report.kind + ' report without altering its result/source.');
} else if (action === 'ci') {
  const raw = JSON.parse(readSafe(ROOT, value, 'utf8')), record = normalizeCi(raw);
  const live = run('gh', ['api', 'repos/HYJ1817/pi-gui-ios/actions/runs/' + record.id + '/attempts/' + record.attempt]);
  assert(live.ok, 'Cannot verify CI API import');
  const actual = normalizeCi(JSON.parse(live.stdout));
  mutate(ROOT, d => { const at = d.ci.findIndex(c => c.id === actual.id && c.attempt === actual.attempt); if (at < 0) d.ci.push(actual); else d.ci[at] = actual; });
  console.log('Imported actual CI identity/status/attempt');
} else throw new Error('Use transition <task> <status>, evidence <task> <report.json>, ci current <raw-GitHub-run.json>');
createCheckpoint(ROOT, 'agent-task ' + action + ' ' + id);
