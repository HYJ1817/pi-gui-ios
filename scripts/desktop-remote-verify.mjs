import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadControl, run } from './lib/control.mjs';
import { PROTOCOL_COPY_NORMALIZER, PROTOCOL_COPY_TYPESCRIPT, protocolCopySha256, sha256 } from './lib/protocol-copy.mjs';

/**
 * Desktop worktree integration check for M1-remote (remote/v1 gateway).
 *
 * Runs the frozen contract's canonical unit suite AND the end-to-end TLS
 * gateway suite inside the registered desktop worktree
 * (.agent/control.json -> desktop.{repo,branch,commit}), after asserting the
 * worktree is clean and pinned to that exact commit. Checks both protocol
 * copies and contract JSON against the offline desktop pin before running
 * either suite. Emits the raw combined
 * log to stdout (verify.mjs captures it); exits non-zero on any mismatch or
 * failure so the evidence report is fail-closed.
 *
 * Location is env-overridable: PI_GUI_DESKTOP_WORKTREE (default
 * C:/pi-GUI-remote-protocol per ADR 0005 装配点).
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = JSON.parse(readFileSync(new URL('../tests/fixtures/remote-protocol-pin.json', import.meta.url), 'utf8'));

// Export the read-only preflight so offline synthetics exercise the same gate.
export function verifyDesktopWorktree(worktree, desktop) {
  const gitCheck = args => {
    const r = run('git', ['--no-optional-locks', ...args], worktree);
    if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.slice(0, 300)}`);
    return r.stdout.trim();
  };
  const branch = gitCheck(['branch', '--show-current']);
  if (branch !== desktop.branch) throw new Error(`branch mismatch: ${branch} !== ${desktop.branch}`);
  const commit = gitCheck(['rev-parse', '--verify', 'HEAD']);
  if (commit !== desktop.commit) throw new Error(`HEAD mismatch: ${commit} !== ${desktop.commit}`);
  const dirty = gitCheck(['status', '--short', '--untracked-files=all']).split(/\r?\n/).filter(Boolean);
  if (dirty.length) throw new Error(`worktree not clean (${dirty.length} entries): ${dirty.slice(0, 10).join(', ')}`);
}

export function verifyProtocolParity(worktree) {
  if (PIN.schemaVersion !== 1 || PIN.normalizer !== PROTOCOL_COPY_NORMALIZER || PIN.typescript !== PROTOCOL_COPY_TYPESCRIPT) {
    throw new Error('Protocol normalizer/version mismatch; review the immutable desktop pin');
  }
  const copies = [
    { label: 'mobile', source: resolve(ROOT, 'scripts/lib/remote-protocol-contract.mjs'), contract: resolve(ROOT, 'docs/contracts/remote-v1.json') },
    { label: 'desktop', source: resolve(worktree, PIN.desktop.protocolPath), contract: resolve(worktree, PIN.desktop.contractPath) },
  ];
  for (const copy of copies) {
    if (sha256(readFileSync(copy.contract)) !== PIN.desktop.contractSha256) throw new Error(`${copy.label} contract JSON drift`);
    if (protocolCopySha256(readFileSync(copy.source, 'utf8')) !== PIN.normalizedSha256) throw new Error(`${copy.label} normalized protocol copy drift`);
  }
  return { normalizedSha256: PIN.normalizedSha256, contractSha256: PIN.desktop.contractSha256 };
}

function main() {
  const desktop = loadControl(ROOT).data.desktop;
  if (desktop.repo !== PIN.desktop.repo || desktop.commit !== PIN.desktop.commit) {
    throw new Error('Registered desktop does not match the immutable protocol pin');
  }
  const worktree = realpathSync(process.env.PI_GUI_DESKTOP_WORKTREE || 'C:/pi-GUI-remote-protocol');
  console.log(`desktop repo      ${desktop.repo}`);
  console.log(`expected branch   ${desktop.branch}`);
  console.log(`expected commit   ${desktop.commit}`);
  console.log(`protocolVersion   ${desktop.protocolVersion}`);
  // The verified repository/commit are sufficient public provenance; keep the
  // machine-local checkout path out of an otherwise publishable success log.
  verifyDesktopWorktree(worktree, desktop);
  console.log('worktree pinned + clean: OK');
  const parity = verifyProtocolParity(worktree);
  console.log(`normalized copy   ${parity.normalizedSha256}`);
  console.log(`contract JSON     ${parity.contractSha256}`);
  console.log('desktop/mobile protocol parity: OK');

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
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`desktop-remote-verify: ${error.message}`);
    process.exitCode = 1;
  }
}
