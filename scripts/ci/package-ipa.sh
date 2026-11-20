#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/build/device/Build/Products/Release-iphoneos/PiGUIMobile.app}"
OUTPUT="$ROOT/artifacts/ipa"
STAGING=''
PUBLISHED=0
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$STAGING" ]]; then rm -rf -- "$STAGING"; fi
  if [[ "$PUBLISHED" != 1 || "$status" != 0 ]]; then
    rm -f -- "$OUTPUT/PiGUIMobile-unsigned.ipa" "$OUTPUT/verification.json" "$OUTPUT/SHA256SUMS"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$OUTPUT"
rm -f -- "$OUTPUT/PiGUIMobile-unsigned.ipa" "$OUTPUT/verification.json" "$OUTPUT/SHA256SUMS"
STAGING="$(mktemp -d "$RUNNER_TEMP/piguimobile-ipa.XXXXXX")"
"${PYTHON:-python3}" "$ROOT/scripts/ci/stage-ipa.py" "$APP" "$STAGING" "$OUTPUT"
PUBLISHED=1
printf '%s\n' 'IPA_VERIFIED'
