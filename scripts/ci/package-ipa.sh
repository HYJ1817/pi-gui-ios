#!/usr/bin/env bash
set -euo pipefail
APP="build/device/Build/Products/Release-iphoneos/PiGUIMobile.app"
mkdir -p artifacts/ipa/Payload
cp -R "$APP" artifacts/ipa/Payload/
/usr/libexec/PlistBuddy -c Print "$APP/Info.plist" > artifacts/ipa/Info.plist.txt
xcrun vtool -show-build "$APP/PiGUIMobile" > artifacts/ipa/macho-build.txt
lipo -info "$APP/PiGUIMobile" > artifacts/ipa/architecture.txt
find "$APP" -type d -name '*.framework' | sort > artifacts/ipa/frameworks.txt
find "$APP" -name '*.entitlements' -o -name 'embedded.mobileprovision' > artifacts/ipa/signing-files.txt
if codesign -d --entitlements :- "$APP" > artifacts/ipa/entitlements.plist 2> artifacts/ipa/codesign.txt; then
  echo 'Unexpected signed archive: inspect rather than claim unsigned' >&2
  exit 1
fi
python3 scripts/ci/verify-ipa.py "$APP" > artifacts/ipa/verification.json
(cd artifacts/ipa && zip -qr PiGUIMobile-unsigned.ipa Payload)
shasum -a 256 artifacts/ipa/PiGUIMobile-unsigned.ipa > artifacts/ipa/SHA256SUMS
rm -rf artifacts/ipa/Payload
