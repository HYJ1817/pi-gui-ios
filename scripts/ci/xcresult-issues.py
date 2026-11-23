#!/usr/bin/env python3
"""Emit structurally-safe build issue records from an xcodebuild .xcresult bundle.

Reads ONLY xcresulttool JSON (never log text) and reports, per build error:
producingTarget (public pod/app name), issueType, and — when the referenced
file is tracked source — its repository-relative path + line. Raw messages,
absolute paths, and generated content are never copied.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, timeout=120, cwd=ROOT)
    return result


def tracked_files():
    result = run(['git', 'ls-files'])
    return set(result.stdout.splitlines()) if result.returncode == 0 else set()


def issues_from(bundle):
    result = run(['xcrun', 'xcresulttool', 'get', 'build-results',
                  '-path', str(bundle)])
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return data


def issue_entries(data):
    if not isinstance(data, dict):
        return []
    entries = []
    for key in ('errors', 'errorSummaries', 'analyzerWarnings', 'testFailures'):
        for item in data.get(key, []):
            if isinstance(item, dict):
                entries.append(item)
    for key in ('issues', 'errorSummaries'):
        sub = data.get(key)
        if isinstance(sub, dict):
            for item in sub.get('errorSummaries', []) or []:
                if isinstance(item, dict):
                    entries.append(item)
        elif isinstance(sub, list):
            for item in sub:
                if isinstance(item, dict):
                    entries.append(item)
    # build-results layout: issues -> {errorSummaries:[{issueType,producingTarget,documentLocationInCreatingWorkspace:{url}}], warningSummaries:...}
    issues = data.get('issues')
    if isinstance(issues, dict):
        for item in issues.get('errorSummaries', []) or []:
            if isinstance(item, dict):
                entries.append(item)
    return entries


def location_of(item):
    loc = item.get('documentLocationInCreatingWorkspace')
    if not isinstance(loc, dict):
        return None
    url = loc.get('url', '')
    if not isinstance(url, str):
        return None
    match = re.search(r'(?:src|scripts|node_modules|ios/Pods|ios)/([^\s\"<>]+?\.(?:tsx?|swift|mm?|cpp|h))#EndingColumnNumber=\d+&EndingLineNumber=(\d+)', url)
    if not match:
        match = re.search(r'((?:src|scripts|node_modules|ios/Pods|ios)/[^\s\"<>]+?\.(?:tsx?|swift|mm?|cpp|h))[^#]*(?:EndingLineNumber|line)=(\d+)', url)
    if match:
        return match[1], int(match[2])
    return None


def collect(bundle):
    data = issues_from(bundle)
    if data is None:
        return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': False, 'issues': []}
    tracked = tracked_files()
    out = []
    for item in issue_entries(data):
        if len(out) >= 16:
            break
        record = {}
        target = item.get('producingTarget')
        if isinstance(target, str) and re.fullmatch(r'[A-Za-z0-9_+.\- ]{1,80}', target):
            record['target'] = target
        kind = item.get('issueType')
        if isinstance(kind, str) and re.fullmatch(r'[A-Za-z0-9_ .\-]{1,40}', kind):
            record['issueType'] = kind
        loc = location_of(item)
        if loc and (loc[0] in tracked or loc[0].startswith('node_modules/') or loc[0].startswith('ios/Pods/')):
            record['location'] = {'path': loc[0] if loc[0] in tracked else None,
                                  'line': loc[1]}
            if loc[0].startswith('node_modules/'):
                record['location']['dependency'] = re.sub(r'^node_modules/((?:@[^/]+/)?[^/]+).*$', r'\1', loc[0])
            elif loc[0].startswith('ios/Pods/'):
                record['location']['dependency'] = 'cocoapods'
            elif loc[0].startswith('ios/'):
                record['location']['dependency'] = 'ios-generated'
        out.append(record)
    return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': True, 'issues': out}


if __name__ == '__main__':
    try:
        print(json.dumps(collect(pathlib.Path(sys.argv[1])), sort_keys=True))
    except Exception:
        print(json.dumps({'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': False, 'issues': []}))
        sys.exit(1)
