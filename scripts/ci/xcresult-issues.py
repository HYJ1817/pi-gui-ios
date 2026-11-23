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


def get_build_results(bundle):
    # Xcode 16+ direct summary API. `--format` is invalid for build-results
    # (it prints help with rc 0), so always parse JSON from default output.
    result = run(['xcrun', 'xcresulttool', 'get', 'build-results', '--path', str(bundle)])
    if result.returncode != 0 or not result.stdout.lstrip().startswith('{'):
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def new_summaries(results):
    # New-format records: actionResult.issues.errorSummaries is a flat list of
    # IssueSummary objects with producingTarget/issueType/documentURL fields.
    for summary in (((results or {}).get('actionResult') or {}).get('issues') or {}).get('errorSummaries') or []:
        if isinstance(summary, dict):
            yield summary


def record_from(item, tracked):
    record = {}
    target = item.get('producingTarget') if isinstance(item, dict) else ''
    if isinstance(target, str) and re.fullmatch(r'[A-Za-z0-9_+.\- ]{1,80}', target):
        record['target'] = target
    issue_type = item.get('issueType') if isinstance(item, dict) else ''
    if isinstance(issue_type, str) and re.fullmatch(r'[A-Za-z0-9_ .\-]{1,40}', issue_type):
        record['issueType'] = issue_type
    # New format: documentURL + lineNumber (or documentLocationInCreatingWorkspace.url)
    url = item.get('documentURL') or ''
    line = item.get('lineNumber') or 0
    doc = item.get('documentLocationInCreatingWorkspace')
    if not url and isinstance(doc, dict):
        url = text(doc.get('url')) or (doc.get('url') if isinstance(doc.get('url'), str) else '')
    message = item.get('message') or ''
    if isinstance(message, str) and message:
        message = re.sub(r'["\'`][^"\'`]{0,200}["\'`]', '<q>', message)
        message = ' '.join(t.replace('\\', '/').rsplit('/', 1)[-1] if ('/' in t or '\\' in t) else t for t in message.split())
        record['message'] = message[:160]
    if url:
        path, found_line = location_parts(url)
        line = line or found_line
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
            else:
                record['location'].setdefault('dependency', 'external')
    return record


def collect(bundle):
    tracked = tracked_files()
    # Preferred: the Xcode 16+ `get build-results` summary (flat issue records).
    results = get_build_results(bundle)
    out = []
    if results is not None:
        for summary in new_summaries(results):
            if len(out) >= 16:
                break
            record = record_from(summary, tracked)
            if record:
                out.append(record)
        return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': True,
                'api': 'build-results', 'issues': out}
    root = get_object(bundle)
    if root is None:
        return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': False, 'issues': []}
    refs = []
    issues_node = root.get('issues') if isinstance(root, dict) else None
    for summary in values((issues_node or {}).get('errorSummaries')):
        ident = ref_id(summary)
        if ident:
            refs.append(ident)
        elif isinstance(summary, dict) and text(summary.get('producingTarget')):
            refs.append(summary)  # inline summary objects (older format)
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
    return {'schemaVersion': 1, 'kind': 'safe-ci-xcresult', 'observed': True, 'issues': out}


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
