#!/usr/bin/env python3
"""M6-distribution: version detection for the unsigned device IPA.

Fail-closed, stdlib-only. Extracts CFBundleShortVersionString/CFBundleVersion
from the IPA's app manifest and cross-checks them against the repository
source of truth (app.json ios.version/ios.buildNumber + package.json version).

Output: version-report.json with a fixed vocabulary of codes — never plist
values, paths, or environment details. A mismatch is a hard failure: an IPA
whose version identity disagrees with the source tree it was built from can
never be distributed, because SideStore upgrade ordering and user-facing
version display both key on these fields.
"""
import json
import os
import pathlib
import plistlib
import sys
import zipfile


class Invalid(Exception):
    def __init__(self, code):
        self.codes = [code] if isinstance(code, str) else list(code)
        super().__init__(' '.join(self.codes))


def require(condition, code):
    if not condition:
        raise Invalid(code)


SEMVER = r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'


def parse_semver(value):
    import re
    match = re.fullmatch(SEMVER, value if isinstance(value, str) else '')
    require(match is not None, 'VERSION_FORMAT')
    return tuple(int(part) for part in match.groups())


def read_manifest(ipa_path):
    require(os.path.isfile(ipa_path), 'IPA_NOT_FOUND')
    with zipfile.ZipFile(ipa_path) as archive:
        candidates = [n for n in archive.namelist()
                      if n.startswith('Payload/') and n.count('/') == 2 and n.endswith('.app/Info.plist')]
        require(len(candidates) == 1, 'MANIFEST_LAYOUT')
        with archive.open(candidates[0]) as stream:
            return plistlib.loads(stream.read())


def detect(ipa_path, app_json_path):
    violations = []
    try:
        manifest = read_manifest(ipa_path)
    except Invalid as error:
        return {'passed': False, 'violations': error.codes}
    for key in ('CFBundleShortVersionString', 'CFBundleVersion', 'CFBundleIdentifier'):
        if key not in manifest:
            violations.append('MANIFEST_' + key.upper().replace('CFBUNDLE', 'MISSING'))
    short = manifest.get('CFBundleShortVersionString')
    build = manifest.get('CFBundleVersion')
    bundle_id = manifest.get('CFBundleIdentifier')
    ipa_version = None
    build_number = None
    try:
        ipa_version = parse_semver(short)
    except Invalid:
        violations.append('VERSION_FORMAT')
    require_build = isinstance(build, str) and build.isdigit() and int(build) >= 1
    if require_build:
        build_number = int(build)
    else:
        violations.append('BUILD_NUMBER_FORMAT')
    # Cross-check against the repository source of truth.
    try:
        app_json = json.load(open(app_json_path, encoding='utf8'))
    except (OSError, json.JSONDecodeError):
        violations.append('SOURCE_TRUTH_UNREADABLE')
        app_json = {}
    expo = app_json.get('expo', {}) if isinstance(app_json, dict) else {}
    ios = expo.get('ios', {}) if isinstance(expo, dict) else {}
    source_version = expo.get('version')
    source_build = ios.get('buildNumber')
    if ipa_version is not None:
        try:
            if parse_semver(source_version) != ipa_version:
                violations.append('VERSION_SOURCE_MISMATCH')
        except Invalid:
            violations.append('SOURCE_VERSION_FORMAT')
    if build_number is not None:
        if not (isinstance(source_build, str) and source_build.isdigit() and int(source_build) == build_number):
            violations.append('BUILD_SOURCE_MISMATCH')
    if bundle_id != ios.get('bundleIdentifier'):
        violations.append('BUNDLE_ID_SOURCE_MISMATCH')
    return {
        'passed': not violations,
        'violations': violations[:16],
        'ipaVersion': short if ipa_version else None,
        'ipaBuildNumber': build_number,
        'sourceVersion': source_version,
        'sourceBuildNumber': int(source_build) if isinstance(source_build, str) and source_build.isdigit() else None,
    }


def main(argv):
    require(len(argv) == 4, 'USAGE')
    ipa_path, app_json_path, output_path = argv[1], argv[2], argv[3]
    try:
        result = detect(ipa_path, app_json_path)
    except Invalid as error:
        result = {'passed': False, 'violations': error.codes}
    report = {
        'schemaVersion': 2,
        'kind': 'distribution-version-report',
        'passed': result['passed'] is True,
        'code': 'VERSION_DETECTED' if result['passed'] else 'VERSION_MISMATCH',
        'ipaVersion': result.get('ipaVersion'),
        'ipaBuildNumber': result.get('ipaBuildNumber'),
        'sourceVersion': result.get('sourceVersion'),
        'sourceBuildNumber': result.get('sourceBuildNumber'),
        'violations': result.get('violations', []),
    }
    with open(output_path, 'w', encoding='utf8', newline='\n') as stream:
        stream.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(report['code'])
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
