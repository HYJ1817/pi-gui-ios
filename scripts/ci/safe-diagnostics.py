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
STEPS = ('environment', 'npm', 'prebuild', 'pods', 'simulator-build', 'iphone', 'ipad', 'device-build', 'ipa')
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
    'XCODE_COMMAND_FAILED': r'Command \w+ failed with a nonzero exit code',
    'XCODE_BUILD_ERROR': r'xcodebuild: error|error: Building for',
    'FRAMEWORK_NOT_FOUND': r'framework not found|library not found|file not found|cannot open|unable to load|duplicate symbol|duplicate symbols|attempting to link|unsupported option|missing required architecture|building for.*but',
    'SWIFT_FRONTEND_FAILED': r'frontend command failed|Fatal error|signal \d',
    'LINKER_COMMAND_FAILED': r'linker command failed|ld:',
    'COMPILER_TOOL_EMIT_MODULE': r'\bEmitSwiftModule\b',
    'COMPILER_TOOL_SWIFT_COMPILE': r'\bSwiftCompile\b',
    'COMPILER_TOOL_SWIFT_DRIVER': r'\bSwiftDriver\b',
    'COMPILER_TOOL_COMPILEC': r'\bCompileC\b',
    'COMPILER_TOOL_LD': r'\bLd /|\bLd [^ ]',
    'COMPILER_TOOL_SCRIPT': r'\bPhaseScriptExecution\b',
    'COMPILER_TOOL_CODESIGN': r'\bCodeSign\b',
    'MAESTRO_ASSERTION_FAILED': r'Assertion is false|Assertion failed|element .* not found',
    'MAESTRO_FLOW_FAILED': r'Maestro|flow.*(failed|error)|timed out.*waiting',
    'SIMCTL_BOOT_FAILED': r'simctl.*(boot|bootstatus).*(failed|timeout|error)',
    'SIMCTL_INSTALL_FAILED': r'simctl install.*(failed|error)|install.*failed',
    'APP_CRASH': r'\bSIG\w+\b|crashed|terminated.*signal',
    'RUNNER_INPUT_NOT_FOUND': r'No such file or directory|command not found',
}


def git_source(path):
    result = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:' + path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    return result.stdout if result.returncode == 0 else ''


