#!/usr/bin/env python3
"""Private staging; publish only after inspecting the actual final ZIP."""
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import zipfile

spec = importlib.util.spec_from_file_location('ipa_policy', pathlib.Path(__file__).with_name('verify-ipa.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
FINAL = ('PiGUIMobile-unsigned.ipa', 'verification.json', 'SHA256SUMS')


def normalize_frameworks(app):
    # Only resource seals / signatures inside embedded frameworks may be removed.
    # Profiles, loose entitlements and all app signatures remain hard failures.
    for framework in sorted(app.rglob('*.framework')):
        policy.require(framework.is_dir() and not framework.is_symlink(), 'FRAMEWORK_LAYOUT')
        for binary in sorted(framework.rglob('*')):
            policy.require(not binary.is_symlink(), 'ARCHIVE_LINK')
            if binary.is_file():
                with binary.open('rb') as stream:
                    head = stream.read(4)
                if head in policy.MAGICS and policy.macho(binary.read_bytes(), True)['signed']:
                    policy.require(sys.platform == 'darwin', 'FRAMEWORK_CODESIGN_REQUIRES_MACOS')
                    result = subprocess.run(['/usr/bin/codesign', '--remove-signature', str(binary)],
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
                    policy.require(result.returncode == 0, 'FRAMEWORK_SIGNATURE_REMOVAL_FAILED')
                    policy.macho(binary.read_bytes())
        for seal in sorted(framework.rglob('_CodeSignature'), reverse=True):
            policy.require(seal.is_dir() and not seal.is_symlink(), 'SIGNING_MATERIAL')
            shutil.rmtree(seal)
        for seal in framework.rglob('CodeResources'):
            policy.require(seal.is_file() and not seal.is_symlink(), 'SIGNING_MATERIAL')
            seal.unlink()


def package(source, work, output):
    source, work, output = map(pathlib.Path, (source, work, output))
    policy.require(source.name == 'PiGUIMobile.app' and source.is_dir() and not source.is_symlink(),
                   'BUNDLE_NOT_FOUND')
    # Inspect filesystem topology before copytree can follow a link into private material.
    tree = policy.Tree(source)
    tree.close()
    app = work / 'Payload' / 'PiGUIMobile.app'
    shutil.copytree(source, app, symlinks=True)
    normalize_frameworks(app)
    policy.verify(app)
    final = work / FINAL[0]
    with zipfile.ZipFile(final, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(app.rglob('*')):
            if path.is_file():
                relative = path.relative_to(work).as_posix()
                entry = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                executable = path.stat().st_mode & 0o111
                entry.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                with archive.open(entry, 'w') as target, path.open('rb') as stream:
                    shutil.copyfileobj(stream, target)
    report = policy.verify(final)
    digest = hashlib.file_digest(final.open('rb'), 'sha256').hexdigest()
    report['sha256'] = digest
    (work / FINAL[1]).write_text(json.dumps(report, sort_keys=True) + '\n', encoding='utf-8')
    (work / FINAL[2]).write_text(digest + '  ' + FINAL[0] + '\n', encoding='ascii')
    output.mkdir(parents=True, exist_ok=True)
    for name in FINAL:
        # The shell removes all three outputs on any partial publication failure.
        shutil.copyfile(work / name, output / name)


if __name__ == '__main__':
    try:
        policy.require(len(sys.argv) == 4, 'IPA_ARGUMENTS')
        package(*sys.argv[1:])
    except policy.Invalid as error:
        print(str(error))
        sys.exit(1)
    except Exception:
        print('IPA_PACKAGING_ERROR')
        sys.exit(1)
