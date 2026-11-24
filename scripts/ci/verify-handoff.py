#!/usr/bin/env python3
"""Verify a cross-job/cross-run build handoff before trusting its bytes.

Checks the manifest's provenance fields and recomputes the tarball digest.
Usage: verify-handoff.py <manifest.json> <tar> <expected-run-id> <expected-sha-or-empty>
Prints exactly one fixed code; never echoes file contents or paths.
"""
import hashlib
import json
import pathlib
import re
import sys

SHA = re.compile(r'^[a-f0-9]{64}$')
SHA40 = re.compile(r'^[a-f0-9]{40}$')
RUN_ID = re.compile(r'^[0-9]{5,20}$')
CODES = {'sha': 'HANDOFF_SHA_REJECTED', 'run': 'HANDOFF_RUN_REJECTED',
         'attempt': 'HANDOFF_ATTEMPT_REJECTED', 'job': 'HANDOFF_JOB_REJECTED',
         'digest': 'HANDOFF_DIGEST_REJECTED'}


def main():
    try:
        assert len(sys.argv) == 5
        manifest = json.loads(pathlib.Path(sys.argv[1]).read_bytes())
        tar = pathlib.Path(sys.argv[2]).read_bytes()
        run_id, expected_sha = sys.argv[3], sys.argv[4]
        assert isinstance(manifest, dict)
        # Provenance: the artifact must come from the run it was downloaded
        # from, and pin the expected source commit when one was supplied.
        assert SHA40.match(manifest.get('head_sha', '')), 'sha'
        if expected_sha:
            assert manifest['head_sha'] == expected_sha, 'sha'
        assert str(manifest.get('run_id')) == run_id and RUN_ID.match(run_id), 'run'
        assert int(manifest.get('run_attempt')) >= 1, 'attempt'
        assert manifest.get('job') == 'native-build', 'job'
        digest = hashlib.sha256(tar).hexdigest()
        assert SHA.match(manifest.get('sha256', '')) and digest == manifest['sha256'], 'digest'
        print('HANDOFF_VERIFIED')
        return 0
    except (AssertionError, ValueError, OSError, KeyError, TypeError) as error:
        print(CODES.get(str(error), 'HANDOFF_REJECTED'))
        return 1


if __name__ == '__main__':
    sys.exit(main())
