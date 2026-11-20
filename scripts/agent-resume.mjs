import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadControl, decode, snapshot, gate, git, run, renderProjections, sourceFingerprint } from './lib/control.mjs';
const args = process.argv.slice(2), control = loadControl(), d = control.data, actual = snapshot();
const warnings = [], failures = [];
for (const kind of ['state', 'tasks']) {
  try { const e = decode(readFileSync(resolve(ROOT, '.agent/' + kind + '.json'), 'utf8'), kind); if (e.revision !== control.revision || e.data.parentDigest !== control.integrity.digest) warnings.push(kind + ' projection is stale'); }
  catch { warnings.push(kind + ' projection missing/corrupt'); }
}
if (args.includes('--repair-projections')) { renderProjections(ROOT, control); console.log('Rebuilt projections from verified authority.'); }
if (existsSync(resolve(ROOT, '.agent/lock'))) failures.push('An earlier writer lock exists: inspect PID/liveness and partial changes before manually removing it');
if (actual.branch !== d.branch) failures.push('Branch mismatch: expected ' + d.branch + ', actual ' + actual.branch);
if (d.checkpoint?.git.commit !== actual.commit) warnings.push('HEAD differs from last checkpoint; inspect new commits, do not reset');
if (d.checkpoint?.sourceFingerprint !== sourceFingerprint()) warnings.push('Source differs from checkpoint; previous evidence may be stale');
for (const task of d.tasks.filter(t => ['accepted', 'completed'].includes(t.status))) { const errors = gate(d, task); if (errors.length) failures.push(task.id + ' accepted evidence invalid: ' + errors.join('; ')); }
const current = d.tasks.find(t => t.id === d.currentTask);
const missing = gate(d, current);
console.log(JSON.stringify({ schemaVersion: 1, authorityRevision: control.revision, phase: d.phase, currentTask: current, actualGit: actual, recentCommits: git(['log', '-5', '--oneline']).stdout.trim(), ci: d.ci, protocol: { mobile: d.protocolVersion, desktop: d.desktop.protocolVersion, compatible: d.desktop.protocolVersion === d.protocolVersion }, warnings, failures, unmetGates: missing, executableTasks: d.tasks.filter(t => !['completed', 'accepted', 'blocked'].includes(t.status) && t.dependsOn.every(id => d.tasks.find(x => x.id === id)?.status === 'completed')).map(t => t.id), read: ['ROADMAP.md', 'PROGRESS.md', '.agent/HANDOFF.md', 'docs/architecture.md', 'docs/decisions/0001-persistent-control.md', 'docs/acceptance/'], nextAction: d.nextAction, commands: ['npm test', 'npm run typecheck', 'node scripts/agent-validate.mjs', 'gh run list --branch ' + d.branch + ' --limit 5'] }, null, 2));
if (args.includes('--remote')) {
  const fetch = git(['fetch', '--prune', 'origin']);
  const runs = run('gh', ['run', 'list', '--branch', d.branch, '--limit', '5', '--json', 'databaseId,headSha,status,conclusion,url']);
  const refs = git(['ls-remote', '--heads', 'origin', d.branch]);
  console.log(JSON.stringify({ remote: { fetch: fetch.ok ? 'ok' : 'unknown', branch: refs.ok ? refs.stdout.trim() : 'unknown', runs: runs.ok ? JSON.parse(runs.stdout) : 'unknown (gh failed)' } }, null, 2));
}
if (failures.length) process.exitCode = 1;
