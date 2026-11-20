import { ROOT, restoreCheckpoint, createCheckpoint } from './lib/control.mjs';
const [path, apply] = process.argv.slice(2);
if (!path || apply !== '--apply') throw new Error('Inspect the checkpoint first, then: node scripts/agent-restore.mjs .agent/checkpoints/<verified-v2-id>.json --apply');
const result = restoreCheckpoint(ROOT, path); console.log(JSON.stringify({ restoredRevision: result.control.revision, preservedAuthority: result.backup, dirtySourcePreserved: true }));
createCheckpoint(ROOT, '从显式有效检查点恢复，原权威已本地备份且保留dirty源码');
