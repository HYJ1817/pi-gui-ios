import { ROOT, repairProjections, git, run, snapshot } from './lib/control.mjs';
import { inspectRecovery, listCheckpoints } from './lib/recovery.mjs';
const args = process.argv.slice(2);
try {
  if (args.includes('--list-checkpoints')) {
    console.log(JSON.stringify({ readOnly: true, actualGit: snapshot(ROOT), checkpointCandidates: listCheckpoints(ROOT) }, null, 2));
  } else {
    if (args.includes('--repair-projections')) { repairProjections(); console.log('Rebuilt projections under writer lock from verified authority.'); }
    const result = inspectRecovery(ROOT); console.log(JSON.stringify(result, null, 2));
    if (args.includes('--remote')) {
      const fetch = git(['fetch', '--prune', 'origin']);
      const runs = run('gh', ['run', 'list', '--branch', result.actualGit.branch, '--limit', '5', '--json', 'databaseId,headSha,status,conclusion,url']);
      const refs = git(['ls-remote', '--heads', 'origin', result.actualGit.branch]);
      console.log(JSON.stringify({ remote: { fetch: fetch.ok ? 'ok' : 'unknown', branch: refs.ok ? refs.stdout.trim() : 'unknown', runs: runs.ok ? JSON.parse(runs.stdout) : 'unknown (gh unavailable)' } }, null, 2));
    }
    if (result.failures.length) process.exitCode = 1;
  }
} catch (error) {
  let candidates = [], diagnosisError = null;
  try { candidates = listCheckpoints(ROOT); } catch (failure) { diagnosisError = failure.message; }
  const actualGit = snapshot(ROOT), latest = candidates.find(candidate => candidate.valid && candidate.branch === actualGit.branch);
  console.error(JSON.stringify({ passed: false, error: error.message, readOnly: !args.includes('--repair-projections'), actualGit, checkpointCandidates: candidates, diagnosisError, nextCommand: latest ? 'node scripts/agent-restore.mjs ' + latest.path + ' --apply' : null, action: 'Preserve dirty work and authority. Inspect the validated candidate and Git diff before using restore; no reset or automatic overwrite occurs.' }, null, 2));
  process.exitCode = 1;
}
