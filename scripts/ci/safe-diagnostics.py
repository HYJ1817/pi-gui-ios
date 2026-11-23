#!/usr/bin/env python3
"""Structural CI diagnostics only: fixed codes and locations in public build source.

Never copy an error message, environment value, arbitrary file path or log line.
"""
import ast
import json
import pathlib
import re
import sys
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
STEPS = ('environment', 'npm', 'prebuild', 'pods', 'maestro', 'simulator-build', 'iphone', 'ipad', 'device-build', 'ipa')
CATEGORIES = {
    'NPM_PEER_RESOLUTION_FAILED': r'\bERESOLVE\b',
    'NPM_INTEGRITY_FAILED': r'\bEINTEGRITY\b',
    'DEPENDENCY_NOT_FOUND': r'\bE404\b|Unable to find a specification|Could not find gem',
    'DEPENDENCY_DEPLOYMENT_TARGET': r'required a higher minimum deployment target',
    'BUNDLER_RESOLUTION_FAILED': r'Bundler::|Could not find compatible versions|Could not locate Gemfile',
    'COMPILER_MODULE_NOT_FOUND': r'no such module|cannot find module|module .* not found',
    'COMPILER_MEMBER_NOT_FOUND': r'has no member|no member named',
    'COMPILER_IDENTIFIER_NOT_FOUND': r'undeclared identifier|cannot find .* in scope',
    'COMPILER_ERROR_REPORTED': r'(?:fatal )?error:',
    'LINKER_SYMBOL_NOT_FOUND': r'undefined symbols|undefined symbol',
    'MAESTRO_ASSERTION_FAILED': r'Assertion is false|Assertion failed|element .* not found',
    'RUNNER_INPUT_NOT_FOUND': r'No such file or directory|command not found',
}


def git_source(path):
    result = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:' + path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    return result.stdout if result.returncode == 0 else ''


