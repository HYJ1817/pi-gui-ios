import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STATUSES = ['pending', 'in_progress', 'testing', 'reviewing', 'blocked', 'accepted', 'completed'];
export const TRANSITIONS = {
  pending: ['in_progress', 'blocked'], in_progress: ['testing', 'blocked'],
  testing: ['in_progress', 'reviewing', 'blocked'], reviewing: ['testing', 'accepted', 'blocked'],
  blocked: ['in_progress', 'testing'], accepted: ['completed', 'testing', 'blocked'], completed: ['testing'],
};
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export function envelope(kind, revision, data, at = new Date().toISOString()) {
  const payload = { schemaVersion: 1, kind, revision, updatedAt: at, data };
  return { ...payload, integrity: { algorithm: 'sha256', digest: digest(stable(payload)) } };
}
export function decode(raw, kind) {
  const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!e || e.schemaVersion !== 1 || e.kind !== kind || !Number.isSafeInteger(e.revision) || e.revision < 1 || !Number.isFinite(Date.parse(e.updatedAt))) throw new Error(`Invalid ${kind} schema/version`);
  const { integrity, ...payload } = e;
  if (integrity?.algorithm !== 'sha256' || integrity.digest !== digest(stable(payload))) throw new Error(`Integrity mismatch: ${kind}`);
  if (kind === 'control') validateControl(e.data);
  return e;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
