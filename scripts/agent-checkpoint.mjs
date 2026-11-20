import { createCheckpoint } from './lib/control.mjs';
const args = process.argv.slice(2), note = args.includes('--note') ? args[args.indexOf('--note') + 1] : 'incremental checkpoint';
if (!note) throw new Error('Missing --note value');
const control = createCheckpoint(undefined, note);
console.log(JSON.stringify({ checkpoint: control.data.checkpoint.path, revision: control.revision, commit: control.data.checkpoint.git.commit, sourceFingerprint: control.data.checkpoint.sourceFingerprint }));
