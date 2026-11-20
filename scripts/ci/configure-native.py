#!/usr/bin/env python3
"""Deny the known RN template's local-network ATS exemption in generated iOS.

Never silently remove permission keys or unknown ATS exceptions.
"""
import importlib.util
import pathlib
import plistlib
import sys

try:
    spec = importlib.util.spec_from_file_location('ipa_policy', pathlib.Path(__file__).with_name('verify-ipa.py'))
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    path = pathlib.Path('ios/PiGUIMobile/Info.plist')
    info = plistlib.loads(path.read_bytes())
    ats = info.setdefault('NSAppTransportSecurity', {})
    policy.require(isinstance(ats, dict), 'ATS_POLICY')
    if 'NSAllowsLocalNetworking' in ats:
        policy.require(type(ats['NSAllowsLocalNetworking']) is bool, 'ATS_POLICY')
        ats['NSAllowsLocalNetworking'] = False
    policy.plist_policy(info)
    path.write_bytes(plistlib.dumps(info))
    print('NATIVE_RELEASE_POLICY_CONFIGURED')
except Exception:
    print('NATIVE_RELEASE_POLICY_REJECTED')
    sys.exit(1)
