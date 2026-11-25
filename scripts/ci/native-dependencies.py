#!/usr/bin/env python3
"""Reviewed locks + byte-level prebuilt dependency inventory, before any build."""
import hashlib
import importlib.util
import json
import os
import pathlib
import posixpath
import re
import shutil
import stat
import subprocess
import sys


class GateError(Exception):
    def __init__(self, code, reason=None):
        super().__init__(code)
        self.reason = reason
        self.context = None


def check(ok, code='NATIVE_DEPENDENCIES_REJECTED', reason=None):
    if not ok:
        raise GateError(code, reason)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def policy(root):
    value = load(root / 'native/dependency-policy.json')
    check(value == {'schemaVersion': 1, 'mode': value.get('mode'), 'ruby': '3.3.8',
                    'bundler': '2.6.9', 'cocoapods': '1.16.2'})
    check(value['mode'] in ('bootstrap-required', 'locked'))
    return value['mode']


# Only these six aliases were observed in BOTH pinned Hermes 260318099.0.5
# Debug/Release archives (RN 0.88.1). This dependency-inventory exception does
# not change the final IPA's no-link policy. Never traverse an alias to hash it.
HERMES_FRAMEWORK_ROOTS = (
    'pods/hermes-engine/destroot/Library/Frameworks/macosx/hermesvm.framework',
    'pods/hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework/'
    'ios-arm64_x86_64-maccatalyst/hermesvm.framework',
)
HERMES_ALIASES = {
    prefix + '/' + alias: {'target': target, 'physical': prefix + '/' + physical, 'directory': directory}
    for prefix in HERMES_FRAMEWORK_ROOTS
    for alias, target, physical, directory in (
        ('Versions/Current', '1', 'Versions/1', True),
        ('Resources', 'Versions/Current/Resources', 'Versions/1/Resources', True),
        ('hermesvm', 'Versions/Current/hermesvm', 'Versions/1/hermesvm', False),
    )
}


def checked_hermes_alias(path, base, safe, checked):
    code = 'NATIVE_PREBUILT_LINK_REJECTED'
    check(safe in HERMES_ALIASES, code)
    rule = HERMES_ALIASES[safe]
    info = path.lstat()
    # Reject all Windows reparse points/junctions, including at reviewed names.
    check(stat.S_ISLNK(info.st_mode) and info.st_nlink == 1
          and not (getattr(info, 'st_file_attributes', 0) & 0x400), code)
    checked(path.parent, base)
    check(os.readlink(path) == rule['target'], code, 'NATIVE_LINK_ALIAS_TEXT_REJECTED')
    # Resolve by the finite physical mapping, NOT Path.resolve(alias), so a
    # malicious Current/ancestor/target can never redirect a read outside Pods.
    physical = base.joinpath(*pathlib.PurePosixPath(rule['physical']).parts[1:])
    target = checked(physical, base)
    check(stat.S_ISDIR(target.st_mode) if rule['directory'] else
          stat.S_ISREG(target.st_mode) and target.st_nlink == 1, code)
    return {'path': safe, 'target': rule['target']}


def checked_hermes_prefixes(base, checked):
    # os.walk(followlinks=False) omits directory links. Preflight every existing
    # component of these known roots even when no .framework entry is reached.
    for prefix in HERMES_FRAMEWORK_ROOTS:
        current = base
        for part in pathlib.PurePosixPath(prefix).parts[1:]:
            current = current / part
            try:
                current.lstat()  # Unlike exists(), a dangling alias is not missing.
            except FileNotFoundError:
                break  # This vendor tree may legitimately be absent in a fixture.
            except OSError:
                raise GateError('NATIVE_PREBUILT_LINK_REJECTED') from None
            info = checked(current, base)
            check(stat.S_ISDIR(info.st_mode), 'NATIVE_PREBUILT_LINK_REJECTED')


def enumeration_failed(error):
    # Never create an incomplete reviewable inventory after a traversal error.
    raise GateError('NATIVE_PREBUILT_ENUMERATION_FAILED') from None


