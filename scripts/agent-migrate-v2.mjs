import { ROOT, readSafe, digest, stable, envelope, writeEnvelope, renderProjections, atomicWrite, withLock, normalizeCi, createCheckpoint, assert } from './lib/control.mjs';
import { resolve } from 'node:path';
const receiptPath = process.argv[2];
withLock(ROOT, () => {
  const bytes = readSafe(ROOT, '.agent/control.json'), old = JSON.parse(bytes.toString('utf8'));
  assert(old.schemaVersion === 1 && old.kind === 'control', 'Only explicit v1 -> v2 migration is supported');
  const { integrity, ...payload } = old;
  assert(integrity.algorithm === 'sha256' && integrity.digest === digest(stable(payload)), 'Legacy authority integrity failed');
  const backup = `docs/acceptance/legacy-control-v1-revision-${old.revision}.json`;
  atomicWrite(resolve(ROOT, backup), bytes);
  const data = structuredClone(old.data);
  assert(data.tasks.every(t => t.evidence.length === 0), 'Legacy evidence must be manually revalidated; migration never restamps it');
  data.checkpoint = null; data.delegates ??= [];
  if (data.ci.length) {
    assert(receiptPath, 'Supply actual GitHub API receipt to revalidate legacy CI identity');
    const ci = normalizeCi(JSON.parse(readSafe(ROOT, receiptPath, 'utf8')));
    assert(data.ci.length === 1 && data.ci[0].id === ci.id, 'Legacy CI set does not match supplied actual receipt'); data.ci = [ci];
  }
  const control = envelope('control', old.revision + 1, data);
  // Validate/format projections before replacing the authority; snapshot is created immediately below.
  writeEnvelope(ROOT, '.agent/control.json', control); renderProjections(ROOT, control);
  console.log(JSON.stringify({ migratedFrom: 1, migratedTo: 2, backup, revision: control.revision, acceptedEvidence: 0 }));
});
const point = createCheckpoint(ROOT, '显式迁移v1到v2；原状态完整备份，未继承任何通过证据');
console.log(JSON.stringify({ checkpoint: point.data.checkpoint.path }));
