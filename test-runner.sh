#!/bin/bash
# Simple test runner (always writes JSON under test-results/)

set -euo pipefail

mkdir -p test-results/runner
RUN_ID=$(date +%Y%m%d-%H%M%S)
OUT="test-results/runner/${RUN_ID}-playwright.json"
TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

echo "Running E2E Tests..."
echo "JSON report: $OUT"

PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT" PW_WORKERS=1 npx playwright test --project=core

sed -n '/^{/,$p' "$OUT" > "$TMP_JSON"
echo ""
echo "Stats:"
jq '.stats' "$TMP_JSON"
