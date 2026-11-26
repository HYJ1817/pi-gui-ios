#!/usr/bin/env python3
"""M6-distribution: release draft automation (hardened).

Produces complete, ready-to-publish release draft metadata WITHOUT creating
anything on GitHub. Publication requires explicit user authorization.

FSEC-002 hardening — end-to-end chain binding. The draft can only describe
the exact verified bytes because every document in the chain is bound to
them by digest and identity:

  ipa bytes ──sha256──> verification.json (IPA_VERIFIED, same sha256)
  ipa bytes ──sha256──> version-report.json (ipaSha256, same digest)
  version-report ──version/build──> sidestore entry (exact equality)
  version-report ──version/build──> tag string (exact canonical derivation)
  sidestore entry ──downloadURL──> fixed repository release path only
  upgrade-compat ──bindings.candidateSha256──> same digest

Any disagreement anywhere is a hard failure. Input containers are validated
for type before use; malformed input is a violation, never a crash.
"""
import hashlib
import json
import os
import re
import sys

SEMVER_RE = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
HEX64 = re.compile(r'[0-9a-f]{64}')
BUNDLE_RE = re.compile(r'[A-Za-z0-9.-]{3,128}')
TAG_RE = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\+build[1-9][0-9]*')
REPO = 'HYJ1817/pi-gui-ios'
ASSET = 'PiGUIMobile-unsigned.ipa'


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def strict_int(value, low=1, high=2**31 - 1):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if low <= value <= high else None


def valid_hex64(value):
    return isinstance(value, str) and len(value) == 64 and HEX64.fullmatch(value) is not None


def load_json(path):
    try:
        with open(path, encoding='utf8') as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def validate_verify(report):
    if not isinstance(report, dict):
        return None
    if (report.get('schemaVersion') != 2 or report.get('kind') != 'unsigned-device-archive'
            or report.get('passed') is not True or report.get('code') != 'IPA_VERIFIED'):
        return None
    if not valid_hex64(report.get('sha256')):
        return None
    bundle = report.get('bundleId')
    if not (isinstance(bundle, str) and BUNDLE_RE.fullmatch(bundle)):
        return None
    return {'sha256': report['sha256'], 'bundleId': bundle}


def validate_version(report):
    if not isinstance(report, dict):
        return None
    if (report.get('schemaVersion') != 2 or report.get('kind') != 'distribution-version-report'
            or report.get('passed') is not True):
        return None
    version = report.get('ipaVersion')
    build = strict_int(report.get('ipaBuildNumber'))
    sha = report.get('ipaSha256')
    if not (isinstance(version, str) and SEMVER_RE.fullmatch(version)) or build is None or not valid_hex64(sha):
        return None
    return {'version': version, 'build': build, 'sha256': sha}


def validate_compat(report):
    """Two honest shapes: a real comparison (kind distribution-upgrade-compat,
    bindings carry the candidate digest) or the first-release absent sentinel
    (kind distribution-upgrade-compat-absent, code NO_BASELINE_FIRST_RELEASE).
    A first release has nothing to be compatible WITH — the sentinel is not a
    verification result and the draft notes must say so."""
    if not isinstance(report, dict):
        return None
    if report.get('schemaVersion') != 2 or report.get('passed') is not True:
        return None
    if report.get('kind') == 'distribution-upgrade-compat-absent' and report.get('code') == 'NO_BASELINE_FIRST_RELEASE':
        return {'firstRelease': True, 'candidateSha256': None}
    if report.get('kind') != 'distribution-upgrade-compat':
        return None
    bindings = report.get('bindings')
    if not isinstance(bindings, dict) or not valid_hex64(bindings.get('candidateSha256')):
        return None
    return {'firstRelease': False, 'candidateSha256': bindings['candidateSha256']}


def validate_source(report):
    """Returns the single version entry or None. Every container type is
    checked before indexing — an incorrectly shaped source is a violation,
    never an AttributeError."""
    if not isinstance(report, dict):
        return None
    if (report.get('schemaVersion') != 2 or report.get('kind') != 'sidestore-source-draft'
            or report.get('passed') is not True):
        return None
    source = report.get('source')
    if not isinstance(source, dict):
        return None
    apps = source.get('apps')
    if not (isinstance(apps, list) and len(apps) == 1 and isinstance(apps[0], dict)):
        return None
    app = apps[0]
    if not (isinstance(app.get('bundleIdentifier'), str) and BUNDLE_RE.fullmatch(app['bundleIdentifier'])):
        return None
    versions = app.get('versions')
    if not (isinstance(versions, list) and len(versions) == 1 and isinstance(versions[0], dict)):
        return None
    entry = versions[0]
    build = entry.get('buildVersion')
    build_number = None
    if isinstance(build, str) and re.fullmatch(r'[0-9]{1,10}', build):
        build_number = strict_int(int(build))
    if not (isinstance(entry.get('version'), str) and SEMVER_RE.fullmatch(entry['version'])) or build_number is None:
        return None
    if not valid_hex64(entry.get('sha256')) or strict_int(entry.get('size')) is None:
        return None
    url = entry.get('downloadURL')
    if not isinstance(url, str):
        return None
    return {
        'version': entry['version'], 'build': build_number, 'sha256': entry['sha256'],
        'size': entry['size'], 'downloadURL': url, 'bundleIdentifier': app['bundleIdentifier'],
    }


