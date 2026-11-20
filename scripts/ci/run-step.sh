#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?}"
STEP="${1:?}"
shift
case "$STEP" in
  environment|npm|prebuild|pods|maestro|simulator-build|iphone|ipad|device-build|ipa) ;;
  *) printf '%s\n' 'STEP_UNKNOWN'; exit 1 ;;
esac
PRIVATE="$RUNNER_TEMP/native-private"
mkdir -p "$PRIVATE/steps" "$PRIVATE/logs"
record() {
  "${PYTHON:-python3}" - "$PRIVATE/steps/$STEP.json" "$STEP" "$1" <<'PY'
import json, pathlib, sys
path, step, result = sys.argv[1:]
pathlib.Path(path).write_text(json.dumps({'step': step, 'status': result}), encoding='utf-8')
PY
}
record running
set +e
"$@" > "$PRIVATE/logs/$STEP.log" 2>&1
STATUS=$?
set -e
RESULT=failed
if [[ "$STATUS" == 0 ]]; then RESULT=passed; fi
if [[ "$STEP" == pods && "$STATUS" == 78 ]]; then RESULT=bootstrap-required; fi
record "$RESULT"
printf 'NATIVE_STEP_%s_%s\n' "$STEP" "$RESULT"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'result=%s\n' "$RESULT" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '| %s | %s |\n' "$STEP" "$RESULT" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$STATUS"
