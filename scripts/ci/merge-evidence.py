#!/usr/bin/env python3
"""Merge sanitized per-stage evidence directories into one canonical tree.

Inputs are directories each already produced by collect-evidence.py (the same
sanitizer that built today's artifact whitelist). Nothing raw is re-admitted:
only files matching the whitelist shapes are merged. Prints one fixed code.
"""
import json
import pathlib
import re
import shutil
import sys

STEPS = ('environment', 'npm', 'prebuild', 'pods', 'simulator-build',
         'iphone', 'ipad', 'device-build', 'ipa')
STEP_RE = re.compile(r'^NATIVE_STEP_[A-Z_]+_(PASSED|FAILED|NOT_RUN|INTERRUPTED|BOOTSTRAP_REQUIRED)$')
REPORTS = re.compile(r'^(iphone|ipad)-(native|dark|accessibility)(-debug)?\.(xml|json)$|^steps\.json$|^diagnostics\.json$|^environment\.json$')
SHOT = re.compile(r'^(00-shell-home|01-native-glass|02-interactions|03-navigation|04-keyboard-visible|05-native-motion|07-shell-sessions|08-shell-conversation|final|failure)\.png$')
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def read(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError()
    return path.read_bytes()


def merge_steps(dirs):
    # Each step is produced by exactly one stage, so collisions are rare;
    # prefer the last directory claiming a real status over 'not-run'.
    best = {}
    for directory in dirs:
        path = directory / 'reports' / 'steps.json'
        if not path.exists():
            continue
        data = json.loads(read(path, 1024 * 1024))
        if data.get('schemaVersion') != 1 or not isinstance(data.get('steps'), list):
            raise ValueError()
        for item in data['steps']:
            if (not isinstance(item, dict) or set(item) != {'step', 'status', 'code'}
                    or item['step'] not in STEPS
                    or item['status'] not in ('running', 'passed', 'failed', 'interrupted', 'bootstrap-required', 'not-run')
                    or not STEP_RE.match(item.get('code', ''))):
                raise ValueError()
            current = best.get(item['step'])
            if current is None or (current['status'] == 'not-run' and item['status'] != 'not-run'):
                best[item['step']] = item
    return {'schemaVersion': 1, 'sideStoreInstallVerified': False,
            'steps': [best.get(s, {'step': s, 'status': 'not-run',
                                 'code': 'NATIVE_STEP_' + s.upper().replace('-', '_') + '_NOT_RUN'})
                      for s in STEPS]}


def merge_diagnostics(dirs):
    out = []
    for directory in dirs:
        path = directory / 'reports' / 'diagnostics.json'
        if not path.exists():
            continue
        data = json.loads(read(path, 4 * 1024 * 1024))
        if data.get('schemaVersion') != 1 or not isinstance(data.get('diagnostics'), list):
            raise ValueError()
        for record in data['diagnostics']:
            if not isinstance(record, dict) or record.get('kind') != 'safe-ci-diagnostics' or \
                    record.get('step') not in STEPS or not isinstance(record.get('codes'), list):
                raise ValueError()
            out.append(record)
    return {'schemaVersion': 1, 'diagnostics': out}


def merge_environment(dirs):
    best = None
    for directory in dirs:
        path = directory / 'reports' / 'environment.json'
        if not path.exists():
            continue
        data = json.loads(read(path, 128 * 1024))
        if not isinstance(data, dict) or data.get('schemaVersion') != 1:
            raise ValueError()
        if best is None or (not best.get('observed') and data.get('observed')):
            best = data
    return best or {'schemaVersion': 1, 'observed': False, 'versions': {}}


def main():
    try:
        root, out = map(pathlib.Path, (sys.argv[1], sys.argv[2]))
        dirs = sorted(d for d in root.iterdir() if d.is_dir() and not d.is_symlink())
        reports = out / 'reports'
        reports.mkdir(parents=True, exist_ok=True)
        (reports / 'steps.json').write_text(json.dumps(merge_steps(dirs), sort_keys=True) + '\n', encoding='utf-8')
        (reports / 'diagnostics.json').write_text(json.dumps(merge_diagnostics(dirs), sort_keys=True) + '\n', encoding='utf-8')
        (reports / 'environment.json').write_text(json.dumps(merge_environment(dirs), sort_keys=True) + '\n', encoding='utf-8')
        for directory in dirs:
            source = directory / 'reports'
            if source.is_dir():
                for path in source.iterdir():
                    target = reports / path.name
                    if REPORTS.match(path.name) and path.name not in ('steps.json', 'diagnostics.json', 'environment.json') \
                            and not target.exists():
                        if path.suffix == '.xml' or path.suffix == '.json':
                            read(path, 4 * 1024 * 1024)
                        shutil.copyfile(path, target)
            shots = directory / 'screenshots'
            if shots.is_dir():
                for png in shots.rglob('*.png'):
                    relative = png.relative_to(shots).as_posix()
                    device, name = relative.split('/', 1)
                    if device not in ('iphone', 'ipad') or (png.parent.name in ('dark', 'accessibility')
                            and png.name not in ('home.png', 'appearance.png', 'reduce-transparency.png', 'dynamic-type.png')) \
                            or (png.parent.name == device and not SHOT.match(png.name)) \
                            or (png.parent.name not in (device, 'dark', 'accessibility')):
                        continue
                    if read(png, 32 * 1024 * 1024)[:8] != PNG_MAGIC:
                        raise ValueError()
                    target = out / 'screenshots' / device / png.relative_to(shots / device).as_posix()
                    if not target.exists():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(png, target)
        print('SYNTHETIC_EVIDENCE_MERGED')
        return 0
    except Exception:
        print('SYNTHETIC_EVIDENCE_REJECTED')
        return 1


if __name__ == '__main__':
    sys.exit(main())
