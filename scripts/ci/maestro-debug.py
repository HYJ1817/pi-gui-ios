#!/usr/bin/env python3
"""Reduce a Maestro --flatten-debug-output commands.json to public structure.

A MaestroCommand serializes as an object where exactly one key is non-null and
that key is the YAML verb (launchApp, tapOn, assertVisible...). The verb and the
command's ordinal position are already public: they come from the committed
.maestro/*.yaml files. Everything else — selector text, coordinates, error
payloads — is dropped.
"""
import json
import pathlib
import sys

OUTCOME = {'COMPLETED', 'WARNED', 'FAILED', 'SKIPPED'}


import re

# Java/Kotlin exception FQCNs are static source-level names, safe to report.
EXCEPTION = re.compile(r'\b((?:[a-z][a-z0-9_]*\.){2,}[A-Z][A-Za-z0-9]*(?:Exception|Error|Throwable|Timeout|InterruptedException))\b')
# Log levels and fixed verbs that carry no data.
LEVEL = re.compile(r'\b(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b')


def reduce_log(path, limit=12):
    """Exception class names + structural lines from a Maestro log, no payloads."""
    found, seen = [], set()
    try:
        stream = pathlib.Path(path).open(encoding='utf-8', errors='replace')
    except OSError:
        return found
    with stream:
        for line in stream:
            if len(line) > 8192:
                continue
            for match in EXCEPTION.finditer(line):
                name = match.group(1)
                if name not in seen:
                    seen.add(name)
                    found.append({'exception': name})
            if len(found) >= limit:
                break
    return found


def reduce(path):
    root = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    commands = root.get('commands') if isinstance(root, dict) else None
    if not isinstance(commands, list):
        raise ValueError('DEBUG_SCHEMA_REJECTED')
    reduced = []
    for index, item in enumerate(commands):
        if not isinstance(item, dict):
            continue
        command = item.get('command')
        kinds = [key for key, value in (command.items() if isinstance(command, dict) else [])
                 if value is not None]
        status = item.get('status')
        entry = {'index': index}
        if kinds:
            entry['verb'] = kinds[0] if len(kinds) == 1 else 'composite'
        if status in OUTCOME:
            entry['status'] = status.lower()
        reduced.append(entry)
    return {'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': reduced}


def collect_debug(directory):
    """Locate Maestro's debug artifacts under a --debug-output dir by basename."""
    root = pathlib.Path(directory)
    output = {'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': []}
    if not root.is_dir() or root.is_symlink():
        output['debugDir'] = 'missing'
        return output
    output['files'] = sorted({p.name for p in root.rglob('*') if p.is_file()})[:32]
    commands = next(root.rglob('commands.json'), None)
    if commands is not None:
        try:
            output = reduce(commands)
            output['files'] = sorted({p.name for p in root.rglob('*') if p.is_file()})[:32]
        except Exception:
            pass
    errors = []
    for name in ('maestro.log', 'device-xctest.log'):
        log = next(root.rglob(name), None)
        if log is not None:
            errors.extend(reduce_log(log))
    for log in sorted(root.rglob('xctest_runner_*.log')):
        errors.extend(reduce_log(log))
        if len(errors) >= 12:
            break
    if errors:
        output['errors'] = errors[:12]
    return output


def failed_marks(output):
    """Fixed diagnostic marks for the step log (allowlisted in safe-diagnostics)."""
    marks = []
    for entry in output.get('commands', []):
        if entry.get('status') == 'failed':
            verb = ''.join(c for c in str(entry.get('verb', 'unknown')).upper() if c.isalnum())
            marks.append(f"MAESTRO_STEP_{entry.get('index', 0)}_{verb or 'UNKNOWN'}")
    if output.get('debugDir') == 'missing':
        marks.append('MAESTRO_DEBUG_DIR_MISSING')
    elif not output.get('commands'):
        marks.append('MAESTRO_DEBUG_NO_COMMANDS')
    return marks


if __name__ == '__main__':
    try:
        output = collect_debug(sys.argv[1])
    except Exception:
        output = {'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': []}
    # Marks go to stdout (the step log); the JSON artifact goes to argv[2].
    for mark in failed_marks(output):
        print(mark)
    if len(sys.argv) > 2:
        try:
            pathlib.Path(sys.argv[2]).write_text(json.dumps(output, sort_keys=True) + '\n', encoding='utf-8')
        except OSError:
            pass
