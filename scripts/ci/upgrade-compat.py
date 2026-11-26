#!/usr/bin/env python3
"""M6-distribution: upgrade/downgrade compatibility verification (hardened).

Automated structural verification — NOT a device test. Real SideStore
refresh/overwrite behavior belongs to the final user device checklist.

FSEC-003 hardening — strict input validation, nothing is optional:
  - Version reports must be complete exact-schema `distribution-version-report`
    documents: schemaVersion 2, exact kind, passed true, canonical semver
    string, STRICT integer build number (Python bool is an int subclass —
    isinstance(True, int) is True, so booleans are rejected explicitly),
    valid 64-hex ipaSha256.
  - Verification reports must be complete `unsigned-device-archive` documents
    with code IPA_VERIFIED, valid sha256, nonempty bundle identity, and the
    exact ['arm64'] architecture list.
  - Chain binding: the candidate verification report's sha256 must equal the
    candidate version report's ipaSha256 — the same digest must describe the
    bytes both reports inspected (same for baseline). The binding is recorded
    in the output so release-draft can verify it was checked.
  - Absent keys are never 'equal': two missing bundle identifiers is a
    violation, not a match.
"""
import json
import re
import sys

SEMVER_RE = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
HEX64 = re.compile(r'[0-9a-f]{64}')
BUNDLE_RE = re.compile(r'[A-Za-z0-9.-]{3,128}')
SHA256_HEX_LEN = 64


class Invalid(Exception):
    def __init__(self, code):
        self.codes = [code] if isinstance(code, str) else list(code)
        super().__init__(' '.join(self.codes))


def strict_int(value, low=1, high=2**31 - 1):
    """Integers only — booleans are int subclass instances and must not pass."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if low <= value <= high else None


def load_json(path):
    try:
        with open(path, encoding='utf8') as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def validate_version_report(report, prefix):
    if report is None:
        raise Invalid(prefix + '_UNREADABLE')
    if report.get('schemaVersion') != 2 or report.get('kind') != 'distribution-version-report':
        raise Invalid(prefix + '_SCHEMA')
    if report.get('passed') is not True:
        raise Invalid(prefix + '_NOT_PASSING')
    version = report.get('ipaVersion')
    if not (isinstance(version, str) and SEMVER_RE.fullmatch(version)):
        raise Invalid(prefix + '_SCHEMA')
    build = strict_int(report.get('ipaBuildNumber'))
    if build is None:
        raise Invalid(prefix + '_SCHEMA')
    sha = report.get('ipaSha256')
    if not (isinstance(sha, str) and len(sha) == SHA256_HEX_LEN and HEX64.fullmatch(sha)):
        raise Invalid(prefix + '_SCHEMA')
    return {'version': version, 'build': build, 'sha256': sha,
            'semver': tuple(int(p) for p in version.split('.'))}


def validate_verify_report(report, prefix):
    if report is None:
        raise Invalid(prefix + '_UNREADABLE')
    if report.get('schemaVersion') != 2 or report.get('kind') != 'unsigned-device-archive':
        raise Invalid(prefix + '_SCHEMA')
    if report.get('passed') is not True or report.get('code') != 'IPA_VERIFIED':
        raise Invalid(prefix + '_NOT_PASSING')
    sha = report.get('sha256')
    if not (isinstance(sha, str) and len(sha) == SHA256_HEX_LEN and HEX64.fullmatch(sha)):
        raise Invalid(prefix + '_SCHEMA')
    bundle = report.get('bundleId')
    if not (isinstance(bundle, str) and BUNDLE_RE.fullmatch(bundle)):
        raise Invalid(prefix + '_SCHEMA')
    if report.get('architectures') != ['arm64']:
        raise Invalid(prefix + '_SCHEMA')
    return {'sha256': sha, 'bundleId': bundle}


def compare(base_v, cand_v, base_ver, cand_ver):
    violations = []
    if cand_v['build'] <= base_v['build']:
        violations.append('UPGRADE_MONOTONIC')
    if cand_v['semver'] < base_v['semver']:
        violations.append('VERSION_REGRESSION')
    if base_ver['bundleId'] != cand_ver['bundleId']:
        violations.append('BUNDLE_IDENTITY_STABLE')
    # Chain binding: each version report must describe exactly the bytes its
    # companion verification report inspected. Same-digest equality is the
    # only meaningful offline binding between the two documents.
    if base_v['sha256'] != base_ver['sha256']:
        violations.append('BASELINE_CHAIN_BINDING')
    if cand_v['sha256'] != cand_ver['sha256']:
        violations.append('CANDIDATE_CHAIN_BINDING')
    return list(dict.fromkeys(violations))


def main(argv):
    if len(argv) != 6:
        print('usage: upgrade-compat.py <base-version.json> <cand-version.json> <base-verify.json> <cand-verify.json> <out.json>')
        return 2
    violations = []
    bindings = {}
    try:
        base_v = validate_version_report(load_json(argv[1]), 'BASELINE_VERSION')
        cand_v = validate_version_report(load_json(argv[2]), 'CANDIDATE_VERSION')
        base_ver = validate_verify_report(load_json(argv[3]), 'BASELINE_VERIFY')
        cand_ver = validate_verify_report(load_json(argv[4]), 'CANDIDATE_VERIFY')
        violations = compare(base_v, cand_v, base_ver, cand_ver)
        bindings = {
            'baselineSha256': base_v['sha256'],
            'candidateSha256': cand_v['sha256'],
            'baselineBuild': base_v['build'],
            'candidateBuild': cand_v['build'],
        }
    except Invalid as error:
        violations = error.codes
    report = {
        'schemaVersion': 2,
        'kind': 'distribution-upgrade-compat',
        'passed': not violations,
        'code': 'UPGRADE_COMPATIBLE' if not violations else 'UPGRADE_INCOMPATIBLE',
        'violations': violations[:16],
        'bindings': bindings,
        'scope': 'structural-automation-only',
        'deviceSemantics': 'SideStore refresh/overwrite/revoke behavior is verified by the final user device checklist, never by this report',
    }
    try:
        with open(argv[5], 'w', encoding='utf8', newline='\n') as stream:
            stream.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
    except OSError:
        print('REPORT_UNWRITABLE')
        return 1
    print(report['code'])
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
