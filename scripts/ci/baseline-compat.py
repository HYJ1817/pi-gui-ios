#!/usr/bin/env python3
"""M6-distribution: committed-baseline upgrade compatibility driver.

Three honest states, never a silent skip (M6-CI-BASELINE-001):
  both baseline files present  -> run the real comparison, propagate its result
  neither present              -> write the first-release sentinel report
  exactly one present          -> hard failure: the baseline pair is incomplete
                                  and compatibility verification may never be
                                  silently downgraded to a first release

This script exists so the workflow step is a thin shell over an executable
that unit tests can run directly against fixture directories — the behavior
is what gets tested, never the workflow text.
"""
import json
import os
import subprocess
import sys

SENTINEL = {
    'schemaVersion': 2,
    'kind': 'distribution-upgrade-compat-absent',
    'passed': True,
    'code': 'NO_BASELINE_FIRST_RELEASE',
    'violations': [],
    'scope': 'structural-automation-only',
    'deviceSemantics': 'no prior release exists; upgrade compatibility is not applicable to a first release',
    'bindings': {},
}


def run_driver(baseline_dir, candidate_version, candidate_verify, out_path, repo_root):
    """Returns (state, exit_code): state is compare|sentinel|rejected."""
    base_v = os.path.join(baseline_dir, 'baseline-version.json')
    base_r = os.path.join(baseline_dir, 'baseline-verify.json')
    has_v = os.path.isfile(base_v)
    has_r = os.path.isfile(base_r)
    if has_v and has_r:
        result = subprocess.run(
            [sys.executable, os.path.join(repo_root, 'scripts/ci/upgrade-compat.py'),
             base_v, candidate_version, base_r, candidate_verify, out_path],
            capture_output=True, text=True)
        return 'compare', result.returncode
    if not has_v and not has_r:
        with open(out_path, 'w', encoding='utf8', newline='\n') as stream:
            stream.write(json.dumps(SENTINEL, indent=2, sort_keys=True) + '\n')
        return 'sentinel', 0
    print('PARTIAL_BASELINE_REJECTED: exactly one baseline file exists — the pair is '
          'incomplete, refusing to skip compatibility verification', file=sys.stderr)
    return 'rejected', 1


def main(argv):
    if len(argv) != 5:
        print('usage: baseline-compat.py <baseline-dir> <candidate-version.json> <candidate-verify.json> <out.json>')
        return 2
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    state, code = run_driver(argv[1], argv[2], argv[3], argv[4], repo_root)
    print(state.upper())
    return code


if __name__ == '__main__':
    sys.exit(main(sys.argv))
