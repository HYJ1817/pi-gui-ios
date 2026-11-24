#!/usr/bin/env python3
"""Write the provenance manifest for a build handoff tarball.

Usage: write-handoff.py <kind: sim|device> <tar> <manifest-out>
Provenance fields come from the runner's own GITHUB_* environment; the digest
is recomputed from the tarball actually produced by this job. Prints one code.
"""
import hashlib
import json
import os
import pathlib
import sys


def main():
    try:
        assert len(sys.argv) == 4 and sys.argv[1] in ('sim', 'device')
        tar = pathlib.Path(sys.argv[2])
        out = pathlib.Path(sys.argv[3])
        manifest = {
            'job': 'native-build',
            'kind': sys.argv[1],
            'run_id': int(os.environ['GITHUB_RUN_ID']),
            'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
            'head_sha': os.environ['GITHUB_SHA'],
            'sha256': hashlib.sha256(tar.read_bytes()).hexdigest(),
        }
        out.write_text(json.dumps(manifest, sort_keys=True) + '\n', encoding='utf-8')
        print('HANDOFF_MANIFEST_WRITTEN')
        return 0
    except Exception:
        print('HANDOFF_MANIFEST_REJECTED')
        return 1


if __name__ == '__main__':
    sys.exit(main())
