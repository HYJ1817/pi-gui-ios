import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, atomicWrite, sourceFingerprint, snapshot, loadControl, digest, createCheckpoint } from './lib/control.mjs';
const kind = process.argv[2];
const commands = {
  unit: { program: 'npm', args: ['test'], label: 'npm test' },
  typecheck: { program: 'npm', args: ['run', 'typecheck'], label: 'npm run typecheck' },
  bundle: { program: 'npm', args: ['run', 'export:ios'], label: 'npm run export:ios' },
  doctor: { program: process.execPath, args: ['node_modules/expo-doctor/build/index.js'], label: 'node node_modules/expo-doctor/build/index.js' },
};
const command = commands[kind]; if (!command) throw new Error('Use unit, typecheck, bundle, doctor');
const startedAt = new Date().toISOString(), fingerprint = sourceFingerprint(), commit = snapshot().commit;
if (!commit) throw new Error('Commit the initial source before producing acceptance reports');
// Shell is needed only for Windows npm.cmd; executable/arguments are a closed table, never user input.
const r = spawnSync(command.program, command.args, { cwd: ROOT, shell: process.platform === 'win32' && command.program === 'npm', encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
const output = (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? '');
const logPath = 'docs/acceptance/local-' + kind + '-output.txt'; atomicWrite(resolve(ROOT, logPath), output);
const report = { schemaVersion: 2, kind, taskId: loadControl().data.currentTask, commit, sourceFingerprint: fingerprint, startedAt, finishedAt: new Date().toISOString(), passed: r.status === 0 && fingerprint === sourceFingerprint(), details: { command: command.label, exitCode: r.status ?? 1, logPath, logSha256: digest(output) } };
atomicWrite(resolve(ROOT, 'docs/acceptance/local-' + kind + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(output); console.log(JSON.stringify({ kind, passed: report.passed, exitCode: report.details.exitCode, sourceFingerprint: fingerprint, commit }));
createCheckpoint(ROOT, '实际运行 ' + command.label + '，exit=' + report.details.exitCode);
if (!report.passed) process.exitCode = 1;
