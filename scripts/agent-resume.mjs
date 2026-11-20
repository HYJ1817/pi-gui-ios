import { ROOT, repairProjections, git, run } from './lib/control.mjs';
import { inspectRecovery } from './lib/recovery.mjs';
const args = process.argv.slice(2);
try {
  if (args.includes('--repair-projections')) { repairProjections(); console.log('Rebuilt projections under writer lock from verified authority.'); }
  const result = inspectRecovery(ROOT); console.log(JSON.stringify(result, null, 2));
  if (args.includes('--remote')) {
    const fetch = git(['fetch', '--prune', 'origin']);
    const runs = run('gh', ['run', 'list', '--branch', result.actualGit.branch, '--limit', '5', '--json', 'databaseId,headSha,status,conclusion,url']);
    const refs = git(['ls-remote', '--heads', 'origin', result.actualGit.branch]);
    console.log(JSON.stringify({ remote: { fetch: fetch.ok ? 'ok' : 'unknown', branch: refs.ok ? refs.stdout.trim() : 'unknown', runs: runs.ok ? JSON.parse(runs.stdout) : 'unknown (gh unavailable)' } }, null, 2));
  }
  if (result.failures.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.message, action: 'Preserve dirty work and authority. Inspect .agent/checkpoints/ and Git history; restore only a verified checkpoint. Do not reset or overwrite.' })); process.exitCode = 1;
}
