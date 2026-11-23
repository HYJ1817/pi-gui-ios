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
if [[ "$STEP" == simulator-build && "$STATUS" != 0 ]]; then
  # ReactCodegen's 'Generate Specs' phase writes only package/component names
  # to react-codegen.log. Append its sanitized structural lines (no paths/messages)
  # so diagnostics can attribute a codegen-phase failure instead of withholding it.
  while IFS= read -r -d '' candidate; do
    printf '\n== react-codegen.log (structural lines only) ==\n' >> "$PRIVATE/logs/$STEP.log"
    grep -aoE 'NATIVE_[A-Z0-9_]+|\[Codegen\][^/"'"'"']*|error|FAILED|Generated.*' "$candidate" | head -50 >> "$PRIVATE/logs/$STEP.log" || true
    break
  done < <(find "$PWD/build/simulator" -name 'react-codegen.log' -print0 2>/dev/null | head -z -n 1)
fi
record "$RESULT"
printf 'NATIVE_STEP_%s_%s\n' "$STEP" "$RESULT"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'result=%s\n' "$RESULT" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '| %s | %s |\n' "$STEP" "$RESULT" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$STATUS"
