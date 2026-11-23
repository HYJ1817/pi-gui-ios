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
    result = subprocess.run(['xcrun', 'xcresulttool', 'get', 'build-results', '--format', 'json', '-path', sys.argv[1]],
                            capture_output=True, text=True)
    print('rc', result.returncode)
    try:
        print(json.dumps(shape(json.loads(result.stdout)), indent=1)[:3000])
    except Exception as error:
        print('parse fail', type(error).__name__)
        # Non-JSON output: report only the first lines' word shapes so the
        # format can be identified without copying message text.
        print('stdout-head:', repr(' '.join(result.stdout.split())[:160]))
        print('stderr-head:', repr(' '.join(result.stderr.split())[:160]))


if __name__ == '__main__':
    main()
