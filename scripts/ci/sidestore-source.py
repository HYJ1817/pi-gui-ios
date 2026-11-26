#!/usr/bin/env python3
"""M6-distribution: SideStore source manifest generation.

Generates the AltStore/SideStore source JSON describing the unsigned IPA
release channel. This is a DRAFT generation step — publishing the source or
any release requires explicit user authorization (ROADMAP/ADR-0006); the
output is artifact-only.

Source format follows the AltStore source schema subset SideStore consumes:
name/identifier/subtitle/description/apps[] with version entries pointing at
the release asset. The downloadURL is parameterized on the release tag; the
draft is structurally complete but not functional until a release exists —
which is exactly what the acceptance demands (no implicit publication).
"""
import hashlib
import json
import sys


SOURCE_ID = 'io.github.hyj1817.piguimobile.sidestore-source'
BUNDLE_ID = 'io.github.hyj1817.piguimobile'
REPO = 'HYJ1817/pi-gui-ios'


def generate(version, build_number, sha256, size_bytes, tag, asset_name):
    errors = []
    if not (isinstance(version, str) and all(part.isdigit() for part in version.split('.')) and version.count('.') == 2):
        errors.append('VERSION_FORMAT')
    if not (isinstance(build_number, int) and build_number >= 1):
        errors.append('BUILD_NUMBER_FORMAT')
    if not (isinstance(sha256, str) and len(sha256) == 64 and all(c in '0123456789abcdef' for c in sha256)):
        errors.append('SHA256_FORMAT')
    if not (isinstance(size_bytes, int) and size_bytes > 0):
        errors.append('SIZE_FORMAT')
    if not (isinstance(tag, str) and tag.strip() == tag and len(tag) >= 1 and ' ' not in tag):
        errors.append('TAG_FORMAT')
    if errors:
        return {'passed': False, 'violations': errors, 'source': None}
    download = f'https://github.com/{REPO}/releases/download/{tag}/{asset_name}'
    source = {
        'name': 'Pi GUI Mobile (unsigned, self-signed distribution)',
        'identifier': SOURCE_ID,
        'subtitle': 'Desktop companion — SideStore self-signed channel',
        'description': ('Unsigned IPA for self-signing with your own free Apple ID via SideStore. '
                        'Re-signing is your own act on your own device; no developer account, '
                        'no paid service, no third-party signature is involved. Refresh every '
                        '7 days is a SideStore/free-account platform constraint, not an app limitation.'),
        'apps': [{
            'name': 'Pi GUI Mobile',
            'bundleIdentifier': BUNDLE_ID,
            'developerName': 'Self-signed (user-owned distribution)',
            'subtitle': 'Pi Coding Agent mobile companion',
            'localizedDescription': ('Remote companion for the desktop Pi Coding Agent. '
                                     'Distributed unsigned; you re-sign it yourself via SideStore.'),
            'iconURL': f'https://raw.githubusercontent.com/{REPO}/agent/m-1-bootstrap/assets/icon.png',
            'tintColor': '0A84FF',
            'versions': [{
                'version': version,
                'buildVersion': str(build_number),
                'date': None,  # stamped at release-draft time, never invented here
                'downloadURL': download,
                'size': size_bytes,
                'sha256': sha256,
                'minOSVersion': '16.4',
            }],
            'appPermissions': {
                'entitlements': [],
                'privacy': {},
            },
        }],
    }
    return {'passed': True, 'violations': [], 'source': source}


def main(argv):
    if len(argv) != 7:
        print('usage: sidestore-source.py <version> <buildNumber> <ipaSha256> <ipaSizeBytes> <tag> <out.json>')
        return 2
    version, build_s, sha256, size_s, tag, out = argv[1:7]
    try:
        build_number = int(build_s)
        size_bytes = int(size_s)
    except ValueError:
        build_number, size_bytes = 0, 0
    result = generate(version, build_number, sha256, size_bytes, tag, 'PiGUIMobile-unsigned.ipa')
    report = {
        'schemaVersion': 2,
        'kind': 'sidestore-source-draft',
        'passed': result['passed'],
        'violations': result['violations'],
        'publicationStatus': 'draft-only-never-published',
    }
    if result['source'] is not None:
        report['source'] = result['source']
    with open(out, 'w', encoding='utf8', newline='\n') as stream:
        stream.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('SOURCE_DRAFT_READY' if result['passed'] else 'SOURCE_INVALID')
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