def filesystem_guard():
    spec = importlib.util.spec_from_file_location('native_fs_policy', pathlib.Path(__file__).with_name('verify-ipa.py'))
    fs_policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fs_policy)
    def checked(path, base=None):
        try:
            return fs_policy.checked_filesystem_path(path, base)
        except fs_policy.Invalid as error:
            reason = 'NATIVE_LINK_ANCESTOR_REJECTED' if str(error) == 'ARCHIVE_LINK' else 'NATIVE_LINK_BOUNDARY_REJECTED'
            raise GateError('NATIVE_PREBUILT_LINK_REJECTED', reason) from None
        except OSError:
            raise GateError('NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_FILESYSTEM_REJECTED') from None
    return checked


def npm_bin_rules(root, checked=None):
    """Derive exact bin link paths/targets from the committed npm v3 lock."""
    code = 'NATIVE_PREBUILT_LINK_REJECTED'
    checked = checked or filesystem_guard()
    lock_path = root / 'package-lock.json'
    info = checked(lock_path, root)
    check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, code)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            check(key not in result, code)
            result[key] = value
        return result
    try:
        lock = json.loads(lock_path.read_text(encoding='utf-8'), object_pairs_hook=unique)
    except (ValueError, OSError):
        raise GateError(code) from None
    check(isinstance(lock, dict) and lock.get('lockfileVersion') == 3
          and isinstance(lock.get('packages'), dict), code)
    name = r'(?:@[A-Za-z0-9_][A-Za-z0-9_.-]*/)?[A-Za-z0-9_][A-Za-z0-9_.-]*'
    rules = {}
    for owner, package in lock['packages'].items():
        check(isinstance(package, dict), code)
        if not owner:  # The application itself is not installed into .bin.
            continue
        check(re.fullmatch(r'node_modules/' + name + r'(?:/node_modules/' + name + r')*', owner)
              and package.get('link', False) is False, code)
        package_path = pathlib.PurePosixPath(owner)
        modules = package_path.parent.parent if package_path.parent.name.startswith('@') else package_path.parent
        bins = package.get('bin', {})
        if isinstance(bins, str):
            bins = {package_path.name: bins}
        check(isinstance(bins, dict), code)
        for command, target in bins.items():
            check(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', command) is not None
                  and isinstance(target, str), code)
            target = target.removeprefix('./')
            check(re.fullmatch(r'[A-Za-z0-9_@./+ ()-]+', target) is not None
                  and all(part not in ('', '.', '..') for part in target.split('/')), code)
            physical = package_path / target
            link = modules / '.bin' / command
            relative = posixpath.relpath(str(physical), str(link.parent))
            safe = 'npm/' + link.relative_to('node_modules').as_posix()
            rules.setdefault(safe, {})[relative] = {
                'owner': 'npm/' + package_path.relative_to('node_modules').as_posix(),
                'physical': 'npm/' + physical.relative_to('node_modules').as_posix(),
            }
    return rules


def checked_posix_link(path, base, checked):
    code = 'NATIVE_PREBUILT_LINK_REJECTED'
    try:
        info = path.lstat()
        check(stat.S_ISLNK(info.st_mode) and info.st_nlink == 1
              and not (getattr(info, 'st_file_attributes', 0) & 0x400), code, 'NATIVE_LINK_ALIAS_TYPE_REJECTED')
        checked(path.parent, base)
        return os.readlink(path)
    except OSError:
        raise GateError(code, 'NATIVE_LINK_FILESYSTEM_REJECTED') from None


# Fixed Xcodeproj 1.27.0 constants used by CocoaPods 1.16.2 FileAccessor,
# plus the module maps generated by the separately reviewed target installers.
HEADER_SUFFIXES = frozenset(('.h', '.hh', '.hpp', '.ipp', '.tpp', '.hxx', '.def', '.inl', '.inc', '.modulemap'))
# RN 0.88.1 RNCoreFacades copies exactly this one re-exposed source header.
# Public and Private are the two CocoaPods HeadersStore namespaces. No other
# file or directory under either facade family gains an inventory exception.
RNCORE_FACADE_HEADERS = {
    'pods/Headers/' + scope + '/React-RCTFabric/React/RCTFabricComponentsPlugins.h':
        'ios/build/rncore-facades/React-RCTFabric/RCTFabricComponentsPlugins.h'
    for scope in ('Public', 'Private')
}


def is_header_namespace(safe):
    parts = pathlib.PurePosixPath(safe).parts
    return len(parts) >= 5 and parts[:2] == ('pods', 'Headers') and parts[2] in ('Public', 'Private')


def is_header_link(path, safe):
    return is_header_namespace(safe) and path.suffix.casefold() in HEADER_SUFFIXES


