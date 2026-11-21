import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, assert, digest, stable, readSafe } from './lib/control.mjs';

const reference = JSON.parse(readSafe(ROOT, 'docs/acceptance/t3-main-technology-inventory.json', 'utf8'));
const vendor = JSON.parse(readSafe(ROOT, 'docs/acceptance/t3-vendor-inspection.json', 'utf8'));
const delta = JSON.parse(readSafe(ROOT, 'docs/acceptance/t3-main-delta-285558eb.json', 'utf8')); // Rechecked main; retain the complete baseline evidence.
assert(digest(stable(reference)) === '91858725d4d80cfe43134b4d666b3fd518b4067a16515034c320163a2c037ef2', 'Reviewed reference inventory changed: re-research and review before updating the policy');
assert(digest(stable(vendor)) === '43b5229dde87a64b4c929a2753fae65fa02f431b3b285a3947726c14c78d3ce4', 'Reviewed vendor source/license evidence changed');
assert(digest(stable(delta)) === '6c7129a516217f24d0fcd3aa59d9a7bd2a460a122d3b5a7ba6571f5235f0788f' && delta.currentMainCommit === '285558eb1053d17f59ea8ecdf7c57999e92381f8' && delta.coreChoicesUnchanged === true, 'Current-main delta requires source review');
assert(reference.commit === '068332c603ce5ca40ad5a96a09cffa34ebd05dff' && reference.lockDocumentCount === 2 && reference.registryFailures.length === 0, 'Reference evidence is incomplete');
const pkg = JSON.parse(readSafe(ROOT, 'package.json', 'utf8'));
const app = JSON.parse(readSafe(ROOT, 'app.json', 'utf8')).expo;
const decision = readSafe(ROOT, 'docs/decisions/technology-stack.md', 'utf8');
assert(decision.includes(reference.commit) && decision.includes(delta.currentMainCommit), 'Technology decision must identify the exact researched main');
assert(pkg.main === 'index.ts' && !pkg.dependencies['expo-router'] && !app.plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router'), 'Use the researched native navigation entry, not an implicit Router dependency');
assert(pkg.dependencies.uniwind === '1.13.2' && !JSON.stringify(pkg).includes('uniwind-pro'), 'Use the reviewed free Uniwind package only');

const names = ['react', 'react-native', '@react-navigation/native', '@react-navigation/native-stack', '@react-navigation/elements', 'uniwind', 'tailwindcss', 'expo-glass-effect', '@react-native-menu/menu', 'react-native-reanimated', 'react-native-gesture-handler', 'react-native-worklets', 'react-native-keyboard-controller'];
const installed = {};
for (const name of names) {
  const selected = reference.mobileDependencies.find(row => row.name === name);
  assert(selected?.registry?.license?.toUpperCase() === 'MIT', 'Unreviewed reference license for ' + name);
  const metadata = JSON.parse(readFileSync(resolve(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
  const expected = selected.lockedVersion.split('(')[0];
  assert(metadata.version === expected && metadata.license?.toUpperCase() === 'MIT', 'Installed ' + name + ' does not match the reviewed version/license');
  installed[name] = metadata.version;
}
const exclusions = ['react-native-gesture-handler', 'react-native-keyboard-controller', 'react-native-worklets'];
assert(stable([...pkg.expo.install.exclude].sort()) === stable([...exclusions].sort()), 'Only the explicitly reviewed third-party recommendations may differ from Expo');
for (const name of exclusions) assert(pkg.dependencies[name] === installed[name], 'Recommendation exception must use an exact source-aligned pin: ' + name);
const screens = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/react-native-screens/package.json'), 'utf8'));
const expo = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/expo/package.json'), 'utf8'));
assert(screens.version === '4.30.1' && expo.version === '58.0.26', 'The explicit SDK/screens deviation needs a new compatibility decision');
assert(pkg.overrides['@react-navigation/core'] === '7.24.0' && pkg.overrides['@react-native/metro-config'] === '0.88.1', 'Navigation core and Metro must retain the researched compatibility pins');
const reanimated = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/react-native-reanimated/package.json'), 'utf8'));
assert(reanimated.peerDependencies['react-native-worklets'] === '0.13.x', 'Reanimated/Worklets compatibility contract changed');
console.log(JSON.stringify({ schemaVersion: 1, passed: true, kind: 'technology-stack-contract', referenceCommit: delta.currentMainCommit, auditedBaselineCommit: reference.commit, versions: installed, reviewedExpoRecommendationExceptions: exclusions, runtimeAcceptance: 'Separate native interaction, visual, device IPA and independent-review gates still required' }, null, 2));