def main(argv):
    if len(argv) != 7:
        print('usage: release-draft.py <ipa> <verify.json> <version-report.json> <upgrade-compat.json> <sidestore-draft.json> <out-dir>')
        return 2
    ipa_path, verify_path, version_path, compat_path, source_path, out_dir = argv[1:7]
    violations = []

    verify = validate_verify(load_json(verify_path))
    if verify is None:
        violations.append('VERIFY_NOT_PASSING')
    version = validate_version(load_json(version_path))
    if version is None:
        violations.append('VERSION_NOT_PASSING')
    compat = validate_compat(load_json(compat_path))
    if compat is None:
        violations.append('COMPAT_NOT_PASSING')
    source = validate_source(load_json(source_path))
    if source is None:
        violations.append('SOURCE_NOT_PASSING')

    ipa_sha = None
    ipa_size = None
    try:
        if not os.path.isfile(ipa_path):
            violations.append('IPA_NOT_FOUND')
        else:
            ipa_sha = sha256_file(ipa_path)
            ipa_size = os.path.getsize(ipa_path)
    except OSError:
        violations.append('IPA_NOT_FOUND')

    # ---- Chain binding: every document must describe the same bytes/identity.
    if ipa_sha is not None:
        if verify is not None and verify['sha256'] != ipa_sha:
            violations.append('IPA_HASH_BINDING')
        if version is not None and version['sha256'] != ipa_sha:
            violations.append('VERSION_HASH_BINDING')
        if compat is not None and not compat['firstRelease'] and compat['candidateSha256'] != ipa_sha:
            violations.append('COMPAT_HASH_BINDING')
        if source is not None:
            if source['sha256'] != ipa_sha or source['size'] != ipa_size:
                violations.append('SOURCE_HASH_BINDING')
    if verify is not None and source is not None and verify['bundleId'] != source['bundleIdentifier']:
        violations.append('IDENTITY_BINDING')
    if version is not None and source is not None:
        if source['version'] != version['version'] or source['build'] != version['build']:
            violations.append('SOURCE_VERSION_BINDING')
    if version is not None and source is not None:
        expected_url = (f'https://github.com/{REPO}/releases/download/'
                        f'v{version["version"]}+build{version["build"]}/{ASSET}')
        if source['downloadURL'] != expected_url:
            violations.append('SOURCE_URL_BINDING')

    passed = not violations
    tag = f'v{version["version"]}+build{version["build"]}' if version else 'invalid'
    draft = {
        'schemaVersion': 2,
        'kind': 'release-draft',
        'passed': passed,
        'violations': list(dict.fromkeys(violations))[:16],
        'publicationStatus': 'draft-only-requires-explicit-user-authorization',
        'tag': tag if passed else None,
        'prerelease': True,
        'title': (f'Pi GUI Mobile {version["version"]} (unsigned, build {version["build"]})' if version else None),
        'notes': (
            'Unsigned device IPA for self-signing via SideStore with a free Apple ID.\n\n'
            '- Structural verification: IPA_VERIFIED (arm64, bundle identity, permission surface, ATS)\n'
            '- Version detection: source-of-truth cross-check passed\n'
            + ('- Upgrade compatibility: structural chain-binding verified against the recorded baseline\n'
               if compat is not None and not compat.get('firstRelease', True) else
               '- Upgrade compatibility: not applicable — first release (no prior baseline exists; '
               'monotonicity verification activates with the first committed baseline)\n')
            + '- SideStore source draft included; real refresh/overwrite/revoke acceptance happens once '
            'in the final user device checklist\n\n'
            'No signing material, no Apple credentials, and no user data are part of this release.'
        ),
        'assets': [],
    }
    if passed and ipa_sha is not None:
        draft['assets'].append({'name': ASSET, 'sha256': ipa_sha, 'size': ipa_size})
    try:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, 'release-draft.json'), 'w', encoding='utf8', newline='\n') as stream:
            stream.write(json.dumps(draft, indent=2, sort_keys=True) + '\n')
        if passed:
            with open(os.path.join(out_dir, 'release-notes.md'), 'w', encoding='utf8', newline='\n') as stream:
                stream.write('# ' + draft['title'] + '\n\n' + draft['notes'])
    except OSError:
        print('REPORT_UNWRITABLE')
        return 1
    print('RELEASE_DRAFT_READY' if passed else 'RELEASE_DRAFT_INVALID')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