def safe_codes():
    codes = set(CATEGORIES) | {'NATIVE_FAILURE_DETAILS_WITHHELD', 'NATIVE_LOCK_VALIDATOR_FAILED',
            'NODE_BINARY_MISSING', 'PHASE_SCRIPT_FAILED', 'NATIVE_LAUNCH_FAIL', 'NATIVE_LAUNCH_EXITED',
            'MAESTRO_DEBUG_DIR_MISSING', 'MAESTRO_DEBUG_NO_COMMANDS',
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


def pod_targets():
    """Public target names already pinned in the committed Podfile.lock."""
    result = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:native/Podfile.lock'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    if result.returncode != 0:
        return set()
    return set(re.findall(r'^- ([A-Za-z0-9_+-]+) \(', result.stdout, re.MULTILINE))


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
    allowed, codes, locations, records = safe_codes(), set(), {}, []
    tracked, packages = public_source_index()
    pods, targets = pod_targets(), []
    tool_line = re.compile(r'^(?:CompileC|SwiftCompile|Ld|PhaseScriptExecution|CodeSign)\b[^\n]*/([A-Za-z0-9_+-]+)\.build/')
    # SwiftDriver/SwiftCompile print the target as the first alias word, e.g.
    # "SwiftDriver RNScreens arm64 com.apple.xcode.tools.swift.compiler" or
    # "SwiftCompile normal arm64 Compiling X.swift (...RNScreens...)" — the
    # Pods.build path still wins when present.
    tool_alias = re.compile(r'^(?:SwiftDriver|SwiftCompile)\s+(?:normal\s+\S+\s+)?([A-Za-z][A-Za-z0-9_+-]*)\b')
    error_line = re.compile(r'\berror\b', re.IGNORECASE)
    recent_tool, recent_tool_line = None, -1
    for path in map(pathlib.Path, paths):
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
            raise ValueError('DIAGNOSTIC_INPUT_REJECTED')
        with path.open(encoding='utf-8', errors='replace') as stream:
            for lineno, line in enumerate(stream):
                if len(line) > 65536:
                    continue
                codes.update(token for token in re.findall(r'\b[A-Z][A-Z0-9_]{2,120}\b', line)
                             if token in allowed or token.startswith(('PLIST_SENSITIVE_KEY_', 'BUNDLE_PLATFORM_SUPPORTED_',
                                                    'BUNDLE_PLATFORM_NAME_', 'BUNDLE_PLATFORM_SDK_')))
                codes.update(token for token in re.findall(r'\bMAESTRO_STEP_\d+_[A-Z0-9]{1,40}\b', line))
                codes.update(token for token in re.findall(r'\bMAESTRO_CONSOLE_[A-Z0-9]{2,64}\b', line))
                for code, pattern in CATEGORIES.items():
                    if re.search(pattern, line, re.IGNORECASE):
                        codes.add(code)
                if error_line.search(line):
                    # Attribute the error to a public pod/node package only when
                    # its install path appears verbatim — never copy the line
                    # and never match a bare name (e.g. react/renderer).
                    pod_hit = re.search(r'ios/Pods/([A-Za-z0-9_+-]+)', line)
                    if pod_hit and pod_hit[1] in pods and pod_hit[1] not in targets:
                        targets.append(pod_hit[1])
                    pkg_hit = re.search(r'node_modules/((?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+)', line)
                    if pkg_hit and pkg_hit[1] in packages and pkg_hit[1] not in targets:
                        targets.append(pkg_hit[1])
                    if len(records) < 12:
                        record = record_error(line)
                        if record:
                            records.append(record)
                tool = tool_line.search(line)
                if not tool:
                    alias = tool_alias.match(line)
                    tool = alias if alias and alias[1] in pods else None
                if tool:
                    # Remember only the public pod/target name for attribution
                    # of a nearby error line; the command contents never copy.
                    recent_tool, recent_tool_line = tool[1], lineno
                if error_line.search(line) and recent_tool is not None and len(targets) < 10:
                    name = recent_tool if recent_tool in pods else None
                    if name and name not in targets:
                        targets.append(name)
                match = re.search(r'((?:src|scripts|node_modules|ios/Pods|ios)/[^\s:\"<>]+\.(?:tsx?|swift|mm?|cpp|h|py|rb|sh|a|tbd|dylib|o))(?::(\d{1,7}))?(?::\d{1,7})?', line.replace('\\', '/'))
                if match and re.search(r'\berror\b', line, re.IGNORECASE):
                    relative, number = match[1], int(match[2] or 1)
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
    report = {'schemaVersion': 1, 'kind': 'safe-ci-diagnostics', 'step': step,
              'codes': sorted(codes)[:32] or ['NATIVE_FAILURE_DETAILS_WITHHELD'],
              'sourceLocations': list(locations.values())[:10]}
    if records:
        report['errorRecords'] = records
    if targets:
        # Public pod target names nearest to error output (attribution only).
        report['failedTargets'] = targets
    return report


def record_error(line):
    """One bounded, path-free compiler/linker diagnostic line.

    Keeps only the failing file basename + line plus a word-level summary with
    every `/`-containing token (absolute or relative path) and every quoted run
    stripped — never runner paths, HOME values or script bodies.
    """
    # `file.ext:LINE:COL` compiler prefix anywhere in the line.
    match = re.search(r'((?:[A-Za-z]:)?[\\/]?[^\s"\'()]+\.(?:swift|mm?|cpp|cc|cxx|h|hh|hpp|hxx|m)):(\d{1,7}):(\d{1,7})?:\s*(?:fatal\s+)?error:\s*(.*)', line)
    record = {}
    if match:
        record['file'] = match[1].replace('\\', '/').rsplit('/', 1)[-1]
        record['line'] = int(match[2])
        summary = match[4]
    else:
        head = re.search(r'(?:fatal\s+)?error:\s*(.*)', line)
        if not head:
            head = re.search(r'(ld:.*|Undefined.*|duplicate symbol.*)', line)
        if not head:
            # Anything that is not a recognizable compiler/linker diagnostic
            # carries unclassifiable free text — publish a fixed marker only.
            return {'message': '<unclassified error>'}
        summary = head[1]
    summary = re.sub(r'["\'`][^"\'`]{0,200}["\'`]', '<q>', summary)
    # Path-shaped tokens keep only their basename (Foo.h), never directories.
    tokens = [token.replace('\\', '/').rsplit('/', 1)[-1] if ('/' in token or '\\' in token) else token for token in summary.split()]
    # Arbitrary free text still never copies: only compiler-shaped vocabulary
    # (plain words, source extensions, angle-bracket placeholders, short
    # punctuation groups) survives.
    tokens = [token if re.fullmatch(r'[A-Za-z0-9_.+\-:]+|<[^>]{0,40}>|\W{1,12}', token) else '<x>' for token in tokens]
    summary = ' '.join(tokens)
    if not summary.strip():
        return None
    record['message'] = summary[:160]
    return record


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
