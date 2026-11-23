#!/usr/bin/env python3
"""Print the JSON shape of `xcresulttool get build-results` (key names only)."""
import json
import subprocess
import sys


def shape(value, depth=0):
    if depth > 3:
        return '...'
    if isinstance(value, dict):
        return {key: shape(child, depth + 1) for key, child in list(value.items())[:12]}
    if isinstance(value, list):
        return [shape(value[0], depth + 1)] if value else []
    return type(value).__name__


def main():
    help_result = subprocess.run(['xcrun', 'xcresulttool', 'get', '--help'],
                                 capture_output=True, text=True)
    print('get-help:', ' '.join(help_result.stdout.split())[:600])
    for label, cmd in (
            ('build-results-json', ['xcrun', 'xcresulttool', 'get', 'build-results', '--format', 'json', '-path', sys.argv[1]]),
            ('build-results-plain', ['xcrun', 'xcresulttool', 'get', 'build-results', '-path', sys.argv[1]]),
            ('object-root', ['xcrun', 'xcresulttool', 'get', 'object', '--legacy', '--format', 'json', '--path', sys.argv[1]])):
        result = subprocess.run(cmd, capture_output=True, text=True)
        print(label, 'rc', result.returncode)
        try:
            print(json.dumps(shape(json.loads(result.stdout)), indent=1)[:2500])
        except Exception:
            print(label, 'stdout-head:', repr(' '.join(result.stdout.split())[:140]))


if __name__ == '__main__':
    main()