def checked_header_link(path, safe, target):
    # CocoaPods 1.16.2 HeadersStore and target installers create file links in
    # exactly these namespaces. Directory links are never a header exception.
    code = 'NATIVE_PREBUILT_LINK_REJECTED'
    parts = pathlib.PurePosixPath(safe).parts
    check(is_header_namespace(safe), code, 'NATIVE_LINK_HEADER_NAMESPACE_REJECTED')
    check(path.suffix.casefold() in HEADER_SUFFIXES, code, 'NATIVE_LINK_HEADER_SUFFIX_REJECTED')
    check(re.fullmatch(r'[A-Za-z0-9_@./+ ()-]+', target) is not None and not target.startswith('/'),
          code, 'NATIVE_LINK_HEADER_SYNTAX_REJECTED')
    project_link = 'ios/Pods/' + '/'.join(parts[1:])
    physical = posixpath.normpath(posixpath.join(posixpath.dirname(project_link), target))
    check(target == posixpath.relpath(physical, posixpath.dirname(project_link)),
          code, 'NATIVE_LINK_HEADER_CANONICAL_REJECTED')
    check(pathlib.PurePosixPath(physical).name == path.name, code, 'NATIVE_LINK_HEADER_BASENAME_REJECTED')
    if safe in RNCORE_FACADE_HEADERS:
        check(physical == RNCORE_FACADE_HEADERS[safe], code, 'NATIVE_LINK_HEADER_ROOT_REJECTED')
        return {'kind': 'cocoapods-header', 'path': safe, 'target': target,
                'physical': 'rncore-facade/React-RCTFabric/RCTFabricComponentsPlugins.h'}
    for label, prefix in (('pods', 'ios/Pods/'), ('npm', 'node_modules/'), ('codegen', 'ios/build/generated/ios/')):
        if physical.startswith(prefix):
            check(all(part not in ('', '.', '..') for part in physical.split('/')), code, 'NATIVE_LINK_HEADER_ROOT_REJECTED')
            return {'kind': 'cocoapods-header', 'path': safe, 'target': target,
                    'physical': label + '/' + physical.removeprefix(prefix)}
    raise GateError(code, 'NATIVE_LINK_HEADER_ROOT_REJECTED')


