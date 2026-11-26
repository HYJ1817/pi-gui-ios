#!/usr/bin/env python3
"""M6-distribution: version detection for the unsigned device IPA.

Fail-closed, stdlib-only, bounded parsing, sanitized failure containment
(FSEC-001 hardening). Extracts CFBundleShortVersionString/CFBundleVersion
from the IPA's app manifest and cross-checks them against the repository
source of truth (app.json). The report carries the inspected IPA's sha256 so
downstream release-draft assembly can bind verdicts to exact bytes (FSEC-002).

Security contract:
  - Archive enumeration is bounded BEFORE any decompression: entry count,
    per-entry uncompressed size, aggregate uncompressed size, and the
    compression ratio of the manifest entry are all capped. A crafted bomb
    is rejected by metadata alone — no inflated bytes are ever produced.
  - Every parse/type/format failure becomes a fixed-code report. No raw
    traceback, no input values, no filesystem paths ever reach the output.
  - Numbers are ASCII-decimal only (str.isdigit accepts Unicode digits —
    that is exactly the kind of input this tool must reject).
"""
import hashlib
import json
import os
import plistlib
import re
import sys
import zipfile

MAX_ENTRIES = 100000
MAX_AGGREGATE = 2 * 1024 * 1024 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_RATIO = 100  # manifest compression ratio cap; real plists compress ~4x

SEMVER_RE = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
ASCII_DIGITS = re.compile(r'[0-9]+')


class Invalid(Exception):
    def __init__(self, code):
        self.codes = [code] if isinstance(code, str) else list(code)
        super().__init__(' '.join(self.codes))


def require(condition, code):
    if not condition:
        raise Invalid(code)


def parse_semver(value):
    match = SEMVER_RE.fullmatch(value) if isinstance(value, str) and len(value) <= 32 else None
    require(match is not None, 'VERSION_FORMAT')
    return tuple(int(part) for part in match.groups())


def ascii_uint(value, maximum=2**31 - 1):
    if not (isinstance(value, str) and 1 <= len(value) <= 10 and ASCII_DIGITS.fullmatch(value)):
        return None
    number = int(value)
    return number if 1 <= number <= maximum else None