export function validateControl(d) {
  assert(d && typeof d.phase === 'string' && typeof d.branch === 'string' && Number.isInteger(d.protocolVersion), 'Invalid control state');
  assert(Array.isArray(d.tasks) && d.tasks.length > 0 && Array.isArray(d.ci) && Array.isArray(d.blockers), 'Invalid control collections');
  assert(d.desktop && typeof d.desktop.commit === 'string' && d.desktop.repo === 'HYJ1817/pi-gui', 'Invalid desktop baseline');
  const ids = new Set(d.tasks.map(t => t.id));
  assert(ids.size === d.tasks.length && ids.has(d.currentTask), 'Duplicate/missing task identity');
  for (const t of d.tasks) {
    assert(typeof t.id === 'string' && typeof t.title === 'string' && typeof t.phase === 'string' && STATUSES.includes(t.status), 'Invalid task');
    assert(Array.isArray(t.dependsOn) && t.dependsOn.every(id => ids.has(id) && id !== t.id), 'Invalid task dependency');
    assert(Array.isArray(t.requiredEvidence) && t.requiredEvidence.every(k => typeof k === 'string') && Array.isArray(t.evidence), 'Invalid task evidence contract');
    assert(typeof t.acceptance === 'string', 'Missing acceptance conditions');
    for (const e of t.evidence) assert(typeof e.kind === 'string' && typeof e.path === 'string' && /^[a-f0-9]{64}$/.test(e.sha256) && /^[a-f0-9]{64}$/.test(e.sourceFingerprint) && typeof e.passed === 'boolean', 'Invalid evidence schema');
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert(!visiting.has(id), 'Dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id); d.tasks.find(t => t.id === id).dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  ids.forEach(visit);
  for (const ci of d.ci) assert(typeof ci.id === 'string' && typeof ci.head === 'string' && ['queued', 'in_progress', 'completed', 'unknown'].includes(ci.status), 'Invalid CI identity/state');
  return d;
}
export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(tmp, 'wx'); writeFileSync(fd, content); closeSync(fd); fd = undefined;
    renameSync(tmp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}
export function writeEnvelope(root, path, e) { atomicWrite(resolve(root, path), `${JSON.stringify(e, null, 2)}\n`); }
export function loadControl(root = ROOT) { return decode(readFileSync(resolve(root, '.agent/control.json'), 'utf8'), 'control'); }
export function run(program, args, root = ROOT) {
  const r = spawnSync(program, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? r.error?.message ?? '' };
}
export function git(args, root = ROOT) { return run('git', args, root); }
export function snapshot(root = ROOT) {
  return { branch: git(['branch', '--show-current'], root).stdout.trim(), commit: git(['rev-parse', '--verify', 'HEAD'], root).stdout.trim() || null, dirty: git(['status', '--short'], root).stdout.trim().split(/\r?\n/).filter(Boolean) };
}
export function sourceFingerprint(root = ROOT) {
  const result = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root);
  if (!result.ok) throw new Error('Cannot enumerate source files');
  const files = [...new Set(result.stdout.split('\0').filter(Boolean))].filter(p => !p.startsWith('.agent/') && !p.startsWith('docs/acceptance/') && !['PROGRESS.md', 'docs/source-research.md'].includes(p));
  const hash = createHash('sha256');
  for (const p of files.sort()) {
    const path = resolve(root, p);
    hash.update(`${p}\0`);
    hash.update(existsSync(path) ? readFileSync(path) : '<deleted>'); hash.update('\0');
  }
  return hash.digest('hex');
}
export function evidencePath(root, path) {
  assert(typeof path === 'string' && !isAbsolute(path) && !path.includes('\\'), 'Evidence path must be repository relative');
  const absolute = resolve(root, path), rel = relative(root, absolute);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Evidence path escapes repository');
  return absolute;
}
export function gate(d, task, root = ROOT) {
  const errors = [];
  for (const id of task.dependsOn) if (d.tasks.find(t => t.id === id)?.status !== 'completed') errors.push(`Dependency ${id} is not completed`);
  if (task.phase !== 'M-1' && d.desktop.protocolVersion !== d.protocolVersion) errors.push('Desktop/mobile protocol mismatch or unimplemented desktop protocol');
  const fingerprint = sourceFingerprint(root);
  for (const kind of task.requiredEvidence) {
    const matching = task.evidence.filter(e => e.kind === kind && e.passed && e.sourceFingerprint === fingerprint);
    const valid = matching.some(e => {
      try { const path = evidencePath(root, e.path); return existsSync(path) && digest(readFileSync(path)) === e.sha256; } catch { return false; }
    });
    if (!valid) errors.push(`Missing/stale/failed evidence: ${kind}`);
  }
  return errors;
}
export function renderProjections(root, control) {
  const { revision, updatedAt, data: d } = control;
  const parentDigest = control.integrity.digest;
  writeEnvelope(root, '.agent/state.json', envelope('state', revision, { authority: '.agent/control.json', parentDigest, phase: d.phase, currentTask: d.currentTask, branch: d.branch, checkpoint: d.checkpoint ?? null, blockers: d.blockers, ci: d.ci, desktop: d.desktop, protocolVersion: d.protocolVersion }, updatedAt));
  writeEnvelope(root, '.agent/tasks.json', envelope('tasks', revision, { authority: '.agent/control.json', parentDigest, tasks: d.tasks }, updatedAt));
  const rows = d.tasks.map(t => `| ${t.id} | ${t.status} | ${t.title} |`).join('\n');
  atomicWrite(resolve(root, 'PROGRESS.md'), `# 项目进度（生成文件）\n\n权威：.agent/control.json；revision ${revision}；${updatedAt}\n\n阶段：${d.phase}；当前：${d.currentTask}；分支：${d.branch}\n\n| 任务 | 状态 | 范围 |\n| --- | --- | --- |\n${rows}\n\n阻塞：${d.blockers.length ? d.blockers.join('；') : '尚无已记录阻塞'}\n\n检查点：${d.checkpoint?.id ?? '未保存'}；代码 HEAD：${d.checkpoint?.git.commit ?? '未提交'}\n\nCI：${d.ci.length ? d.ci.map(c => `${c.id} ${c.status}/${c.conclusion ?? 'pending'} @ ${c.head}`).join('；') : '未启动'}\n\n下一步：${d.nextAction}\n\n测试/审查真实证据见 control 各任务 evidence 与 docs/acceptance/；未登记不视为通过。\n`);
  atomicWrite(resolve(root, '.agent/HANDOFF.md'), `# Agent 交接（生成文件）\n\nrevision ${revision}；权威摘要 ${parentDigest}\n\n先读 AGENTS.md / REVIEW.md，执行 node scripts/agent-resume.mjs --remote。\n\n当前任务 ${d.currentTask}（${d.phase}），预期分支 ${d.branch}。\n\n下一步：${d.nextAction}\n\n阻塞：${d.blockers.join('；') || '无已记录阻塞'}\n\n上次 HEAD：${d.checkpoint?.git.commit ?? '未提交'}\n\n检查点 dirty（保存时）：\n${d.checkpoint?.git.dirty.map(p => `- ${p}`).join('\n') || '无'}\n\nCI：${JSON.stringify(d.ci)}\n\n未通过项：运行 resume 获取实时 gate，不沿用聊天总结。CI 运行中先按 run ID 读取状态，不重复触发。desktop=${d.desktop.repo}@${d.desktop.commit}，协议=${d.desktop.protocolVersion ?? '未实现'}；移动协议=${d.protocolVersion}。未做桌面改动。\n`);
}
export function mutate(root, fn) {
  const lock = resolve(root, '.agent/lock'); mkdirSync(dirname(lock), { recursive: true });
  let fd;
  try {
    fd = openSync(lock, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const current = loadControl(root); fn(current.data, current);
    validateControl(current.data);
    const next = envelope('control', current.revision + 1, current.data);
    writeEnvelope(root, '.agent/control.json', next); renderProjections(root, next); return next;
  } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
export function transition(d, id, target, root = ROOT) {
  const task = d.tasks.find(t => t.id === id); assert(task, `Unknown task ${id}`);
  assert(TRANSITIONS[task.status]?.includes(target), `Forbidden transition ${task.status} -> ${target}`);
  if (target === 'in_progress') for (const dep of task.dependsOn) assert(d.tasks.find(t => t.id === dep)?.status === 'completed', `Dependency ${dep} not completed`);
  if (['accepted', 'completed'].includes(target)) { const errors = gate(d, task, root); assert(!errors.length, errors.join('\n')); }
  task.status = target; task.updatedAt = new Date().toISOString();
  if (target !== 'completed') { d.currentTask = id; d.phase = task.phase; }
}
