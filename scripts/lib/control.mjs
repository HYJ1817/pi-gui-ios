import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, lstatSync, realpathSync, fsyncSync, constants, readdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateSchema } from './schema.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STATUSES = ['pending', 'in_progress', 'testing', 'reviewing', 'blocked', 'accepted', 'completed'];
export const TRANSITIONS = { pending: ['in_progress', 'blocked'], in_progress: ['testing', 'blocked'], testing: ['in_progress', 'reviewing', 'blocked'], reviewing: ['testing', 'accepted', 'blocked'], blocked: ['in_progress', 'testing'], accepted: ['completed', 'testing', 'blocked'], completed: ['testing'] };
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export function envelope(kind, revision, data, at = new Date().toISOString()) {
  const payload = { schemaVersion: 2, kind, revision, updatedAt: at, data };
  return { ...payload, integrity: { algorithm: 'sha256', digest: digest(stable(payload)) } };
}
export function decode(raw, kind) {
  const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
  validateSchema(e, `${kind}.schema.json`);
  const { integrity, ...payload } = e;
  assert(integrity.digest === digest(stable(payload)), `Integrity mismatch: ${kind}`);
  if (kind === 'control') validateControl(e.data);
  if (kind === 'checkpoint') decode(e.data.control, 'control');
  return e;
}
export function validateControl(d) {
  // Validate the same complete machine-readable contract used for on-disk reads.
  validateSchema(envelope('control', 1, d), 'control.schema.json');
  const ids = new Set(d.tasks.map(t => t.id));
  assert(ids.size === d.tasks.length && ids.has(d.currentTask), 'Duplicate/missing task identity');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert(!visiting.has(id), 'Dependency cycle');
    if (visited.has(id)) return;
    const task = d.tasks.find(t => t.id === id); assert(task, `Missing dependency ${id}`);
    visiting.add(id); task.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  ids.forEach(visit);
  assert(d.tasks.find(t => t.id === d.currentTask).phase === d.phase, 'Current task/phase mismatch');
  for (const ci of d.ci) validateCiRecord(ci);
  assert(new Set(d.ci.map(c => `${c.id}/${c.attempt}`)).size === d.ci.length, 'Duplicate CI attempt');
  return d;
}
function within(root, path) { const r = relative(root, path); return !r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r); }
export function safePath(root, target, { leaf = 'file', allowMissing = false } = {}) {
  root = resolve(root); target = resolve(target);
  assert(within(root, target) && (target !== root || leaf === 'directory'), 'Path escapes repository');
  const rootStat = lstatSync(root); assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Unsafe repository root');
  const realRoot = realpathSync.native(root);
  let current = root;
  const parts = relative(root, target).split(sep);
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    let stat;
    try { stat = lstatSync(current); } catch (error) { if (error.code === 'ENOENT' && allowMissing) return target; throw error; }
    assert(!stat.isSymbolicLink(), 'Symbolic link/junction paths are forbidden');
    assert(within(realRoot, realpathSync.native(current)), 'Real path escapes repository');
    assert(index < parts.length - 1 || leaf === 'directory' ? stat.isDirectory() : stat.isFile(), 'Expected ordinary file/directory');
  }
  return target;
}
export function readSafe(root, path, encoding) { return readFileSync(safePath(root, resolve(root, path)), encoding); }
export function atomicWrite(path, content, root = ROOT) {
  path = safePath(root, path, { allowMissing: true });
  mkdirSync(dirname(path), { recursive: true }); safePath(root, dirname(path), { leaf: 'directory' });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    safePath(root, path, { allowMissing: true }); renameSync(tmp, path);
    assert(digest(readSafe(root, relative(root, path))) === digest(content), 'Atomic write verification failed');
  } finally { if (fd !== undefined) closeSync(fd); if (existsSync(tmp)) unlinkSync(tmp); }
}
export function writeEnvelope(root, path, e) { decode(e, e.kind); atomicWrite(resolve(root, path), `${JSON.stringify(e, null, 2)}\n`, root); }
export function loadControl(root = ROOT) { return decode(readSafe(root, '.agent/control.json', 'utf8'), 'control'); }
export function run(program, args, root = ROOT) {
  const r = spawnSync(program, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? r.error?.message ?? '' };
}
export function git(args, root = ROOT) { return run('git', args, root); }
export function snapshot(root = ROOT) { return { branch: git(['branch', '--show-current'], root).stdout.trim(), commit: git(['rev-parse', '--verify', 'HEAD'], root).stdout.trim() || null, dirty: git(['status', '--short'], root).stdout.trim().split(/\r?\n/).filter(Boolean) }; }
function included(path) { return (!path.startsWith('.agent/') || path.startsWith('.agent/schemas/')) && !path.startsWith('docs/acceptance/') && !['PROGRESS.md', 'docs/source-research.md'].includes(path); }
function hashFiles(entries) { const hash = createHash('sha256'); for (const [path, content] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { hash.update(`${path}\0`); hash.update(content); hash.update('\0'); } return hash.digest('hex'); }

// Scoped evidence (ADR: docs/decisions/0007-scoped-evidence.md). Each evidence
// kind is bound to the named path sets it actually depends on. A file matched
// by NO set is treated as shared — it belongs to every scope, so unknown new
// surfaces fail closed instead of silently evading invalidation.
export const SCOPE_SETS = {
  app: ['src/', 'App.tsx', 'index.ts', 'global.css', 'metro.config.js', 'babel.config.js', 'app.json', 'expo-env.d.ts', 'modules/'],
  tests: ['tests/'],
  'native-build': ['scripts/ci/', 'native/', '.github/', '.maestro/', 'Gemfile', 'Gemfile.lock'],
  control: ['scripts/lib/', 'scripts/agent-', 'scripts/verify.mjs', 'scripts/check-technology-stack.mjs', '.agent/schemas/'],
  protocol: ['scripts/lib/remote-protocol-contract.mjs', 'scripts/desktop-remote-verify.mjs', 'tests/remote-contract.test.mjs', 'docs/contracts/', 'docs/design/', 'docs/remote-protocol.md'],
  meta: ['docs/', 'AGENTS.md', 'REVIEW.md', 'ROADMAP.md', 'README.md', 'THIRD_PARTY_NOTICES.md'],
  // 'shared' is unconditionally part of every evidence kind's scope.
  shared: ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', '.gitattributes'],
};
export const KIND_SCOPES = {
  // npm test literally executes scripts/ci/*, native locks, control lib and the
  // remote contract — broad by fact, not convenience.
  unit: ['app', 'tests', 'control', 'native-build', 'protocol'],
  typecheck: ['app'], bundle: ['app'], doctor: ['app'],
  ci: ['app', 'tests', 'native-build', 'control', 'protocol'],
  ui: ['app', 'native-build'], ipa: ['app', 'native-build'],
  integration: ['protocol', 'control'], 'protocol-contract': ['protocol'],
  'fault-injection': ['app', 'protocol', 'tests'],
  // 'union': scopes of the task's own non-independent required evidence + meta.
  // 'all': every set plus uncovered files — used for fresh-context recovery.
  'independent-review': ['union'],
  'independent-security': ['union', 'native-build'],
  'independent-handoff': ['all'],
  'device-install': ['app', 'native-build'], 'device-upgrade': ['app', 'native-build'],
  'device-network': ['app', 'native-build', 'protocol'],
};
function matchesSet(path, set) { return (SCOPE_SETS[set] ?? []).some(prefix => path === prefix || path.startsWith(prefix)); }
function uncovered(path) { return !Object.keys(SCOPE_SETS).some(set => matchesSet(path, set)); }
export function resolveScopes(task, kind) {
  const declared = task?.evidenceScopes?.[kind] ?? KIND_SCOPES[kind];
  assert(Array.isArray(declared) && declared.length > 0, `No scope binding for evidence kind ${kind}`);
  if (declared.includes('all')) return ['all'];
  const resolved = new Set(['shared']);
  for (const name of declared) {
    if (name === 'union') {
      assert(task, 'union scope requires a task');
      // 'union' expands over the task's non-independent, non-device evidence
      // only — independent evidence kinds are nested unions/all and would
      // otherwise widen the union to every set.
      for (const other of task.requiredEvidence) {
        if (other === kind || other.startsWith('independent-') || other.startsWith('device-') || !(other in KIND_SCOPES)) continue;
        for (const inner of KIND_SCOPES[other]) if (inner !== 'union' && inner !== 'all') resolved.add(inner);
      }
    } else {
      assert(name in SCOPE_SETS, `Unknown evidence scope set ${name}`);
      resolved.add(name);
    }
  }
  return [...resolved].sort();
}
function inScopes(path, scopes) {
  if (scopes[0] === 'all') return true;
  return scopes.some(name => matchesSet(path, name)) || uncovered(path);
}
export function sourceFingerprint(root = ROOT, scopes) {
  const result = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root); assert(result.ok, 'Cannot enumerate source');
  let paths = [...new Set(result.stdout.split('\0').filter(included).filter(Boolean))];
  if (scopes) paths = paths.filter(path => inScopes(path, scopes));
  return hashFiles(paths.map(path => [path, existsSync(resolve(root, path)) ? readSafe(root, path) : Buffer.from('<deleted>')]));
}
const commitCache = new Map();
export function committedFingerprint(root, commit, scopes) {
  assert(COMMIT.test(commit ?? ''), 'Evidence requires a real Git commit');
  const key = `${root}:${commit}:${(scopes ?? []).join(',')}`; if (commitCache.has(key)) return commitCache.get(key);
  const tree = git(['ls-tree', '-rz', '--full-tree', commit], root); assert(tree.ok, 'Evidence commit not available in repository');
  let rows = tree.stdout.split('\0').filter(Boolean).map(row => { const i = row.indexOf('\t'); return { header: row.slice(0, i).split(' '), path: row.slice(i + 1) }; }).filter(row => included(row.path));
  if (scopes) rows = rows.filter(row => inScopes(row.path, scopes));
  assert(rows.length > 0, 'Empty evidence source tree');
  for (const row of rows) assert(['100644', '100755'].includes(row.header[0]), 'Linked/submodule source cannot be accepted');
  const blobs = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: rows.map(r => r.header[2]).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert(blobs.status === 0 && !blobs.error, 'Cannot read evidence source objects');
  let offset = 0; const entries = [];
  for (const row of rows) { const end = blobs.stdout.indexOf(10, offset); assert(end >= 0, 'Invalid Git object stream'); const header = blobs.stdout.subarray(offset, end).toString('utf8').split(' '); assert(header[1] === 'blob' && /^\d+$/.test(header[2]), 'Invalid Git blob'); const size = Number(header[2]); offset = end + 1; entries.push([row.path, blobs.stdout.subarray(offset, offset + size)]); offset += size + 1; }
  const value = hashFiles(entries); commitCache.set(key, value); return value;
}
export function coverageCheck(root = ROOT) {
  // Fail-closed guard: every fingerprinted path must belong to some scope set,
  // otherwise it silently invalidates (or evades) every kind's evidence.
  const result = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root); assert(result.ok, 'Cannot enumerate source');
  const missing = [...new Set(result.stdout.split('\0').filter(included).filter(Boolean))].filter(uncovered);
  return missing;
}
export function evidencePath(root, path) {
  assert(typeof path === 'string' && /^(docs\/acceptance\/|\.agent\/evidence\/)/.test(path) && !path.includes('\\') && !isAbsolute(path), 'Evidence must be inside a dedicated repository evidence directory');
  const normalized = relative(root, resolve(root, path)).split(sep).join('/');
  assert(normalized === path && /^(docs\/acceptance\/|\.agent\/evidence\/)/.test(normalized), 'Evidence path must be canonical and remain in evidence directory');
  return safePath(root, resolve(root, path));
}
function checkFile(root, path, sha256) { assert(SHA.test(sha256 ?? ''), 'Missing evidence file digest'); const file = evidencePath(root, path); const bytes = readFileSync(file); assert(digest(bytes) === sha256, 'Evidence file digest mismatch'); return bytes; }
function validateCiRecord(ci) {
  validateSchema(ci, 'ci.schema.json');
  assert(ci.url === `https://github.com/HYJ1817/pi-gui-ios/actions/runs/${ci.id}`, 'CI URL/identity mismatch');
  assert(ci.status === 'completed' ? ci.conclusion !== null : ci.conclusion === null, 'CI status/conclusion mismatch');
  return ci;
}
export function normalizeCi(raw) {
  assert(raw?.repository?.full_name === 'HYJ1817/pi-gui-ios', 'Unexpected CI repository');
  const ci = { id: String(raw.id ?? ''), head: raw.head_sha, workflow: raw.path, attempt: raw.run_attempt, status: raw.status, conclusion: raw.conclusion || null, url: raw.html_url };
  return validateCiRecord(ci);
}
function scopedFingerprint(ctx, root, scopes) {
  const key = scopes.join(',');
  if (!ctx.fpMemo.has(key)) ctx.fpMemo.set(key, sourceFingerprint(root, scopes));
  return ctx.fpMemo.get(key);
}
export function validateReport(d, task, report, root = ROOT, context) {
  const ctx = context && typeof context === 'object' ? context : { fingerprint: context ?? sourceFingerprint(root), memo: new Map(), fpMemo: new Map() };
  validateSchema(report, 'evidence.schema.json');
  assert(report.taskId === task.id && task.requiredEvidence.includes(report.kind), 'Wrong report task/kind');
  assert(report.passed === true, 'Failure report cannot satisfy acceptance');
  assert(Date.parse(report.finishedAt) >= Date.parse(report.startedAt), 'Invalid evidence time interval');
  const scopes = resolveScopes(task, report.kind);
  if (report.scopeFingerprint === undefined) {
    // Legacy report: produced under the global fingerprint. It remains valid
    // while (a) the report's global fingerprint still equals the committed
    // tree's (it was produced clean at that commit) and (b) the parts this
    // kind actually depends on have not changed since then.
    assert(report.sourceFingerprint === committedFingerprint(root, report.commit) &&
           committedFingerprint(root, report.commit, scopes) === scopedFingerprint(ctx, root, scopes),
           'Evidence is stale or was not produced for committed source');
  } else {
    assert(typeof report.scopeFingerprint === 'string' && SHA.test(report.scopeFingerprint) &&
           Array.isArray(report.scopes) && stable([...report.scopes].sort()) === stable(scopes),
           'Report scope does not match the bound evidence scope');
    assert(report.scopeFingerprint === committedFingerprint(root, report.commit, scopes) &&
           report.scopeFingerprint === scopedFingerprint(ctx, root, scopes),
           'Evidence is stale or was not produced for committed source');
    assert(report.sourceFingerprint === committedFingerprint(root, report.commit),
           'Evidence global fingerprint does not match its commit');
  }
  const details = report.details;
  const commands = { unit: 'npm test', typecheck: 'npm run typecheck', bundle: 'npm run export:ios', doctor: 'node node_modules/expo-doctor/build/index.js' };
  if (commands[report.kind]) {
    assert(details.command === commands[report.kind] && details.exitCode === 0, 'Wrong/failed verification command');
    checkFile(root, details.logPath, details.logSha256);
  } else if (report.kind === 'ci') {
    validateSchema(details.ci, 'ci.schema.json');
    assert(details.ci.head === report.commit && details.ci.status === 'completed' && details.ci.conclusion === 'success', 'CI did not succeed for evidence commit');
    assert(d.ci.some(ci => stable(ci) === stable(details.ci)), 'CI identity/attempt not imported from actual run');
    const raw = JSON.parse(checkFile(root, details.receiptPath, details.receiptSha256));
    assert(stable(normalizeCi(raw)) === stable(details.ci), 'CI API receipt does not match report');
  } else if (report.kind.startsWith('independent-')) {
    const receipt = JSON.parse(checkFile(root, details.receiptPath, details.receiptSha256));
    assert(receipt.latestTerminalStatus === 'completed' && typeof receipt.executedModel === 'string', 'Independent task did not complete');
    const summary = JSON.parse(receipt.summary);
    if (Array.isArray(summary.reports)) assert(new Set(summary.reports.map(r => r.kind)).size === summary.reports.length, 'Duplicate independent result kinds');
    const result = Array.isArray(summary.reports) ? summary.reports.find(r => r.kind === report.kind) : summary;
    assert(result && result.schemaVersion === 1 && result.kind === report.kind && result.decision === 'pass' && result.reviewedCommit === report.commit && result.sourceFingerprint === report.sourceFingerprint && result.unresolvedBlockers === 0 && result.unresolvedImportant === 0, 'Independent review did not pass exact source');
    assert(d.delegates.some(r => r.taskId === receipt.taskId && r.status === 'completed' && r.sourceCommit === report.commit), 'Independent task provenance missing');
    if (report.kind === 'independent-handoff') {
      assert(result.restoredTask === task.id && Array.isArray(result.commands) && result.commands.some(c => typeof c.command === 'string' && c.command.startsWith('node scripts/agent-resume.mjs') && c.exitCode === 0) && result.commands.some(c => ['npm test', 'npm run typecheck', 'npm run check:stack'].includes(c.command) && c.exitCode === 0), 'No actual independent recovery and follow-on verification');
    }
  } else if (report.kind === 'ui') {
    assert(details.nativeGlassVerified === true && details.visualReview === 'pass' && typeof details.reviewerContext === 'string', 'Visual review missing');
    const images = details.screenshots; assert(Array.isArray(images), 'Screenshot manifest missing');
    for (const device of ['iphone', 'ipad']) for (const appearance of ['light', 'dark', 'accessibility']) {
      const image = images.find(i => i.device === device && i.appearance === appearance && i.reviewed === true); assert(image, `Missing ${device}/${appearance} visual evidence`);
      const bytes = checkFile(root, image.path, image.sha256); assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Not a PNG screenshot');
    }
    assert(d.ci.some(c => c.id === details.ciId && c.attempt === details.attempt && c.head === report.commit && c.status === 'completed' && c.conclusion === 'success'), 'UI evidence lacks successful CI provenance');
  } else if (report.kind === 'ipa') {
    const verified = JSON.parse(checkFile(root, details.verificationPath, details.verificationSha256));
    assert(verified.schemaVersion === 2 && verified.passed === true && verified.kind === 'unsigned-device-archive' && verified.code === 'IPA_VERIFIED' && verified.platform === 'iOS' && stable(verified.architectures) === stable(['arm64']) && Number.isInteger(verified.executables) && verified.executables > 0 && verified.sideStoreInstallVerified === false && SHA.test(details.archiveSha256 ?? '') && verified.sha256 === details.archiveSha256, 'Verified final device IPA archive/hash required');
    assert(d.ci.some(c => c.id === details.ciId && c.attempt === details.attempt && c.head === report.commit && c.status === 'completed' && c.conclusion === 'success'), 'IPA evidence lacks successful CI provenance');
  } else if (report.kind.startsWith('device-')) {
    const confirmation = JSON.parse(checkFile(root, details.confirmationPath, details.confirmationSha256));
    assert(confirmation.source === 'user-message' && typeof confirmation.messageId === 'string' && confirmation.messageId.length > 0 && confirmation.commit === report.commit && confirmation.kind === report.kind && confirmation.passed === true && confirmation.simulator === false && typeof confirmation.deviceClass === 'string', 'Actual human device confirmation required');
  } else {
    assert(details.exitCode === 0 && typeof details.command === 'string' && details.command.length > 0, 'Actual contract/integration command required');
    checkFile(root, details.logPath, details.logSha256);
  }
  return report;
}
export function gate(d, task, root = ROOT, context) {
  const ctx = context ?? { fingerprint: sourceFingerprint(root), memo: new Map(), fpMemo: new Map() };
  if (ctx.memo.has(task.id)) return ctx.memo.get(task.id);
  const errors = []; ctx.memo.set(task.id, errors);
  if (!snapshot(root).commit) errors.push('Acceptance requires committed source');
  if (snapshot(root).branch !== d.branch) errors.push('Actual Git branch does not match authority');
  for (const blocker of d.blockers) errors.push(`Unresolved blocker: ${blocker}`);
  for (const id of task.dependsOn) {
    const dependency = d.tasks.find(t => t.id === id);
    if (dependency?.status !== 'completed') errors.push(`Dependency ${id} is not completed`);
    else for (const error of gate(d, dependency, root, ctx)) errors.push(`Dependency ${id}: ${error}`);
  }
  if (task.phase !== 'M-1' && d.desktop.protocolVersion !== d.protocolVersion) errors.push('Desktop/mobile protocol mismatch or unimplemented desktop protocol');
  for (const kind of task.requiredEvidence) {
    const valid = task.evidence.filter(e => e.kind === kind).some(e => {
      try {
        const report = JSON.parse(checkFile(root, e.path, e.sha256));
        assert(report.kind === kind && e.kind === report.kind, 'Evidence kind substitution');
        assert(e.sourceFingerprint === report.sourceFingerprint && e.commit === report.commit, 'Restamped evidence metadata');
        return !!validateReport(d, task, report, root, ctx);
      } catch { return false; }
    });
    if (!valid) errors.push(`Missing/stale/failed evidence: ${kind}`);
  }
  return errors;
}
function projectionFiles(control) {
  const { revision, updatedAt, data: d } = control, parentDigest = control.integrity.digest;
  const common = { authority: '.agent/control.json', parentDigest };
  const state = envelope('state', revision, { ...common, phase: d.phase, currentTask: d.currentTask, branch: d.branch, checkpoint: d.checkpoint, blockers: d.blockers, ci: d.ci, desktop: d.desktop, protocolVersion: d.protocolVersion, delegates: d.delegates }, updatedAt);
  const tasks = envelope('tasks', revision, { ...common, tasks: d.tasks }, updatedAt);
  decode(state, 'state'); decode(tasks, 'tasks');
  const rows = d.tasks.map(t => `| ${t.id} | ${t.status} | ${t.title} |`).join('\n');
  const progress = `# 项目进度（生成文件）\n\n权威：.agent/control.json；schema v2；revision ${revision}；${updatedAt}\n\n阶段：${d.phase}；当前：${d.currentTask}；分支：${d.branch}\n\n| 任务 | 状态 | 范围 |\n| --- | --- | --- |\n${rows}\n\n阻塞：${d.blockers.join('；') || '无已记录阻塞'}\n\n检查点：${d.checkpoint?.path ?? '未保存'}；保存时 HEAD：${d.checkpoint?.git.commit ?? '未提交'}\n\nCI：${d.ci.map(c => `${c.id}/${c.attempt} ${c.status}/${c.conclusion ?? 'pending'} @ ${c.head}`).join('；') || '未启动'}\n\n下一步：${d.nextAction}\n\n证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。\n`;
  const handoff = `# Agent 交接（生成文件）\n\nrevision ${revision}；权威摘要 ${parentDigest}\n\n先读 AGENTS.md / REVIEW.md，执行 node scripts/agent-resume.mjs --remote。\n\n当前 ${d.currentTask}（${d.phase}），预期分支 ${d.branch}。\n\n下一步：${d.nextAction}\n\n阻塞：${d.blockers.join('；') || '无已记录阻塞'}\n\n检查点 ${d.checkpoint?.path ?? '未保存'}；HEAD ${d.checkpoint?.git.commit ?? '未提交'}。dirty（保存时）：\n${d.checkpoint?.git.dirty.map(p => `- ${p}`).join('\n') || '无'}\n\nCI：${JSON.stringify(d.ci)}\n\n独立任务：${JSON.stringify(d.delegates)}\n\n桌面 ${d.desktop.repo}@${d.desktop.commit}，协议 ${d.desktop.protocolVersion ?? '未实现'}；移动协议 ${d.protocolVersion}。运行 resume 获取未通过门禁；不沿用聊天总结，不丢弃 dirty 修改。\n`;
  return { '.agent/state.json': JSON.stringify(state, null, 2) + '\n', '.agent/tasks.json': JSON.stringify(tasks, null, 2) + '\n', 'PROGRESS.md': progress, '.agent/HANDOFF.md': handoff };
}
export function renderProjections(root, control) { for (const [path, content] of Object.entries(projectionFiles(control))) atomicWrite(resolve(root, path), content, root); }
export function withLock(root, fn) {
  const path = safePath(root, resolve(root, '.agent/lock'), { allowMissing: true }); mkdirSync(dirname(path), { recursive: true }); safePath(root, dirname(path), { leaf: 'directory' });
  let fd;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fsyncSync(fd); return fn(); }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(path); } }
}
function commitControl(root, control) {
  decode(control, 'control'); const files = projectionFiles(control); // No invalid authority is committed before rendering is checked.
  for (const path of ['.agent/control.json', ...Object.keys(files)]) safePath(root, resolve(root, path), { allowMissing: true });
  writeEnvelope(root, '.agent/control.json', control);
  for (const [path, content] of Object.entries(files)) atomicWrite(resolve(root, path), content, root);
}
export function mutate(root, fn) {
  return withLock(root, () => { const current = loadControl(root); const next = structuredClone(current.data); fn(next, current); validateControl(next); const control = envelope('control', current.revision + 1, next); commitControl(root, control); return control; });
}
export function repairProjections(root = ROOT) { return withLock(root, () => { const control = loadControl(root); renderProjections(root, control); return control; }); }
export const CHECKPOINT_KEEP = 50;
export function pruneCheckpoints(root, keepPath, keepNames = new Set(), keepCount = CHECKPOINT_KEEP) {
  // Bounded retention: newest `keepCount` v2 snapshots plus any filename still
  // referenced by the live authority (never unlink the recorded checkpoint).
  // Filenames not matching the v2 pattern are never touched.
  const directory = resolve(root, '.agent/checkpoints');
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory).filter(name => /^v2-[a-zA-Z0-9_-]+\.json$/.test(name)).sort().reverse();
  const removable = names.slice(keepCount);
  const pruned = [];
  for (const name of removable) {
    const path = '.agent/checkpoints/' + name;
    if (path === keepPath || keepNames.has(name)) continue;
    const full = safePath(root, resolve(root, path));
    if (lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink()) { unlinkSync(full); pruned.push(path); }
  }
  return pruned;
}
export function createCheckpoint(root = ROOT, note = 'incremental checkpoint') {
  return withLock(root, () => {
    const current = loadControl(root), now = new Date().toISOString(), id = 'v2-' + now.replace(/[^a-zA-Z0-9]/g, '-') + '-' + randomUUID();
    const gitState = snapshot(root), fingerprint = sourceFingerprint(root), path = `.agent/checkpoints/${id}.json`;
    const point = envelope('checkpoint', current.revision, { id, note, control: current, git: gitState, sourceFingerprint: fingerprint }, now);
    writeEnvelope(root, path, point); const bytes = readSafe(root, path); decode(bytes.toString('utf8'), 'checkpoint');
    const next = structuredClone(current.data); next.checkpoint = { id, path, sha256: digest(bytes), authorityDigest: current.integrity.digest, at: now, git: gitState, sourceFingerprint: fingerprint, note };
    const control = envelope('control', current.revision + 1, next, now); commitControl(root, control);
    // Any checkpoint filename still mentioned inside the live authority
    // (current reference, evidence provenance) is protected; keep newest N.
    const referenced = new Set([...JSON.stringify(control.data).matchAll(/\.agent\/checkpoints\/(v2-[a-zA-Z0-9_-]+\.json)/g)].map(m => m[1]));
    pruneCheckpoints(root, path, referenced);
    return control;
  });
}
export function validateCheckpoint(root, control) {
  const point = control.data.checkpoint; assert(point, 'No persisted checkpoint recorded');
  const bytes = readSafe(root, point.path); assert(digest(bytes) === point.sha256, 'Checkpoint file digest mismatch');
  const saved = decode(bytes.toString('utf8'), 'checkpoint');
  assert(point.path === `.agent/checkpoints/${point.id}.json` && saved.data.id === point.id && saved.updatedAt === point.at && saved.data.note === point.note && saved.data.control.integrity.digest === point.authorityDigest && saved.data.sourceFingerprint === point.sourceFingerprint && stable(saved.data.git) === stable(point.git), 'Checkpoint/reference mismatch');
  assert(saved.revision < control.revision, 'Checkpoint revision is not earlier than authority reference');
  return saved;
}
export function restoreCheckpoint(root, path) {
  assert(/^\.agent\/checkpoints\/v2-[a-zA-Z0-9_-]+\.json$/.test(path), 'Choose an explicit v2 checkpoint path');
  return withLock(root, () => {
    const bytes = readSafe(root, path), point = decode(bytes.toString('utf8'), 'checkpoint');
    assert(path === `.agent/checkpoints/${point.data.id}.json`, 'Checkpoint filename/identity mismatch');
    const data = structuredClone(point.data.control.data), actual = snapshot(root);
    assert(actual.branch === data.branch, 'Restore does not switch or reset a mismatched branch');
    let revision = point.revision + 1;
    let authority = null, backup = null;
    try { authority = readSafe(root, '.agent/control.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (authority !== null) {
      try { const current = decode(authority.toString('utf8'), 'control'); revision = Math.max(revision, current.revision); } catch {}
      backup = '.agent/recovery-backups/authority-' + Date.now() + '-' + randomUUID() + '.txt';
      atomicWrite(resolve(root, backup), authority, root);
    }
    let selected = false;
    for (const task of data.tasks) if (['accepted', 'completed'].includes(task.status) && gate(data, task, root).length) { task.status = 'testing'; if (!selected) { data.currentTask = task.id; data.phase = task.phase; selected = true; } }
    data.checkpoint = { id: point.data.id, path, sha256: digest(bytes), authorityDigest: point.data.control.integrity.digest, at: point.updatedAt, git: point.data.git, sourceFingerprint: point.data.sourceFingerprint, note: point.data.note };
    data.nextAction = (authority === null ? '原权威文件缺失，无原文字节可备份；' : '原权威文件已保留本地原文备份；') + '已从显式校验的检查点恢复；先核对 dirty diff、远端和运行中 CI，保留所有源码改动；失效任务已回 testing。';
    const control = envelope('control', revision + 1, data); commitControl(root, control); return { control, backup, authorityWasMissing: authority === null };
  });
}
export function transition(d, id, target, root = ROOT) {
  const task = d.tasks.find(t => t.id === id); assert(task, `Unknown task ${id}`);
  assert(TRANSITIONS[task.status]?.includes(target), `Forbidden transition ${task.status} -> ${target}`);
  if (target === 'in_progress') for (const dep of task.dependsOn) { const dependency = d.tasks.find(t => t.id === dep); assert(dependency.status === 'completed' && gate(d, dependency, root).length === 0, `Dependency ${dep} incomplete or evidence invalid`); }
  if (['accepted', 'completed'].includes(target)) { const errors = gate(d, task, root); assert(!errors.length, errors.join('\n')); }
  task.status = target; task.updatedAt = new Date().toISOString();
  if (target !== 'completed') { d.currentTask = id; d.phase = task.phase; }
}
