import { loadControl, gate, sourceFingerprint, snapshot, ROOT, validateCheckpoint } from './lib/control.mjs';
const control = loadControl(), d = control.data;
const id = process.argv.includes('--task') ? process.argv[process.argv.indexOf('--task') + 1] : d.currentTask;
const task = d.tasks.find(t => t.id === id); if (!task) throw new Error('Unknown task');
const errors = gate(d, task);
try { validateCheckpoint(ROOT, control); } catch (error) { errors.push('Checkpoint: ' + error.message); }
console.log(JSON.stringify({ task: id, status: task.status, commit: snapshot().commit, sourceFingerprint: sourceFingerprint(), passed: !errors.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
