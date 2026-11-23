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
# Launch probe: a non-numeric result means the app could not start at all
# (missing bundle, Hermes fault); a pid that disappears within 3s means an
# early crash. Either prints a fixed structural code, never the process text.
LAUNCH_RC=$(xcrun simctl launch "$UDID" io.github.hyj1817.piguimobile 2>&1 | awk '{print $NF}') || true
if ! [[ "$LAUNCH_RC" =~ ^[0-9]+$ ]]; then
  printf 'NATIVE_LAUNCH_FAIL\n'
else
  sleep 3
  xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "io.github.hyj1817.piguimobile" || printf 'NATIVE_LAUNCH_EXITED\n'
  xcrun simctl terminate "$UDID" io.github.hyj1817.piguimobile >/dev/null 2>&1 || true
fi
export MAESTRO_LOG_LEVEL=debug
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS" --format junit --output "$UI/native.xml" --test-output-dir "$UI/native" --debug-output "$PRIVATE/debug-$DEVICE_NAME-native" --flatten-debug-output .maestro/native.yaml || { rc=$?; python3 scripts/ci/maestro-debug.py "$PRIVATE/debug-$DEVICE_NAME-native/commands.json" "$PRIVATE/debug-$DEVICE_NAME-native/logs/maestro.log" > "$UI/native-debug.json" 2>/dev/null || true; exit $rc; }
xcrun simctl ui "$UDID" appearance dark
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS/dark" --format junit --output "$UI/dark.xml" --test-output-dir "$UI/dark" --debug-output "$PRIVATE/debug-$DEVICE_NAME-dark" --flatten-debug-output .maestro/appearance.yaml || { rc=$?; python3 scripts/ci/maestro-debug.py "$PRIVATE/debug-$DEVICE_NAME-dark/commands.json" "$PRIVATE/debug-$DEVICE_NAME-dark/logs/maestro.log" > "$UI/dark-debug.json" 2>/dev/null || true; exit $rc; }
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool YES
maestro --device "$UDID" test -e "SCREENSHOT_DIR=$SHOTS/accessibility" --format junit --output "$UI/accessibility.xml" --test-output-dir "$UI/accessibility" --debug-output "$PRIVATE/debug-$DEVICE_NAME-accessibility" --flatten-debug-output .maestro/accessibility.yaml || { rc=$?; python3 scripts/ci/maestro-debug.py "$PRIVATE/debug-$DEVICE_NAME-accessibility/commands.json" "$PRIVATE/debug-$DEVICE_NAME-accessibility/logs/maestro.log" > "$UI/accessibility-debug.json" 2>/dev/null || true; exit $rc; }
xcrun simctl io "$UDID" screenshot "$SHOTS/final.png"
