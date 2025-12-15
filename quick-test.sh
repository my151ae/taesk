#!/bin/bash
# Quick test runner - runs one spec at a time and always writes JSON under test-results/

set -euo pipefail

TEST_FILE=${1:-"e2e/timeline.spec.ts"}

if [[ ! -f "$TEST_FILE" ]]; then
  echo "Spec file not found: $TEST_FILE" >&2
  exit 1
fi

mkdir -p test-results/quick
RUN_ID=$(date +%Y%m%d-%H%M%S)
OUT="test-results/quick/${RUN_ID}-quick.json"
TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

echo "Running: $TEST_FILE"
echo "JSON report: $OUT"

PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT" PW_WORKERS=1 npx playwright test "$TEST_FILE" --project=core --max-failures=5

sed -n '/^{/,$p' "$OUT" > "$TMP_JSON"
echo ""
echo "Stats:"
jq '.stats' "$TMP_JSON"

if jq -e '.stats.unexpected > 0' "$TMP_JSON" >/dev/null 2>&1; then
  echo ""
  echo "Unexpected specs:"
  jq -r '
    .. | .specs? // empty | .[] |
    select(any(.tests[]?; .status == "unexpected")) |
    .file
  ' "$TMP_JSON" | sort -u | sed 's/^/  - /'
fi