def inventory(root):
    checked = filesystem_guard()
    bin_rules = npm_bin_rules(root, checked)
    files, links = {}, []
    bases = {'pods': root / 'ios/Pods', 'npm': root / 'node_modules',
             'codegen': root / 'ios/build/generated/ios', 'rncore-facade': root / 'ios/build/rncore-facades'}
    def record(path, base, safe):
        check(re.fullmatch(r'[A-Za-z0-9_@./+ ()-]+', safe) is not None, 'NATIVE_PREBUILT_PATH_REJECTED')
        info = checked(path, base)
        check(stat.S_ISREG(info.st_mode), 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_TARGET_TYPE_REJECTED')
        check(info.st_nlink == 1, 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_HARDLINK_REJECTED')
        row = {'path': safe, 'sha256': digest(path), 'size': info.st_size}
        check(safe not in files or files[safe] == row, 'NATIVE_PREBUILT_BYTES_CHANGED')
        files[safe] = row
    def linked_entry(path, base, safe):
        if safe in HERMES_ALIASES:
            context = 'NATIVE_LINK_CONTEXT_HERMES'
        elif safe in bin_rules:
            context = 'NATIVE_LINK_CONTEXT_NPM_BIN'
        elif is_header_namespace(safe):
            context = 'NATIVE_LINK_CONTEXT_PODS_HEADER'
        elif safe.startswith('npm/'):
            context = 'NATIVE_LINK_CONTEXT_NPM_UNKNOWN'
        else:
            context = 'NATIVE_LINK_CONTEXT_PODS_UNKNOWN'
        try:
            check(re.fullmatch(r'[A-Za-z0-9_@./+ ()-]+', safe) is not None, 'NATIVE_PREBUILT_PATH_REJECTED')
            if safe in HERMES_ALIASES:
                return checked_hermes_alias(path, base, safe, checked)
            check(safe in bin_rules or is_header_namespace(safe), 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_UNAPPROVED_REJECTED')
            target = checked_posix_link(path, base, checked)
            if safe in bin_rules:
                check(target in bin_rules[safe], 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_NPM_TARGET_REJECTED')
                row = {'kind': 'npm-bin', 'path': safe, 'target': target, **bin_rules[safe][target]}
            else:
                row = checked_header_link(path, safe, target)
            label, relative = row['physical'].split('/', 1)
            # Inspect the lexical, finite physical target before reading bytes.
            record(bases[label].joinpath(*pathlib.PurePosixPath(relative).parts), bases[label], row['physical'])
            return row
        except GateError as error:
            error.context = context
            raise
    for label in ('pods', 'npm'):
        base = bases[label]
        info = checked(base)
        check(stat.S_ISDIR(info.st_mode), 'NATIVE_DEPENDENCY_TREE_MISSING')
        if label == 'pods':
            checked_hermes_prefixes(base, checked)
        for directory, dirs, names in os.walk(base, followlinks=False, onerror=enumeration_failed):
            for name in list(dirs):
                path = pathlib.Path(directory) / name
                safe = label + '/' + path.relative_to(base).as_posix()
                info = path.lstat()
                if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                    links.append(linked_entry(path, base, safe))
                    dirs.remove(name)
                else:
                    check(stat.S_ISDIR(checked(path, base).st_mode), 'NATIVE_PREBUILT_LINK_REJECTED')
            for name in names:
                path = pathlib.Path(directory) / name
                relative = path.relative_to(base)
                safe = label + '/' + relative.as_posix()
                info = path.lstat()
                # Every link is classified BEFORE suffix or magic-byte discovery.
                if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                    links.append(linked_entry(path, base, safe))
                    continue
                check(stat.S_ISREG(info.st_mode), 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_TARGET_TYPE_REJECTED')
                check(info.st_nlink == 1, 'NATIVE_PREBUILT_LINK_REJECTED', 'NATIVE_LINK_HARDLINK_REJECTED')
                native = any(p.casefold().endswith(('.framework', '.xcframework')) for p in relative.parts)
                native |= name.casefold().endswith(('.a', '.dylib', '.so', '.dll', '.node', '.wasm', '.metallib', '.tbd',
                                                   '.zip', '.tgz', '.tar.gz', '.tar.xz'))
                if not native:
                    with path.open('rb') as stream:
                        native = stream.read(4) in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe',
                                                   b'\xca\xfe\xba\xbf', b'\xfe\xed\xfa\xcf')
                if native:
                    record(path, base, safe)
    seen = {row['path'] for row in links}
    for prefix in HERMES_FRAMEWORK_ROOTS:
        group = {path for path in HERMES_ALIASES if path.startswith(prefix + '/')}
        check(not seen.intersection(group) or group.issubset(seen), 'NATIVE_PREBUILT_LINK_REJECTED')
    return {'schemaVersion': 3, 'files': sorted(files.values(), key=lambda item: item['path']),
            'links': sorted(links, key=lambda item: item['path'])}


def hashes(root, locks):
    return {'templateVerifierSha256': digest(root / 'scripts/ci/verify-template.py'),
            'gemfileSha256': digest(root / 'Gemfile'),
            'packageLockSha256': digest(root / 'package-lock.json'),
            'podfileSha256': digest(root / 'ios/Podfile'),
            'gemLockSha256': digest(locks / 'Gemfile.lock'),
            'podLockSha256': digest(locks / 'Podfile.lock'),
            'prebuiltManifestSha256': digest(locks / 'prebuilt-dependencies.json')}


def prepare(root, private):
    mode = policy(root)
    check((root / 'ios/Podfile').is_file())
    shutil.copyfile(root / 'Gemfile', private / 'Gemfile')
    if mode == 'locked':
        review = load(root / 'native/lock-review.json')
        check(review.get('schemaVersion') == 1 and review.get('approved') is True)
        shutil.copyfile(root / 'Gemfile.lock', private / 'Gemfile.lock')
        shutil.copyfile(root / 'native/Podfile.lock', private / 'Podfile.lock')
        shutil.copyfile(root / 'native/prebuilt-dependencies.json', private / 'prebuilt-dependencies.json')
        check(review.get('hashes') == hashes(root, private))
        shutil.copyfile(private / 'Podfile.lock', root / 'ios/Podfile.lock')
    else:
        # A partly committed lock set must not quietly become an unlocked build.
        check(not any((root / name).exists() for name in ('Gemfile.lock', 'native/Podfile.lock',
                  'native/lock-review.json', 'native/prebuilt-dependencies.json')))
    print('NATIVE_DEPENDENCIES_' + ('LOCKED' if mode == 'locked' else 'BOOTSTRAP_REQUIRED'))


LOCK_MISMATCH_KEYS = {
    'gemfileSha256': 'NATIVE_LOCK_MISMATCH_GEMFILE',
    'gemLockSha256': 'NATIVE_LOCK_MISMATCH_GEM_LOCK',
    'packageLockSha256': 'NATIVE_LOCK_MISMATCH_PACKAGE_LOCK',
    'podfileSha256': 'NATIVE_LOCK_MISMATCH_PODFILE',
    'podLockSha256': 'NATIVE_LOCK_MISMATCH_POD_LOCK',
    'prebuiltManifestSha256': 'NATIVE_LOCK_MISMATCH_PREBUILT_MANIFEST',
    'templateVerifierSha256': 'NATIVE_LOCK_MISMATCH_TEMPLATE_VERIFIER',
}


def verify_locked(root, candidate, manifest):
    review = load(root / 'native/lock-review.json')
    check(review.get('schemaVersion') == 1 and review.get('approved') is True)
    # Fixed structural codes only: which reviewed input diverged, never values.
    actual, expected = hashes(root, candidate), review.get('hashes', {})
    mismatches = [LOCK_MISMATCH_KEYS[key] for key in sorted(LOCK_MISMATCH_KEYS) if actual.get(key) != expected.get(key)]
    check(not mismatches, mismatches[0] if len(mismatches) == 1 else 'NATIVE_LOCK_MISMATCH_MULTIPLE')
    check(manifest == load(root / 'native/prebuilt-dependencies.json'), 'NATIVE_PREBUILT_BYTES_CHANGED')


def finish(root, private):
    mode = policy(root)
    # Work in a PRIVATE candidate directory. Raw lock text is never published.
    candidate = private / 'candidate'
    candidate.mkdir()
    shutil.copyfile(private / 'Gemfile.lock', candidate / 'Gemfile.lock')
    shutil.copyfile(root / 'ios/Podfile.lock', candidate / 'Podfile.lock')
    result = subprocess.run(['ruby', str(root / 'scripts/ci/validate-locks.rb'), str(candidate)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if result.returncode != 0:
        spec = importlib.util.spec_from_file_location('native_safe_diagnostics', pathlib.Path(__file__).with_name('safe-diagnostics.py'))
        diagnostics = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(diagnostics)
        public_codes = [line.strip() for line in result.stderr.splitlines() if line.strip() in diagnostics.safe_codes()]
        for code in public_codes or ['NATIVE_LOCK_VALIDATOR_FAILED']:
            print(code)
    check(result.returncode == 0)
    manifest = inventory(root)
    (candidate / 'prebuilt-dependencies.json').write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    expected = hashes(root, candidate)
    if mode == 'locked':
        verify_locked(root, candidate, manifest)
        print('NATIVE_DEPENDENCIES_VERIFIED')
        return 0
    report = {'schemaVersion': 1, 'approved': False, 'code': 'NATIVE_LOCK_BOOTSTRAP_REVIEW_REQUIRED',
              'hashes': expected, 'prebuiltFileCount': len(manifest['files'])}
    (candidate / 'review.json').write_text(json.dumps(report, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    output = root / 'artifacts/lock-candidates'
    output.mkdir(parents=True, exist_ok=True)
    for name in ('Gemfile.lock', 'Podfile.lock', 'prebuilt-dependencies.json', 'review.json'):
        shutil.copyfile(candidate / name, output / name)
    print('NATIVE_LOCK_BOOTSTRAP_REVIEW_REQUIRED')
    return 78  # Deliberately fails the job: no simulator/device/IPA acceptance.


if __name__ == '__main__':
    try:
        check(len(sys.argv) == 4 and sys.argv[1] in ('prepare', 'finish'))
        root, private = map(pathlib.Path, sys.argv[2:])
        if sys.argv[1] == 'prepare':
            prepare(root, private)
            sys.exit(0)
        sys.exit(finish(root, private))
    except GateError as error:
        print(str(error))
        for diagnostic in (error.context, error.reason):
            if diagnostic is not None:
                print(diagnostic)  # Fixed source literals only; never a path, target or exception text.
        sys.exit(1)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print('NATIVE_DEPENDENCIES_IO_OR_PARSE_ERROR')
        sys.exit(1)
