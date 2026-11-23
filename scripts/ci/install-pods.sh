#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PRIVATE="$(mktemp -d "$RUNNER_TEMP/piguimobile-pods.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$status" != 0 ]]; then
    "${PYTHON:-python3}" "$ROOT/scripts/ci/safe-diagnostics.py" pods "$PRIVATE/bundle.log" "$PRIVATE/pods.log" || true
  fi
  rm -rf -- "$PRIVATE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
rm -f -- "$ROOT/artifacts/lock-candidates/Gemfile.lock" "$ROOT/artifacts/lock-candidates/Podfile.lock" "$ROOT/artifacts/lock-candidates/prebuilt-dependencies.json" "$ROOT/artifacts/lock-candidates/review.json"
PYTHON="${PYTHON:-python3}"
"$PYTHON" "$ROOT/scripts/ci/native-dependencies.py" prepare "$ROOT" "$PRIVATE"
export BUNDLE_GEMFILE="$PRIVATE/Gemfile"
export BUNDLE_PATH="$PRIVATE/gems"
export BUNDLE_APP_CONFIG="$PRIVATE/config"
MODE="$("$PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1]))["mode"])' "$ROOT/native/dependency-policy.json")"
if [[ "$MODE" == locked ]]; then export BUNDLE_FROZEN=true; fi
bundle _2.6.9_ install > "$PRIVATE/bundle.log" 2>&1
[[ "$(bundle _2.6.9_ exec pod --version)" == 1.16.2 ]]
POD_ARGS=(install)
if [[ "$MODE" == locked ]]; then POD_ARGS+=(--deployment); fi
# react-native-screens Split (iPad UISplitViewController) lives under ios/gamma
# and must be opted into at pod install: the podspec includes gamma sources
# and sets -DRNS_GAMMA_ENABLED=1 only when the env is present here.
export RNS_GAMMA_ENABLED='1'
# pipefail is essential: tee success must never conceal a failed pod resolution.
(cd "$ROOT/ios" && bundle _2.6.9_ exec pod "${POD_ARGS[@]}" 2>&1 | tee "$PRIVATE/pods.log" > /dev/null)
"$PYTHON" "$ROOT/scripts/ci/native-dependencies.py" finish "$ROOT" "$PRIVATE"
