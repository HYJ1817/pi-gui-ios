#!/usr/bin/env python3
"""M6-distribution: release draft automation.

Produces the complete, ready-to-publish release draft metadata — tag, title,
notes, asset manifest with hashes — WITHOUT creating anything on GitHub.
Formal release publication requires explicit user authorization (ROADMAP);
this script only ever writes local draft files.

The draft binds together: the verified IPA (IPA_VERIFIED structural chain),
the version-detection report, the upgrade-compat report, and the SideStore
source draft — every cross-reference is hash-verified at generation time so
the draft cannot silently describe bytes other than the ones verified.
"""
import hashlib
import json
import os
import sys


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def load_passing(path, kind_fragment):
    try:
        report = json.load(open(path, encoding='utf8'))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(report, dict) or report.get('passed') is not True:
        return None
    if kind_fragment not in str(report.get('kind', '')):
        return None
    return report


def main(argv):
    if len(argv) != 7:
        print('usage: release-draft.py <ipa> <verify.json> <version-report.json> <upgrade-compat.json> <sidestore-draft.json> <out-dir>')
        return 2
    ipa_path, verify_path, version_path, compat_path, source_path, out_dir = argv[1:7]
    violations = []
    verify = load_passing(verify_path, 'unsigned-device-archive')
    if verify is None:
        violations.append('VERIFY_NOT_PASSING')
    version = load_passing(version_path, 'distribution-version-report')
    if version is None:
        violations.append('VERSION_NOT_PASSING')
    compat = load_passing(compat_path, 'distribution-upgrade-compat')
    if compat is None:
        violations.append('COMPAT_NOT_PASSING')
    source_draft = load_passing(source_path, 'sidestore-source-draft')
    if source_draft is None:
        violations.append('SOURCE_NOT_PASSING')
    if not os.path.isfile(ipa_path):
        violations.append('IPA_NOT_FOUND')
        ipa_sha = None
        ipa_size = None
    else:
        ipa_sha = sha256(ipa_path)
        ipa_size = os.path.getsize(ipa_path)
    # Cross-binding: the draft must describe exactly the verified bytes.
    if verify is not None and ipa_sha is not None and verify.get('sha256') != ipa_sha:
        violations.append('IPA_HASH_BINDING')
    if source_draft is not None and ipa_sha is not None:
        apps = (source_draft.get('source') or {}).get('apps') or []
        entry = ((apps[0] if apps else {}).get('versions') or [{}])[0]
        if entry.get('sha256') != ipa_sha or entry.get('size') != ipa_size:
            violations.append('SOURCE_HASH_BINDING')
    passed = not violations
    tag = f"v{version['ipaVersion']}+build{version['ipaBuildNumber']}" if version else 'v0.0.0+build0'
    draft = {
        'schemaVersion': 2,
        'kind': 'release-draft',
        'passed': passed,
        'violations': violations[:16],
        'publicationStatus': 'draft-only-requires-explicit-user-authorization',
        'tag': tag,
        'prerelease': True,
        'title': f"Pi GUI Mobile {version['ipaVersion'] if version else '?'} (unsigned, build {version['ipaBuildNumber'] if version else '?'})",
        'notes': (
            'Unsigned device IPA for self-signing via SideStore with a free Apple ID.\n\n'
            '- Structural verification: IPA_VERIFIED (arm64, bundle identity, permission surface, ATS)\n'
            '- Version detection: source-of-truth cross-check passed\n'
            '- Upgrade compatibility: build monotonicity + identity stability verified structurally\n'
            '- SideStore source draft included; real refresh/overwrite/revoke acceptance happens once '
            'in the final user device checklist\n\n'
            'No signing material, no Apple credentials, and no user data are part of this release.'
        ),
        'assets': [],
    }
    if ipa_sha is not None:
        draft['assets'].append({
            'name': 'PiGUIMobile-unsigned.ipa',
            'sha256': ipa_sha,
            'size': ipa_size,
        })
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'release-draft.json')
    with open(out_path, 'w', encoding='utf8', newline='\n') as stream:
        stream.write(json.dumps(draft, indent=2, sort_keys=True) + '\n')
    notes_path = os.path.join(out_dir, 'release-notes.md')
    with open(notes_path, 'w', encoding='utf8', newline='\n') as stream:
        stream.write('# ' + draft['title'] + '\n\n' + draft['notes'])
    print('RELEASE_DRAFT_READY' if passed else 'RELEASE_DRAFT_INVALID')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
