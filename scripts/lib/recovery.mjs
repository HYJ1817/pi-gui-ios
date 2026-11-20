import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadControl, decode, readSafe, snapshot, sourceFingerprint, validateCheckpoint, gate } from './control.mjs';
export function inspectRecovery(root) {
  const control = loadControl(root), d = control.data, actualGit = snapshot(root), warnings = [], failures = [];
  if (existsSync(resolve(root, '.agent/lock'))) failures.push('Writer lock exists; inspect PID and partial changes before removal');
  for (const kind of ['state', 'tasks']) {
    try { const e = decode(readSafe(root, '.agent/' + kind + '.json', 'utf8'), kind); if (e.revision !== control.revision || e.data.parentDigest !== control.integrity.digest) warnings.push(kind + ' projection stale'); }
    catch (error) { warnings.push(kind + ' projection missing/corrupt: ' + error.message); }
  }
  try { validateCheckpoint(root, control); } catch (error) { failures.push('Invalid/missing checkpoint: ' + error.message); }
  if (actualGit.branch !== d.branch) failures.push('Branch mismatch: expected ' + d.branch + ', actual ' + actualGit.branch);
  if (d.checkpoint?.git.commit !== actualGit.commit) warnings.push('HEAD changed since checkpoint; inspect commits without resetting');
  if (d.checkpoint?.sourceFingerprint !== sourceFingerprint(root)) warnings.push('Source changed; rerun affected evidence before acceptance');
  for (const task of d.tasks.filter(t => ['accepted', 'completed'].includes(t.status))) {
    const errors = gate(d, task, root); if (errors.length) failures.push(task.id + ' evidence invalid; transition back to testing: ' + errors.join('; '));
  }
  const current = d.tasks.find(t => t.id === d.currentTask), unmetGates = gate(d, current, root);
  const executableTasks = d.tasks.filter(t => !['completed', 'accepted', 'blocked'].includes(t.status) && t.dependsOn.every(id => { const dep = d.tasks.find(x => x.id === id); return dep.status === 'completed' && gate(d, dep, root).length === 0; })).map(t => t.id);
  return { schemaVersion: 2, authorityRevision: control.revision, phase: d.phase, currentTask: current, actualGit, checkpoint: d.checkpoint, ci: d.ci, delegates: d.delegates, protocol: { mobile: d.protocolVersion, desktop: d.desktop.protocolVersion, compatible: d.protocolVersion === d.desktop.protocolVersion }, warnings, failures, unmetGates, executableTasks, read: ['ROADMAP.md', 'PROGRESS.md', '.agent/HANDOFF.md', 'docs/architecture.md', 'docs/decisions/', 'docs/acceptance/'], nextAction: d.nextAction, commands: ['npm test', 'node scripts/agent-validate.mjs', 'gh run list --branch ' + d.branch + ' --limit 5'] };
}
