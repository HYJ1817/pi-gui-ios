#!/usr/bin/env bash
set -euo pipefail
UDID="$1"
DEVICE_NAME="$2"
APP_PATH="build/simulator/Build/Products/Release-iphonesimulator/PiGUIMobile.app"
BUNDLE_ID="io.github.hyj1817.piguimobile"
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
LAUNCH_RC=$(xcrun simctl launch "$UDID" "$BUNDLE_ID" 2>&1 | awk '{print $NF}') || true
if ! [[ "$LAUNCH_RC" =~ ^[0-9]+$ ]]; then
  printf 'NATIVE_LAUNCH_FAIL\n'
else
  sleep 3
  xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE_ID" || printf 'NATIVE_LAUNCH_EXITED\n'
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
fi

# Simctl-only evidence path (2026-11-24): Maestro's XCUITest driver on the
# runner's iOS 26.5 runtime repeatedly dies (Java ConnectException; upstream
# #3318/#3327/#3137, AX snapshot crash #3538) even with zero AX queries and a
# --reinstall-driver retry, so UI evidence is produced deterministically by
# simctl: deep links navigate the app's own routes, the probe's synthetic
# ?params drive interaction state, and `io screenshot` captures real renders.
shot() { sleep "${2:-2}"; xcrun simctl io "$UDID" screenshot "$SHOTS/$1.png"; }
shot_dark() { sleep "${2:-2}"; xcrun simctl io "$UDID" screenshot "$SHOTS/dark/$1.png"; }
shot_ax() { sleep "${2:-2}"; xcrun simctl io "$UDID" screenshot "$SHOTS/accessibility/$1.png"; }

# Native + shell navigation flow.
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
shot 00-shell-home 4
xcrun simctl openurl "$UDID" "piguimobile://project/project-a0001"
shot 07-shell-sessions
xcrun simctl openurl "$UDID" "piguimobile://session/session-s0001/conversation-c001"
shot 08-shell-conversation
xcrun simctl openurl "$UDID" "piguimobile://probe"
shot 01-native-glass 3
# Interaction state via probe params: keyboard focus+text, menu action,
# animation mid-flight, accessibility action, and the scrolled footnote.
xcrun simctl openurl "$UDID" "piguimobile://probe?focus=device-label&label=CI%20synthetic%20device"
shot 04-keyboard-visible 2
xcrun simctl openurl "$UDID" "piguimobile://probe?menu=confirm&animate=run&gesture=accessible"
shot 05-native-motion 1
shot 02-interactions 1
xcrun simctl openurl "$UDID" "piguimobile://probe?scroll=end"
shot 03-navigation 2

# Dark appearance.
xcrun simctl ui "$UDID" appearance dark
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
shot_dark home 4
xcrun simctl openurl "$UDID" "piguimobile://probe"
shot_dark appearance 3
xcrun simctl ui "$UDID" appearance light

# Accessibility: Reduce Transparency + largest Dynamic Type.
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool YES
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
shot_ax home 4
xcrun simctl openurl "$UDID" "piguimobile://probe?scroll=end"
shot_ax reduce-transparency 2
shot_ax dynamic-type 1
xcrun simctl ui "$UDID" content_size medium
xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool NO
xcrun simctl io "$UDID" screenshot "$SHOTS/final.png"
