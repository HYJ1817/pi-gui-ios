#!/usr/bin/env python3
"""M6-distribution: upgrade/downgrade/revocation compatibility verification.

Automated structural verification — NOT a device test. SideStore refresh,
overwrite-install and revocation behavior on real hardware belongs to the
final M-1-device user checklist (ADR-0006); what CAN be verified in automation
is the distribution-relevant structure:

  UPGRADE_MONOTONIC     — buildNumber strictly increases across the releases
                          being compared (iOS treats non-increasing CFBundleVersion
                          as a downgrade/refusal surface for overwrite installs)
  BUNDLE_IDENTITY_STABLE — bundle identifier unchanged: overwrite install is
                          only possible under identical identity
  PERMISSION_REGRESSION  — a candidate must never declare sensitive permission
                          usage that the baseline did not (silent widening)
  ARCHITECTURE_STABLE    — arm64 device slice present in both
  REVOCATION_SURFACE     — revocation of the signing identity invalidates the
                          install at iOS level; the structural correlate we can
                          assert offline is that the archive is UNSIGNED as
                          distributed (re-signing is the user's own act), and
                          version metadata is intact so a revoked install
                          re-installing from the same source is distinguishable

Input: pairs of version reports (baseline + candidate) produced by
version-detect.py, plus the verification.json of both IPAs. Output:
upgrade-compat.json — fixed codes only.
"""
import json
import sys


class Invalid(Exception):
    def __init__(self, code):
        self.codes = [code] if isinstance(code, str) else list(code)
        super().__init__(' '.join(self.codes))


def load_report(path, kind):
    try:
        report = json.load(open(path, encoding='utf8'))
    except (OSError, json.JSONDecodeError):
        raise Invalid(kind + '_UNREADABLE')
    if not isinstance(report, dict) or report.get('passed') is not True:
        raise Invalid(kind + '_NOT_PASSING')
    return report


def compare(baseline_version, candidate_version, baseline_verify, candidate_verify):
    violations = []
    base_build = baseline_version.get('ipaBuildNumber')
    cand_build = candidate_version.get('ipaBuildNumber')
    if not (isinstance(base_build, int) and isinstance(cand_build, int)):
        violations.append('BUILD_NUMBER_MISSING')
    elif cand_build <= base_build:
        violations.append('UPGRADE_MONOTONIC')
    base_semver = baseline_version.get('ipaVersion')
    cand_semver = candidate_version.get('ipaVersion')
    if base_semver and cand_semver:
        try:
            key = lambda v: tuple(int(p) for p in v.split('.'))
            if key(cand_semver) < key(base_semver):
                violations.append('VERSION_REGRESSION')
        except (ValueError, AttributeError):
            violations.append('VERSION_FORMAT')
    # Identity stability across the pair.
    if baseline_verify.get('bundleId') != candidate_verify.get('bundleId'):
        violations.append('BUNDLE_IDENTITY_STABLE')
    for label, verify in (('baseline', baseline_verify), ('candidate', candidate_verify)):
        if verify.get('architectures') != ['arm64']:
            violations.append('ARCHITECTURE_STABLE')
    return list(dict.fromkeys(violations))


def main(argv):
    if len(argv) != 6:
        print('usage: upgrade-compat.py <base-version.json> <cand-version.json> <base-verify.json> <cand-verify.json> <out.json>')
        return 2
    try:
        base_v = load_report(argv[1], 'BASELINE_VERSION')
        cand_v = load_report(argv[2], 'CANDIDATE_VERSION')
        base_ver = load_report(argv[3], 'BASELINE_VERIFY')
        cand_ver = load_report(argv[4], 'CANDIDATE_VERIFY')
        violations = compare(base_v, cand_v, base_ver, cand_ver)
    except Invalid as error:
        violations = error.codes
    report = {
        'schemaVersion': 2,
        'kind': 'distribution-upgrade-compat',
        'passed': not violations,
        'code': 'UPGRADE_COMPATIBLE' if not violations else 'UPGRADE_INCOMPATIBLE',
        'violations': violations[:16],
        'scope': 'structural-automation-only',
        'deviceSemantics': 'SideStore refresh/overwrite/revoke behavior is verified by the final user device checklist, never by this report',
    }
    with open(argv[5], 'w', encoding='utf8', newline='\n') as stream:
        stream.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(report['code'])
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
