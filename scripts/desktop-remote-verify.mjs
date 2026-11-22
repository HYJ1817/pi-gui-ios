import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadControl, run } from './lib/control.mjs';

/**
 * Desktop worktree integration check for M1-remote (remote/v1 gateway).
 *
 * Runs the frozen contract's canonical unit suite AND the end-to-end TLS
 * gateway suite inside the registered desktop worktree
 * (.agent/control.json -> desktop.{repo,branch,commit}), after asserting the
 * worktree is clean and pinned to that exact commit. Emits the raw combined
 * log to stdout (verify.mjs captures it); exits non-zero on any mismatch or
 * failure so the evidence report is fail-closed.
 *
 * Location is env-overridable: PI_GUI_DESKTOP_WORKTREE (default
 * C:/pi-GUI-remote-protocol per ADR 0005 装配点).
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = loadControl(ROOT).data.desktop;
const worktree = realpathSync(process.env.PI_GUI_DESKTOP_WORKTREE || 'C:/pi-GUI-remote-protocol');

const fail = (msg, code = 1) => { console.error(`desktop-remote-verify: ${msg}`); process.exit(code); };
const gitCheck = args => { const r = run('git', args, worktree); return r.ok ? r.stdout.trim() : fail(`git ${args.join(' ')} failed: ${r.stderr.slice(0, 300)}`); };

console.log(`desktop repo      ${desktop.repo}`);
console.log(`expected branch   ${desktop.branch}`);
console.log(`expected commit   ${desktop.commit}`);
console.log(`protocolVersion   ${desktop.protocolVersion}`);
console.log(`worktree          ${worktree}`);

const branch = gitCheck(['branch', '--show-current']);
if (branch !== desktop.branch) fail(`branch mismatch: ${branch} !== ${desktop.branch}`);
const commit = gitCheck(['rev-parse', '--verify', 'HEAD']);
if (commit !== desktop.commit) fail(`HEAD mismatch: ${commit} !== ${desktop.commit}`);
const dirty = run('git', ['status', '--short'], worktree).stdout.trim().split(/\r?\n/).filter(Boolean);
if (dirty.length) fail(`worktree not clean (${dirty.length} entries): ${dirty.slice(0, 10).join(', ')}`);
console.log('worktree pinned + clean: OK');

const steps = [
  { label: 'remote contract suite', args: ['--test', 'tests/remote-contract.test.mjs'] },
  { label: 'remote gateway e2e', args: ['tests/remote-gateway.cjs'] },
];
let failed = false;
for (const step of steps) {
  console.log(`\n== ${step.label}: node ${step.args.join(' ')} ==`);
  const r = spawnSync(process.execPath, step.args, { cwd: worktree, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  console.log(`-- ${step.label} exit=${r.status ?? 'err'}`);
  if (r.status !== 0) failed = true;
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
