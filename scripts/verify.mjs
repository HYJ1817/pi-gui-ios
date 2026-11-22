import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, atomicWrite, sourceFingerprint, snapshot, loadControl, digest, createCheckpoint } from './lib/control.mjs';
const kind = process.argv[2];
const commands = {
  unit: { program: 'npm', args: ['test'], label: 'npm test' },
  typecheck: { program: 'npm', args: ['run', 'typecheck'], label: 'npm run typecheck' },
  bundle: { program: 'npm', args: ['run', 'export:ios'], label: 'npm run export:ios' },
  doctor: { program: process.execPath, args: ['node_modules/expo-doctor/build/index.js'], label: 'node node_modules/expo-doctor/build/index.js' },
  'protocol-contract': { program: process.execPath, args: ['--test', 'tests/remote-contract.test.mjs'], label: 'node --test tests/remote-contract.test.mjs' },
  // M1-remote integration: runs the desktop worktree's canonical remote/v1
  // suites (contract 33 + gateway e2e 11) pinned to authority desktop.commit.
  integration: { program: process.execPath, args: ['scripts/desktop-remote-verify.mjs'], label: 'node scripts/desktop-remote-verify.mjs' },
};
const command = commands[kind]; if (!command) throw new Error('Use unit, typecheck, bundle, doctor, protocol-contract, integration');
const startedAt = new Date().toISOString(), fingerprint = sourceFingerprint(), commit = snapshot().commit;
if (!commit) throw new Error('Commit the initial source before producing acceptance reports');
const npmCli = command.program === 'npm' ? [process.env.npm_execpath, resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(path => path?.endsWith('npm-cli.js') && existsSync(path)) : null;
if (command.program === 'npm' && !npmCli) throw new Error('Cannot locate the installed npm CLI; no shell fallback is allowed');
const args = command.program === 'npm' ? [npmCli, ...command.args] : command.args;
const r = spawnSync(process.execPath, args, { cwd: ROOT, shell: false, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
const output = (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? '');
const logPath = 'docs/acceptance/local-' + kind + '-output.txt'; atomicWrite(resolve(ROOT, logPath), output);
const report = { schemaVersion: 2, kind, taskId: loadControl().data.currentTask, commit, sourceFingerprint: fingerprint, startedAt, finishedAt: new Date().toISOString(), passed: r.status === 0 && fingerprint === sourceFingerprint(), details: { command: command.label, exitCode: r.status ?? 1, logPath, logSha256: digest(output) } };
atomicWrite(resolve(ROOT, 'docs/acceptance/local-' + kind + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(output); console.log(JSON.stringify({ kind, passed: report.passed, exitCode: report.details.exitCode, sourceFingerprint: fingerprint, commit }));
createCheckpoint(ROOT, '实际运行 ' + command.label + '，exit=' + report.details.exitCode);
if (!report.passed) process.exitCode = 1;
