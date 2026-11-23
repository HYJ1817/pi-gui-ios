#!/usr/bin/env python3
"""Emit structurally-safe build issue records from an xcodebuild .xcresult bundle.

Uses the Xcode 16+ JSON object API (`xcresulttool get object --legacy`). For each
build errorSummary ref it resolves the issue object and reports only:
producingTarget (public pod/app name), issueType, and — when the referenced file
is tracked source — its repository-relative path + line. Raw messages, absolute
paths, and generated content are never copied.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def run(args, timeout=120):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, timeout=timeout, cwd=ROOT)


def tracked_files():
    result = run(['git', 'ls-files'])
    return set(result.stdout.splitlines()) if result.returncode == 0 else set()


def get_object(bundle, object_id=None, legacy=True):
    cmd = ['xcrun', 'xcresulttool', 'get', 'object', '--format', 'json', '--path', str(bundle)]
    if legacy:
        cmd.insert(4, '--legacy')
    if object_id:
        cmd += ['--id', object_id]
    result = run(cmd)
    if result.returncode != 0 and legacy:
        return get_object(bundle, object_id, legacy=False)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def values(node):
    if isinstance(node, dict):
        children = node.get('_values')
        if isinstance(children, list):
            return [item for item in children if isinstance(item, dict)]
    return []


def text(node):
    if isinstance(node, dict):
        value = node.get('_value')
        if isinstance(value, str):
            return value
    return ''


def ref_id(node):
    if isinstance(node, dict):
        return text(node.get('id'))
    return ''


def unwrap_summary(node):
    # IssueSummary has fields producingTarget/issueType/documentLocationInCreatingWorkspace
    # each a { _type, _value } leaf.
    return node


def location_parts(url):
    match = re.search(r'((?:src|scripts|node_modules|ios/Pods|ios)/[^\s\"<>]+?\.(?:tsx?|swift|mm?|cpp|h))', url.replace('%23', '#').split('#')[0])
    line = re.search(r'EndingLineNumber=(\d+)', url)
    return (match[1] if match else None, int(line[1]) if line else 0)


def collect(bundle):
    root = get_object(bundle)
    if root is None:
        return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': False, 'issues': []}
    tracked = tracked_files()
    debug = {}
    if isinstance(root, dict):
        debug['rootKeys'] = sorted(root.keys())
        issues_node = root.get('issues') or {}
        if isinstance(issues_node, dict):
            debug['issuesKeys'] = sorted(issues_node.keys())
            es = issues_node.get('errorSummaries')
            if isinstance(es, dict):
                debug['errorSummariesType'] = text(es.get('_type').get('name') if isinstance(es.get('_type'), dict) else es.get('_type'))
                debug['errorSummariesCount'] = len(es.get('_values') or [])
                first = (es.get('_values') or [{}])[0]
                if isinstance(first, dict):
                    debug['errorSummaryFirstKeys'] = sorted(first.keys())
                    debug['errorSummaryFirstType'] = text(first.get('_type').get('name') if isinstance(first.get('_type'), dict) else first.get('_type'))
                    debug['errorSummaryFirstId'] = ref_id(first)[:8] if ref_id(first) else ''
                    # Print all leaf scalar names+types for schema debugging
                    debug['errorSummaryFirstLeaves'] = sorted({k for k,v in first.items()})
    refs = []
    issues_node = root.get('issues') if isinstance(root, dict) else None
    for summary in values((issues_node or {}).get('errorSummaries')):
        ident = ref_id(summary)
        if ident:
            refs.append(ident)
        elif isinstance(summary, dict) and text(summary.get('producingTarget')):
            refs.append(summary)  # inline summary objects (older format)
    out = []
    pods = pod_names()
    for ref in refs[:16]:
        item = get_object(bundle, ref) if isinstance(ref, str) else ref
        if not isinstance(item, dict):
            continue
        record = {}
        target = text(item.get('producingTarget'))
        if re.fullmatch(r'[A-Za-z0-9_+.\- ]{1,80}', target):
            record['target'] = target
        issue_type = text(item.get('issueType'))
        if re.fullmatch(r'[A-Za-z0-9_ .\-]{1,40}', issue_type):
            record['issueType'] = issue_type
        doc = item.get('documentLocationInCreatingWorkspace')
        url = text(doc.get('url')) if isinstance(doc, dict) else ''
        if url:
            path, line = location_parts(url)
            if path:
                record['location'] = {'line': line}
                if path in tracked:
                    record['location']['path'] = path
                elif path.startswith('node_modules/'):
                    record['location']['dependency'] = re.sub(r'^node_modules/((?:@[^/]+/)?[^/]+).*$', r'\1', path)
                elif path.startswith('ios/Pods/'):
                    record['location']['dependency'] = 'cocoapods'
                elif path.startswith('ios/'):
                    record['location']['dependency'] = 'ios-generated'
        out.append(record)
    result = {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': True, 'issues': out}
    if debug:
        result['debug'] = debug
    return result


def pod_names():
    result = run(['git', 'show', 'HEAD:native/Podfile.lock'])
    if result.returncode != 0:
        return set()
    return set(re.findall(r'^- ([A-Za-z0-9_+-]+) \(', result.stdout, re.MULTILINE))


if __name__ == '__main__':
    try:
        print(json.dumps(collect(pathlib.Path(sys.argv[1])), sort_keys=True))
    except Exception:
        print(json.dumps({'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': False, 'issues': []}))
        sys.exit(1)
