#!/usr/bin/env bash
set -euo pipefail
UDID="$1"
DEVICE_NAME="$2"
APP_PATH="build/simulator/Build/Products/Release-iphonesimulator/PiGUIMobile.app"
mkdir -p "artifacts/screenshots/$DEVICE_NAME" "artifacts/maestro/$DEVICE_NAME"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
xcrun simctl ui "$UDID" appearance light
xcrun simctl install "$UDID" "$APP_PATH"
maestro --device "$UDID" test -e "SCREENSHOT_DIR=artifacts/screenshots/$DEVICE_NAME" --format junit --output "artifacts/maestro/$DEVICE_NAME/native.xml" --test-output-dir "artifacts/maestro/$DEVICE_NAME/native" .maestro/native.yaml
xcrun simctl ui "$UDID" appearance dark
maestro --device "$UDID" test -e "SCREENSHOT_DIR=artifacts/screenshots/$DEVICE_NAME/dark" --format junit --output "artifacts/maestro/$DEVICE_NAME/dark.xml" --test-output-dir "artifacts/maestro/$DEVICE_NAME/dark" .maestro/appearance.yaml
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool YES
maestro --device "$UDID" test -e "SCREENSHOT_DIR=artifacts/screenshots/$DEVICE_NAME/accessibility" --format junit --output "artifacts/maestro/$DEVICE_NAME/accessibility.xml" --test-output-dir "artifacts/maestro/$DEVICE_NAME/accessibility" .maestro/accessibility.yaml
xcrun simctl io "$UDID" screenshot "artifacts/screenshots/$DEVICE_NAME/final.png"
xcrun simctl shutdown "$UDID"
