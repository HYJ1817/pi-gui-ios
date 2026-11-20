import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, atomicWrite, sourceFingerprint, snapshot } from './lib/control.mjs';
const kind = process.argv[2];
const commands = {
  unit: ['--test', 'tests/control.test.mjs'],
  typecheck: ['node_modules/typescript/bin/tsc', '--noEmit'],
  bundle: ['node_modules/expo/bin/cli', 'export', '--platform', 'ios', '--output-dir', 'dist/ios', '--no-bytecode'],
  doctor: ['node_modules/expo-doctor/build/index.js'],
};
if (!commands[kind]) throw new Error('Use unit, typecheck, bundle, doctor');
const startedAt = new Date().toISOString(), fingerprint = sourceFingerprint();
const r = spawnSync(process.execPath, commands[kind], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
const output = (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? '');
const report = { schemaVersion: 1, kind, command: 'node ' + commands[kind].join(' '), commit: snapshot().commit, sourceFingerprint: fingerprint, startedAt, finishedAt: new Date().toISOString(), exitCode: r.status ?? 1, passed: r.status === 0 && fingerprint === sourceFingerprint(), output };
atomicWrite(resolve(ROOT, 'docs/acceptance/local-' + kind + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(output); console.log(JSON.stringify({ kind, passed: report.passed, exitCode: report.exitCode, sourceFingerprint: fingerprint }));
if (!report.passed) process.exitCode = 1;
