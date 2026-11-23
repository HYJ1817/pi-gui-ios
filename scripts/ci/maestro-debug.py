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


if __name__ == '__main__':
    try:
        output = reduce(sys.argv[1])
    except Exception:
        output = {'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': []}
    if len(sys.argv) > 2:
        output['errors'] = reduce_log(sys.argv[2])
    print(json.dumps(output, sort_keys=True))
