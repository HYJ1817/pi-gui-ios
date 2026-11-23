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
# Maestro's XCUITest driver on iOS 26.x intermittently fails to connect on the
# first launch (upstream issues #3318/#3327/#3137). One retry with a fresh
# driver install absorbs the flake; real assertion failures still surface as
# MAESTRO_STEP_* codes from the debug artifacts.
run_flow() {
  local phase="$1" flow="$2" env="$3" xml="$4" out="$5" debug="$PRIVATE/debug-$DEVICE_NAME-$1"
  local args=(test -e "$env" --format junit --output "$xml" --test-output-dir "$out"
              --debug-output "$debug" --flatten-debug-output "$flow")
  local rc=0
  mkdir -p "$debug"
  maestro --device "$UDID" "${args[@]}" > "$debug/console.log" 2>&1 || rc=$?
  if [[ "$rc" != 0 ]]; then
    python3 scripts/ci/maestro-debug.py "$debug" "$UI/$1-debug.json" || true
    sleep 5
    rm -rf "$debug"; mkdir -p "$debug"
    maestro --device "$UDID" --reinstall-driver "${args[@]}" > "$debug/console.log" 2>&1 && rc=0
  fi
  return "$rc"
}
run_flow native .maestro/native.yaml "SCREENSHOT_DIR=$SHOTS" "$UI/native.xml" "$UI/native" || exit $?
xcrun simctl ui "$UDID" appearance dark
run_flow dark .maestro/appearance.yaml "SCREENSHOT_DIR=$SHOTS/dark" "$UI/dark.xml" "$UI/dark" || exit $?
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool YES
run_flow accessibility .maestro/accessibility.yaml "SCREENSHOT_DIR=$SHOTS/accessibility" "$UI/accessibility.xml" "$UI/accessibility" || exit $?
xcrun simctl io "$UDID" screenshot "$SHOTS/final.png"