def safe_codes():
    codes = set(CATEGORIES) | {'NATIVE_FAILURE_DETAILS_WITHHELD', 'NATIVE_LOCK_VALIDATOR_FAILED',
            'NATIVE_LOCKS_SAFE', 'NATIVE_LOCKS_REJECTED', 'NATIVE_DEPENDENCIES_LOCKED',
            'NATIVE_DEPENDENCIES_BOOTSTRAP_REQUIRED', 'NATIVE_DEPENDENCIES_VERIFIED',
            'NATIVE_LOCK_BOOTSTRAP_REVIEW_REQUIRED'}
    for filename in ('verify-ipa.py', 'native-dependencies.py', 'configure-native.py', 'verify-template.py'):
        for node in ast.walk(ast.parse(git_source('scripts/ci/' + filename))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.fullmatch(
                    r'(?:NATIVE|IPA|MACHO|PLIST|ATS|ARCHIVE|FRAMEWORK|BUNDLE|SIGNING|EXECUTABLE)_[A-Z0-9_]*[A-Z0-9]', node.value):
                codes.add(node.value)
    ruby = git_source('scripts/ci/validate-locks.rb')
    codes.update('NATIVE_LOCKS_REJECTED_' + phase for phase in re.findall(r"phase = '([A-Z_]+)'", ruby))
    return codes


def public_source_index():
    """Only immutable Git names / lock package names may become public locations."""
    listed = subprocess.run(['git', '-C', str(ROOT), 'ls-tree', '-r', '--name-only', 'HEAD'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    tracked = set(listed.stdout.splitlines()) if listed.returncode == 0 else set()
    lock = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:package-lock.json'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    packages = set()
    if lock.returncode == 0 and len(lock.stdout) <= 8 * 1024 * 1024:
        for entry in json.loads(lock.stdout).get('packages', {}):
            parts = pathlib.PurePosixPath(entry).parts
            if 'node_modules' not in parts:
                continue
            at = max(index for index, part in enumerate(parts) if part == 'node_modules') + 1
            if at >= len(parts):
                continue
            name = parts[at]
            if name.startswith('@') and at + 1 < len(parts):
                name += '/' + parts[at + 1]
            if re.fullmatch(r'(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+', name):
                packages.add(name)
    return tracked, packages


def scan(step, paths):
    if step not in STEPS:
        raise ValueError('DIAGNOSTIC_STEP_REJECTED')
    allowed, codes, locations = safe_codes(), set(), {}
    tracked, packages = public_source_index()
    for path in map(pathlib.Path, paths):
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
            raise ValueError('DIAGNOSTIC_INPUT_REJECTED')
        with path.open(encoding='utf-8', errors='replace') as stream:
            for line in stream:
                if len(line) > 65536:
                    continue
                codes.update(token for token in re.findall(r'\b[A-Z][A-Z0-9_]{2,120}\b', line) if token in allowed)
                for code, pattern in CATEGORIES.items():
                    if re.search(pattern, line, re.IGNORECASE):
                        codes.add(code)
                match = re.search(r'((?:src|scripts|node_modules|ios/Pods|ios)/[^\s:\"<>]+\.(?:tsx?|swift|mm?|cpp|h|py|rb|sh)):(\d{1,7})(?::\d{1,7})?', line.replace('\\', '/'))
                if match and re.search(r'\berror\b', line, re.IGNORECASE):
                    relative, number = match[1], int(match[2])
                    # Compiler messages may reference headers through ../ relative
                    # hops (e.g. Pods -> ../node_modules/...): normalize leading ../
                    # so the same structural location still reports, never the raw line.
                    normalized = re.sub(r'^(?:\.\./)+', '', relative)
                    parts = pathlib.PurePosixPath(normalized).parts
                    if not 0 < number <= 1000000 or len(normalized) > 240 or '..' in parts or len(locations) >= 10:
                        continue
                    relative = normalized
                elif re.search(r'\berror\b', line, re.IGNORECASE):
                    # No recognized path prefix: report only the file BASENAME
                    # with line number for the first few error lines so a
                    # DerivedData/generated-source failure still has a locator.
                    name = re.search(r'([A-Za-z0-9_.-]+\.(?:swift|mm?|cpp|h|m)):(\d{1,7})', line)
                    if name and len(locations) < 10:
                        locations[('file:' + name[1], int(name[2]))] = {'dependency': 'file:' + name[1], 'line': int(name[2])}
                    continue
                else:
                    continue
                if relative in tracked:
                    locations[(relative, number)] = {'path': relative, 'line': number}
                elif parts[0] == 'node_modules' and len(parts) >= 2:
                    name = parts[1] + '/' + parts[2] if parts[1].startswith('@') and len(parts) >= 3 else parts[1]
                    if name in packages:
                        locations[(name, number)] = {'dependency': name, 'line': number}
                elif relative.startswith('ios/Pods/'):
                    locations[('cocoapods', number)] = {'dependency': 'cocoapods', 'line': number}
                elif relative.startswith('ios/'):
                    # Generated project files (pods-prebuild output): report the
                    # basename only, never intermediate paths or contents.
                    locations[('ios-generated', number)] = {'dependency': 'ios-generated', 'line': number}
                # No quoted identifier or generated/untracked source value is copied.
    return {'schemaVersion': 1, 'kind': 'safe-ci-diagnostics', 'step': step,
            'codes': sorted(codes)[:32] or ['NATIVE_FAILURE_DETAILS_WITHHELD'],
            'sourceLocations': list(locations.values())[:10]}


def environment(path):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 1024 * 1024:
        return {'schemaVersion': 1, 'observed': False, 'versions': {}}
    text = path.read_text(encoding='utf-8', errors='replace')
    patterns = {'macOS': r'^ProductVersion:\s*([0-9.]{1,20})\s*$',
                'macOSBuild': r'^BuildVersion:\s*([A-Za-z0-9]{1,20})\s*$',
                'xcode': r'^Xcode ([0-9.]{1,20})\s*$', 'xcodeBuild': r'^Build version ([A-Za-z0-9]{1,20})\s*$',
                'node': r'^v([0-9]+\.[0-9]+\.[0-9]+)\s*$', 'npm': r'^([0-9]+\.[0-9]+\.[0-9]+)\s*$',
                'ruby': r'^ruby ([0-9]+\.[0-9]+\.[0-9]+) ', 'bundler': r'^Bundler version ([0-9]+\.[0-9]+\.[0-9]+)\s*$'}
    versions = {name: found.group(1) for name, pattern in patterns.items() if (found := re.search(pattern, text, re.MULTILINE))}
    return {'schemaVersion': 1, 'observed': len(versions) == len(patterns), 'versions': versions}


if __name__ == '__main__':
    try:
        print(json.dumps(scan(sys.argv[1], sys.argv[2:]), sort_keys=True))
    except Exception:
        print(json.dumps({'schemaVersion': 1, 'kind': 'safe-ci-diagnostics', 'codes': ['NATIVE_FAILURE_DETAILS_WITHHELD']}))
        sys.exit(1)
