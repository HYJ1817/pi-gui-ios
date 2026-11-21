#!/usr/bin/env python3
"""Verify the exact public Expo native template before Expo extracts or runs it."""
import base64
import hashlib
import json
import pathlib
import sys
import tarfile

NAME = 'expo-template-bare-minimum'
VERSION = '58.0.35'
INTEGRITY = 'sha512-YW9njiXrFEBrSxHMZJzMW9/1ZgH46ZuY7IqxlYhQv9dxIEMVFUwAmcD29+WH7AofTII1FsfnTLC5DJ03HUo9xw=='


def verify(path):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError()
    with path.open('rb') as stream:
        actual = 'sha512-' + base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode()
    if actual != INTEGRITY:
        raise ValueError()
    with tarfile.open(path) as archive:
        package = json.load(archive.extractfile('package/package.json'))
        if package['name'] != NAME or package['version'] != VERSION:
            raise ValueError()
    return True


if __name__ == '__main__':
    try:
        verify(sys.argv[1])
        print('NATIVE_TEMPLATE_VERIFIED')
    except Exception:
        print('NATIVE_TEMPLATE_REJECTED')
        sys.exit(1)
