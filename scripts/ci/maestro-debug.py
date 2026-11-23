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
        print(json.dumps(reduce(sys.argv[1]), sort_keys=True))
    except Exception:
        print(json.dumps({'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': []}))