def ipa_digest(ipa_path):
    h = hashlib.sha256()
    with open(ipa_path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def read_manifest(ipa_path):
    """Bounded read: never decompresses anything before size/ratio metadata
    passes. Returns the parsed plist or raises Invalid with a fixed code."""
    try:
        stat = os.stat(ipa_path)
    except OSError:
        raise Invalid('IPA_NOT_FOUND')
    require(stat.st_size <= MAX_AGGREGATE, 'ARCHIVE_SIZE')
    try:
        archive = zipfile.ZipFile(ipa_path)
    except (zipfile.BadZipFile, OSError, ValueError):
        raise Invalid('ARCHIVE_NOT_ZIP')
    with archive:
        try:
            entries = archive.infolist()
        except (zipfile.BadZipFile, OSError):
            raise Invalid('ARCHIVE_NOT_ZIP')
        require(0 < len(entries) <= MAX_ENTRIES, 'ARCHIVE_ENTRIES')
        total = 0
        manifest_entry = None
        for entry in entries:
            total += entry.file_size
            require(total <= MAX_AGGREGATE, 'ARCHIVE_SIZE')
            require(entry.file_size <= MAX_AGGREGATE, 'ARCHIVE_SIZE')
            name = entry.filename
            if (name.startswith('Payload/') and name.count('/') == 2
                    and name.endswith('.app/Info.plist')):
                require(manifest_entry is None, 'MANIFEST_LAYOUT')
                manifest_entry = entry
        require(manifest_entry is not None, 'MANIFEST_MISSING')
        # Bounded decompression: the uncompressed size and the compression
        # ratio are zip metadata — checked BEFORE a single byte is inflated.
        require(0 < manifest_entry.file_size <= MAX_MANIFEST, 'MANIFEST_SIZE')
        if manifest_entry.compress_size > 0:
            ratio = manifest_entry.file_size / max(1, manifest_entry.compress_size)
            require(ratio <= MAX_RATIO, 'MANIFEST_RATIO')
        try:
            with archive.open(manifest_entry) as stream:
                raw = stream.read(MAX_MANIFEST + 1)
        except (zipfile.BadZipFile, OSError, RuntimeError, ValueError):
            raise Invalid('MANIFEST_UNREADABLE')
        require(len(raw) <= MAX_MANIFEST, 'MANIFEST_SIZE')
    try:
        manifest = plistlib.loads(raw)
    except Exception:
        raise Invalid('MANIFEST_INVALID')
    require(isinstance(manifest, dict), 'MANIFEST_INVALID')
    return manifest


def detect(ipa_path, app_json_path):
    violations = []
    digest = None
    try:
        digest = ipa_digest(ipa_path)
    except OSError:
        return {'passed': False, 'violations': ['IPA_NOT_FOUND'], 'ipaSha256': None}
    try:
        manifest = read_manifest(ipa_path)
    except Invalid as error:
        return {'passed': False, 'violations': error.codes, 'ipaSha256': digest}
    for key, code in (('CFBundleShortVersionString', 'MISSING_SHORT_VERSION'),
                      ('CFBundleVersion', 'MISSING_BUILD_NUMBER'),
                      ('CFBundleIdentifier', 'MISSING_BUNDLE_ID')):
        if key not in manifest:
            violations.append(code)
    short = manifest.get('CFBundleShortVersionString')
    build = manifest.get('CFBundleVersion')
    bundle_id = manifest.get('CFBundleIdentifier')
    ipa_version = None
    build_number = None
    try:
        ipa_version = parse_semver(short)
    except Invalid:
        violations.append('VERSION_FORMAT')
    build_number = ascii_uint(build)
    if build_number is None:
        violations.append('BUILD_NUMBER_FORMAT')
    # Cross-check against the repository source of truth. The source file is
    # itself untrusted input: container types are validated before use and a
    # malformed source is a violation, never a crash.
    try:
        with open(app_json_path, encoding='utf8') as stream:
            app_json = json.load(stream)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        violations.append('SOURCE_TRUTH_UNREADABLE')
        app_json = {}
    expo = app_json.get('expo') if isinstance(app_json, dict) else None
    ios = expo.get('ios') if isinstance(expo, dict) else None
    source_version = expo.get('version') if isinstance(expo, dict) else None
    source_build = ios.get('buildNumber') if isinstance(ios, dict) else None
    source_bundle = ios.get('bundleIdentifier') if isinstance(ios, dict) else None
    source_version_valid = None
    if ipa_version is not None:
        try:
            source_version_valid = parse_semver(source_version)
            if source_version_valid != ipa_version:
                violations.append('VERSION_SOURCE_MISMATCH')
        except Invalid:
            violations.append('SOURCE_VERSION_FORMAT')
    if build_number is not None:
        if ascii_uint(source_build) != build_number:
            violations.append('BUILD_SOURCE_MISMATCH')
    if bundle_id != source_bundle:
        violations.append('BUNDLE_ID_SOURCE_MISMATCH')
    return {
        'passed': not violations,
        'violations': violations[:16],
        'ipaSha256': digest,
        # Only validated values may appear in the report — never raw input.
        'ipaVersion': short if ipa_version else None,
        'ipaBuildNumber': build_number,
        'bundleId': bundle_id if isinstance(bundle_id, str) and re.fullmatch(r'[A-Za-z0-9.-]{3,128}', bundle_id or '') else None,
        'sourceVersion': source_version if source_version_valid else None,
        'sourceBuildNumber': ascii_uint(source_build),
    }


def main(argv):
    if len(argv) != 4:
        print('usage: version-detect.py <ipa> <app.json> <out.json>')
        return 2
    try:
        result = detect(argv[1], argv[2])
    except Exception:
        # Containment: any defect in this tool itself degrades to a fixed
        # code. Input values, paths, and tracebacks never reach the report.
        result = {'passed': False, 'violations': ['INSPECTION_ERROR'], 'ipaSha256': None}
    report = {
        'schemaVersion': 2,
        'kind': 'distribution-version-report',
        'passed': result['passed'] is True,
        'code': 'VERSION_DETECTED' if result['passed'] else 'VERSION_MISMATCH',
        'ipaSha256': result.get('ipaSha256'),
        'ipaVersion': result.get('ipaVersion'),
        'ipaBuildNumber': result.get('ipaBuildNumber'),
        'bundleId': result.get('bundleId'),
        'sourceVersion': result.get('sourceVersion'),
        'sourceBuildNumber': result.get('sourceBuildNumber'),
        'violations': result.get('violations', []),
    }
    try:
        with open(argv[3], 'w', encoding='utf8', newline='\n') as stream:
            stream.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
    except OSError:
        print('REPORT_UNWRITABLE')
        return 1
    print(report['code'])
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
