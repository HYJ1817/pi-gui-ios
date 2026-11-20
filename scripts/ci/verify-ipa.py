import json, pathlib, plistlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
with (app / 'Info.plist').open('rb') as stream:
    info = plistlib.load(stream)
assert info['CFBundleIdentifier'] == 'io.github.hyj1817.piguimobile'
assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS']
assert info['UIDeviceFamily'] == [1, 2]
assert info.get('NSAppTransportSecurity', {}).get('NSAllowsArbitraryLoads', False) is False, 'Global ATS exception is forbidden'
assert not list(app.rglob('embedded.mobileprovision')), 'Do not upload signing profiles'
for key in ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription']:
    assert key not in info, 'Unexpected sensitive permission: ' + key
architectures = subprocess.check_output(['lipo', '-archs', str(app / info['CFBundleExecutable'])], text=True).strip()
assert architectures == 'arm64', architectures
frameworks = []
for framework in sorted(app.rglob('*.framework')):
    binary = framework / framework.stem
    if binary.is_file():
        arch = subprocess.check_output(['lipo', '-archs', str(binary)], text=True).strip()
        assert 'arm64' in arch.split(), str(framework)
        frameworks.append({'name': framework.name, 'architectures': arch})
print(json.dumps({'schemaVersion': 1, 'passed': True, 'kind': 'unsigned-device-structure', 'bundleId': info['CFBundleIdentifier'], 'minimumOS': info['MinimumOSVersion'], 'platform': info['CFBundleSupportedPlatforms'], 'architectures': architectures, 'frameworks': frameworks, 'sideStoreInstallVerified': False}, indent=2))
