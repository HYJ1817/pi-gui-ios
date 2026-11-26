import { ROOT, compactControl, auditEvidence, immutableWrite, readSafe, safePath } from './lib/control.mjs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const values = name => args.flatMap((arg, i) => arg === name ? [args[i + 1]] : []);
const apply = args.includes('--apply');
function sizes() {
  const projections = Object.fromEntries(['.agent/control.json', '.agent/tasks.json', '.agent/state.json', '.agent/HANDOFF.md', 'PROGRESS.md'].map(path => [path, readSafe(ROOT, path).length]));
  const directory = safePath(ROOT, resolve(ROOT, '.agent/checkpoints'), { leaf: 'directory' });
  const checkpoints = readdirSync(directory).filter(name => /^v2-[a-zA-Z0-9_-]+\.json$/.test(name));
  return { files: projections, checkpoints: { count: checkpoints.length, bytes: checkpoints.reduce((total, name) => total + readSafe(ROOT, '.agent/checkpoints/' + name).length, 0) } };
}
const beforeBytes = sizes();
// Read-only by default. The external repository is only a byte recovery source;
// no source path or log contents are emitted into the public audit.
const audit = auditEvidence(ROOT, { recoverFrom: option('--recover-logs-from'), apply });
const auditRef = apply ? immutableWrite(ROOT, Buffer.from(JSON.stringify(audit, null, 2) + '\n')) : null;
const result = compactControl(ROOT, { apply, adoptBranch: args.includes('--adopt-branch'), terminalFailed: values('--terminal-failed'), terminalFail: values('--terminal-fail') });
const summary = { schemaVersion: 1, kind: 'control-compaction', apply, bytes: { before: beforeBytes, after: sizes() }, audit: { records: audit.records.length, totals: audit.totals, reference: auditRef }, ...result };
const handoff = apply ? immutableWrite(ROOT, Buffer.from(JSON.stringify(summary, null, 2) + '\n')) : null;
console.log(JSON.stringify({ ...summary, handoff }, null, 2));
