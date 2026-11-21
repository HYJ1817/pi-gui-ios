#!/usr/bin/env bash
set -euo pipefail
UDID="$1"
DEVICE_NAME="$2"
APP_PATH="build/simulator/Build/Products/Release-iphonesimulator/PiGUIMobile.app"
: "${RUNNER_TEMP:?}"
case "$DEVICE_NAME" in iphone|ipad) ;; *) exit 1 ;; esac
PRIVATE="$RUNNER_TEMP/native-private"
SHOTS="$PRIVATE/screenshots/$DEVICE_NAME"
UI="$PRIVATE/ui/$DEVICE_NAME"
mkdir -p "$SHOTS/dark" "$SHOTS/accessibility" "$UI"
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$status" != 0 ]]; then xcrun simctl io "$UDID" screenshot "$SHOTS/failure.png" >/dev/null 2>&1 || true; fi
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
xcrun simctl ui "$UDID" appearance light
xcrun simctl install "$UDID" "$APP_PATH"
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS" --format junit --output "$UI/native.xml" --test-output-dir "$UI/native" .maestro/native.yaml
xcrun simctl ui "$UDID" appearance dark
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS/dark" --format junit --output "$UI/dark.xml" --test-output-dir "$UI/dark" .maestro/appearance.yaml
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool YES
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS/accessibility" --format junit --output "$UI/accessibility.xml" --test-output-dir "$UI/accessibility" .maestro/accessibility.yaml
xcrun simctl io "$UDID" screenshot "$SHOTS/final.png"
