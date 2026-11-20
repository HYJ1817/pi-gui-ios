import { readFileSync } from 'node:fs';
import { ROOT, mutate, transition, digest, sourceFingerprint, snapshot, evidencePath } from './lib/control.mjs';
const [action, id, value, ...rest] = process.argv.slice(2);
if (action === 'transition') {
  const result = mutate(ROOT, d => transition(d, id, value)); console.log(id + ': ' + result.data.tasks.find(t => t.id === id).status);
} else if (action === 'evidence') {
  const kind = value, path = rest[0];
  if (!path || !rest.includes('--passed')) throw new Error('evidence <task> <kind> <relative report> --passed (only after actual verification)');
  const report = readFileSync(evidencePath(ROOT, path));
  mutate(ROOT, d => { const task = d.tasks.find(t => t.id === id); if (!task) throw new Error('Unknown task'); task.evidence.push({ kind, path, passed: true, sha256: digest(report), sourceFingerprint: sourceFingerprint(), commit: snapshot().commit, at: new Date().toISOString() }); });
  console.log('Recorded ' + kind + ' evidence; task completion still gated.');
} else if (action === 'ci') {
  const record = JSON.parse(readFileSync(evidencePath(ROOT, value), 'utf8'));
  mutate(ROOT, d => { const at = d.ci.findIndex(c => c.id === String(record.id)); const ci = { id: String(record.id), head: record.headSha, status: record.status, conclusion: record.conclusion ?? null, url: record.url ?? null }; if (at < 0) d.ci.push(ci); else d.ci[at] = ci; });
  console.log('Recorded actual CI identity/status');
} else throw new Error('Use transition, evidence, or ci; see docs/testing.md');
