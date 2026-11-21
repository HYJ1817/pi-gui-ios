import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/control.mjs';

const PYTHON = [process.env.PYTHON, 'python3', 'python'].filter(Boolean).find(p => spawnSync(p, ['-I', '-c', 'import sys; assert sys.version_info >= (3,11)']).status === 0);
assert.ok(PYTHON, 'Python >=3.11 required for dependency filesystem checks');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-inventory-synthetic-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/ci', 'ios/Pods', 'node_modules', 'native', 'private']) mkdirSync(join(root, dir), { recursive: true });
  for (const name of ['native-dependencies.py', 'verify-ipa.py', 'verify-template.py', 'validate-locks.rb']) cpSync(join(ROOT, 'scripts/ci', name), join(root, 'scripts/ci', name));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  for (const file of ['Gemfile', 'ios/Podfile', 'private/Gemfile.lock', 'private/Podfile.lock']) writeFileSync(join(root, file), 'synthetic fixture only');
  return root;
}
function py(root, body, ...args) {
  const code = `import importlib.util,pathlib,json,os,stat,shutil,posixpath\ns=importlib.util.spec_from_file_location('inventory',pathlib.Path('scripts/ci/native-dependencies.py')); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nroot=pathlib.Path.cwd(); pods=root/'ios/Pods'; npm=root/'node_modules'\n${body}`;
  return spawnSync(PYTHON, ['-I', '-c', code, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
}
function passed(result, marker) { assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout.trim(), marker); }
const reject = `
try: m.inventory(root)
except m.GateError as error: assert str(error) == 'NATIVE_PREBUILT_LINK_REJECTED', str(error)
else: raise AssertionError('unsafe link accepted or omitted')
print('UNAPPROVED_LINK_REJECTED')`;

// These probes exercise the exact omitted directory/file branches on Windows,
// where POSIX link creation needs an unavailable privilege. Real links below
// execute on POSIX as part of canonical npm test, not as mock-positive evidence.
for (const tree of ['ios/Pods', 'node_modules']) for (const entry of ['directory', 'file']) test(`unapproved extensionless ${entry} link cannot disappear from ${tree} inventory`, t => {
  passed(py(fixture(t), `
from unittest.mock import patch
from types import SimpleNamespace
base=root/${JSON.stringify(tree)}; alias=base/'unapproved'; outside=root/'outside'; outside.mkdir()
(outside/'hidden-native.a').write_bytes(b'synthetic native')
original=pathlib.Path.lstat
fake=SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_nlink=1)
def lstat(path,*args,**kwargs):
 if path == alias: return fake
 return original(path,*args,**kwargs)
def walk(path,**kwargs):
 if path == base: yield (str(base),['unapproved'] if ${JSON.stringify(entry)} == 'directory' else [],['unapproved'] if ${JSON.stringify(entry)} == 'file' else [])
 else: yield (str(path),[],[])
with patch.object(pathlib.Path,'lstat',lstat),patch.object(os,'walk',walk):
 ${reject.trim().replaceAll('\n', '\n ')}
`), 'UNAPPROVED_LINK_REJECTED');
});

const binSetup = `
lock={'lockfileVersion':3,'packages':{
 'node_modules/@synthetic/tool':{'version':'1.0.0','bin':{'tool':'./bin/cli'}},
 'node_modules/@synthetic/tool/node_modules/helper':{'version':'1.0.0','bin':{'helper':'bin/helper'}}}}
(root/'package-lock.json').write_text(json.dumps(lock))
for owner,config in lock['packages'].items():
 physical=root/owner/next(iter(config['bin'].values())); physical.parent.mkdir(parents=True,exist_ok=True); physical.write_bytes(b'synthetic command')
`;

test('locked package bin declarations produce finite root and nested scoped paths', t => {
  passed(py(fixture(t), binSetup + `
rules=m.npm_bin_rules(root)
assert set(rules) == {'npm/.bin/tool','npm/@synthetic/tool/node_modules/.bin/helper'}
assert set(rules['npm/.bin/tool']) == {'../@synthetic/tool/bin/cli'}
assert set(rules['npm/@synthetic/tool/node_modules/.bin/helper']) == {'../helper/bin/helper'}
assert rules['npm/.bin/tool']['../@synthetic/tool/bin/cli']['owner'] == 'npm/@synthetic/tool'
print('SCOPED_AND_NESTED_BIN_DECLARATIONS_BOUND')`), 'SCOPED_AND_NESTED_BIN_DECLARATIONS_BOUND');
});

test('the actual package lock bin policy is bounded and preserves all three reviewed collisions', t => {
  const root = fixture(t); cpSync(join(ROOT, 'package-lock.json'), join(root, 'package-lock.json'));
  passed(py(root, `
rules=m.npm_bin_rules(root)
assert len(rules) == 42
assert {name for name,targets in rules.items() if len(targets)>1} == {'npm/.bin/fingerprint','npm/.bin/expo-modules','npm/.bin/expo-modules-autolinking'}
assert set(rules['npm/.bin/expo']) == {'../expo/bin/cli'}
print('ACTUAL_LOCK_BIN_CONTRACT')`), 'ACTUAL_LOCK_BIN_CONTRACT');
});
for (const [name, mutation] of [
  ['absolute bin', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']='/outside/cli'`],
  ['escaping bin', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']='../outside/cli'`],
  ['redundant bin components', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']='bin/../cli'`],
  ['backslash bin', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']='bin\\\\cli'`],
  ['drive bin', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']='C:/cli'`],
  ['escaping command', `lock['packages']['node_modules/@synthetic/tool']['bin']={'../tool':'bin/cli'}`],
  ['non-string target', `lock['packages']['node_modules/@synthetic/tool']['bin']['tool']=False`],
  ['non-object package', `lock['packages']['node_modules/@synthetic/tool']=[]`],
  ['workspace link', `lock['packages']['node_modules/@synthetic/tool']['link']=True`],
  ['escaping owner', `lock['packages']['../outside']={'bin':{'tool':'bin/cli'}}`],
  ['unsupported lock version', `lock['lockfileVersion']=1`],
]) test(`reject malformed npm link declaration: ${name}`, t => {
  passed(py(fixture(t), binSetup + mutation + `
(root/'package-lock.json').write_text(json.dumps(lock))
try: m.npm_bin_rules(root)
except m.GateError: pass
else: raise AssertionError('unsafe bin declaration accepted')
print('BAD_DECLARATION_REJECTED')`), 'BAD_DECLARATION_REJECTED');
});
test('duplicate lock JSON keys cannot replace an audited bin declaration', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{},"packages":{"node_modules/unknown":{"bin":{"tool":"bin/cli"}}}}');
  passed(py(root, `
try: m.npm_bin_rules(root)
except m.GateError: pass
else: raise AssertionError('duplicate lock keys accepted')
print('DUPLICATE_LOCK_KEYS_REJECTED')`), 'DUPLICATE_LOCK_KEYS_REJECTED');
});

if (process.platform === 'win32') {
  for (const tree of ['ios/Pods', 'node_modules']) for (const name of ['ordinary', '.bin/tool', 'Headers/Public/Synthetic/header.h']) test(`reject actual Windows directory junction in ${tree}/${name}`, t => {
    const root = fixture(t); const link = join(root, tree, name); const outside = join(root, 'outside');
    mkdirSync(join(link, '..'), { recursive: true }); mkdirSync(outside); writeFileSync(join(outside, 'hidden-native.a'), 'synthetic');
    symlinkSync(outside, link, 'junction'); passed(py(root, reject), 'UNAPPROVED_LINK_REJECTED');
  });
} else {
  for (const tree of ['ios/Pods', 'node_modules']) for (const kind of ['directory', 'file', 'dangling']) test(`real POSIX ${kind} link without native suffix is rejected in ${tree}`, t => {
    passed(py(fixture(t), `
base=root/${JSON.stringify(tree)}; outside=root/'outside'; outside.mkdir(); (outside/'hidden-native.a').write_bytes(b'synthetic native')
target=outside if ${JSON.stringify(kind)} == 'directory' else outside/('hidden-native.a' if ${JSON.stringify(kind)} == 'file' else 'missing')
os.symlink(str(target),base/'ordinary',target_is_directory=target.is_dir())
` + reject), 'UNAPPROVED_LINK_REJECTED');
  });
  const linkBins = `
(npm/'.bin').mkdir()
os.symlink('../@synthetic/tool/bin/cli',npm/'.bin/tool')
nested=npm/'@synthetic/tool/node_modules/.bin'; nested.mkdir()
os.symlink('../helper/bin/helper',nested/'helper')
`;
  test('real POSIX npm bin links bind non-native target bytes and scoped ownership', t => {
    passed(py(fixture(t), binSetup + linkBins + `
manifest=m.inventory(root)
assert manifest['schemaVersion'] == 3 and len(manifest['links']) == 2 and len(manifest['files']) == 2
assert manifest == m.inventory(root)
assert {row['owner'] for row in manifest['links']} == {'npm/@synthetic/tool','npm/@synthetic/tool/node_modules/helper'}
assert all(row['kind'] == 'npm-bin' for row in manifest['links'])
candidate=root/'private'
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(manifest))
(root/'native/prebuilt-dependencies.json').write_text(json.dumps(manifest))
(root/'native/lock-review.json').write_text(json.dumps({'schemaVersion':1,'approved':True,'hashes':m.hashes(root,candidate)}))
m.verify_locked(root,candidate,manifest)
(npm/'@synthetic/tool/bin/cli').write_bytes(b'changed command bytes')
changed=m.inventory(root)
assert changed['links'] == manifest['links'] and changed['files'] != manifest['files']
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(changed))
try: m.verify_locked(root,candidate,changed)
except m.GateError: pass
else: raise AssertionError('command-byte drift accepted')
print('POSIX_BIN_TARGET_BYTES_BOUND')`), 'POSIX_BIN_TARGET_BYTES_BOUND');
  });
  for (const [name, mutation] of [
    ['wrong owner', `(npm/'.bin/tool').unlink(); os.symlink('../@synthetic/tool/node_modules/helper/bin/helper',npm/'.bin/tool')`],
    ['absolute target', `(npm/'.bin/tool').unlink(); os.symlink(str(npm/'@synthetic/tool/bin/cli'),npm/'.bin/tool')`],
    ['noncanonical target', `(npm/'.bin/tool').unlink(); os.symlink('../@synthetic/tool/bin/../bin/cli',npm/'.bin/tool')`],
    ['unknown command', `os.symlink('../@synthetic/tool/bin/cli',npm/'.bin/unknown')`],
    ['case variant command', `(npm/'.bin/tool').unlink(); os.symlink('../@synthetic/tool/bin/cli',npm/'.bin/TOOL')`],
    ['target directory', `(npm/'@synthetic/tool/bin/cli').unlink(); (npm/'@synthetic/tool/bin/cli').mkdir()`],
    ['target symlink', `(npm/'@synthetic/tool/bin/cli').unlink(); os.symlink('../node_modules/helper/bin/helper',npm/'@synthetic/tool/bin/cli')`],
    ['hardlinked target', `physical=npm/'@synthetic/tool/bin/cli'; os.link(physical,root/'outside')`],
    ['dangling target', `(npm/'@synthetic/tool/bin/cli').unlink()`],
    ['linked parent', `physical=npm/'@synthetic/tool/bin'; moved=physical.with_name('moved'); physical.rename(moved); os.symlink('moved',physical,target_is_directory=True)`],
    ['directory bin namespace', `shutil.rmtree(npm/'.bin'); os.symlink('@synthetic/tool/bin',npm/'.bin',target_is_directory=True)`],
  ]) test(`real POSIX npm bin rejects ${name}`, t => {
    passed(py(fixture(t), binSetup + linkBins + mutation + reject), 'UNAPPROVED_LINK_REJECTED');
  });

  test('real POSIX npm command collisions permit only declared targets and invalidate old locked links', t => {
    passed(py(fixture(t), `
lock={'lockfileVersion':3,'packages':{name:{'bin':{'shared':'bin/cli'}} for name in ('node_modules/first','node_modules/second')}}
(root/'package-lock.json').write_text(json.dumps(lock)); (npm/'.bin').mkdir()
for name in ('first','second'):
 physical=npm/name/'bin/cli'; physical.parent.mkdir(parents=True); physical.write_bytes(b'synthetic command')
link=npm/'.bin/shared'; os.symlink('../first/bin/cli',link)
manifest=m.inventory(root); assert len(manifest['files']) == len(manifest['links']) == 1
candidate=root/'private'; (candidate/'prebuilt-dependencies.json').write_text(json.dumps(manifest))
(root/'native/prebuilt-dependencies.json').write_text(json.dumps(manifest))
(root/'native/lock-review.json').write_text(json.dumps({'schemaVersion':1,'approved':True,'hashes':m.hashes(root,candidate)}))
m.verify_locked(root,candidate,manifest)
link.unlink(); os.symlink('../second/bin/cli',link)
changed=m.inventory(root); assert changed['links'][0]['owner'] == 'npm/second'
(candidate/'prebuilt-dependencies.json').write_text(json.dumps(changed))
try: m.verify_locked(root,candidate,changed)
except m.GateError: pass
else: raise AssertionError('changed command owner accepted by locked review')
print('POSIX_COLLISION_OWNER_BOUND')`), 'POSIX_COLLISION_OWNER_BOUND');
  });
  test('real POSIX npm native binary target is recorded once despite both discovery paths', t => {
    passed(py(fixture(t), binSetup + linkBins + `
(npm/'@synthetic/tool/bin/cli').write_bytes(bytes.fromhex('cffaedfe')+b'synthetic binary')
manifest=m.inventory(root)
assert len(manifest['files']) == 2 and len({row['path'] for row in manifest['files']}) == 2
print('POSIX_NATIVE_BIN_TARGET_DEDUPLICATED')`), 'POSIX_NATIVE_BIN_TARGET_DEDUPLICATED');
  });

  const headerSetup = `
for directory in ('ios/Pods/Synthetic/include','node_modules/@synthetic/headers/include','ios/build/generated/ios/Synthetic'):
 physical=root/directory/'Synthetic.h'; physical.parent.mkdir(parents=True); physical.write_bytes(b'synthetic header bytes')
for scope,source in (('Public','ios/Pods/Synthetic/include/Synthetic.h'),('Private','node_modules/@synthetic/headers/include/Synthetic.h'),('Public','ios/build/generated/ios/Synthetic/Synthetic.h')):
 namespace=pathlib.PurePosixPath(source).parts[0]+'-'+pathlib.PurePosixPath(source).parts[-2]
 link=pods/'Headers'/scope/namespace/'Synthetic.h'; link.parent.mkdir(parents=True,exist_ok=True)
 os.symlink(posixpath.relpath(source,link.parent.relative_to(root).as_posix()),link)
`;
  test('real POSIX CocoaPods headers bind physical bytes in Pods, npm and generated iOS sources', t => {
    passed(py(fixture(t), headerSetup + `
manifest=m.inventory(root)
assert len(manifest['links']) == 3 and len(manifest['files']) == 3
assert all(row['kind'] == 'cocoapods-header' for row in manifest['links'])
assert {row['path'].split('/')[0] for row in manifest['files']} == {'pods','npm','codegen'}
physical=root/'ios/build/generated/ios/Synthetic/Synthetic.h'; physical.write_bytes(b'changed header')
assert m.inventory(root)['files'] != manifest['files']
print('POSIX_HEADER_TARGETS_BOUND')`), 'POSIX_HEADER_TARGETS_BOUND');
  });
  for (const [name, target] of [
    ['outside dependency roots', 'outside/Synthetic.h'],
    ['parent outside repository', '../Synthetic.h'],
    ['unapproved generated directory', 'ios/build/other/Synthetic.h'],
    ['different basename', 'ios/Pods/Synthetic/include/Other.h'],
    ['native suffix', 'ios/Pods/Synthetic/include/Other.a'],
  ]) test(`real POSIX CocoaPods header rejects ${name}`, t => {
    passed(py(fixture(t), `
physical=root/${JSON.stringify(target)}
if not ${JSON.stringify(target)}.startswith('../'):
 physical.parent.mkdir(parents=True,exist_ok=True); physical.write_bytes(b'synthetic target')
link=pods/'Headers/Public/Synthetic/Synthetic.h'; link.parent.mkdir(parents=True)
os.symlink(posixpath.relpath(${JSON.stringify(target)},'ios/Pods/Headers/Public/Synthetic'),link)
` + reject), 'UNAPPROVED_LINK_REJECTED');
  });
  for (const [name, mutation] of [
    ['directory target', `physical.unlink(); physical.mkdir()`],
    ['linked target', `physical.unlink(); other=physical.with_name('Other.h'); other.write_bytes(b'synthetic'); os.symlink('Other.h',physical)`],
    ['hardlinked target', `os.link(physical,root/'outside-header')`],
    ['dangling target', `physical.unlink()`],
    ['absolute target', `link.unlink(); os.symlink(str(physical),link)`],
    ['noncanonical target', `link.unlink(); os.symlink('../../../Synthetic/include/../include/Synthetic.h',link)`],
    ['unknown namespace', `link.unlink(); link=pods/'Headers/Other/Synthetic/Synthetic.h'; link.parent.mkdir(parents=True); os.symlink('../../../Synthetic/include/Synthetic.h',link)`],
    ['directory namespace link', `parent=link.parent; moved=parent.with_name('Moved'); parent.rename(moved); os.symlink('Moved',parent,target_is_directory=True)`],
  ]) test(`real POSIX header link rejects ${name}`, t => {
    passed(py(fixture(t), `
physical=pods/'Synthetic/include/Synthetic.h'; physical.parent.mkdir(parents=True); physical.write_bytes(b'synthetic')
link=pods/'Headers/Public/Synthetic/Synthetic.h'; link.parent.mkdir(parents=True); os.symlink('../../../Synthetic/include/Synthetic.h',link)
` + mutation + reject), 'UNAPPROVED_LINK_REJECTED');
  });
  test('real POSIX generated CocoaPods modulemap links are recorded with their target bytes', t => {
    passed(py(fixture(t), `
physical=pods/'Target Support Files/Synthetic/Synthetic.modulemap'; physical.parent.mkdir(parents=True); physical.write_bytes(b'module Synthetic {}')
link=pods/'Headers/Public/Synthetic/Synthetic.modulemap'; link.parent.mkdir(parents=True)
os.symlink('../../../Target Support Files/Synthetic/Synthetic.modulemap',link)
manifest=m.inventory(root)
assert len(manifest['links']) == len(manifest['files']) == 1
assert manifest['links'][0]['physical'] == 'pods/Target Support Files/Synthetic/Synthetic.modulemap'
print('POSIX_MODULEMAP_TARGET_BOUND')`), 'POSIX_MODULEMAP_TARGET_BOUND');
  });
}
