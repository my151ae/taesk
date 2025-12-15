#!/bin/bash

# Test runner that executes all tests in batches and aggregates results
# Usage: bash scripts/test-all-batches.sh

set -euo pipefail

export PW_WORKERS=1

if command -v lsof >/dev/null 2>&1; then
  if lsof -i :3000 -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    echo "Port 3000 is already in use. Stop the running server/process first."
    lsof -i :3000 -sTCP:LISTEN -Pn || true
    echo ""
    echo "Hint:"
    echo "  pkill -f 'node .*next dev'"
    echo "  pkill -f 'playwright test'"
    exit 1
  fi
fi

echo "=========================================="
echo "Running all tests in batches..."
echo "=========================================="
echo ""

# Create results directory
mkdir -p test-results/batches
mkdir -p test-results/logs

# Output file for full log
RUN_ID=$(date +%Y%m%d-%H%M%S)
LOG_FILE="test-results/logs/batch-execution-${RUN_ID}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "Log file: $LOG_FILE"
echo ""

# Run each test file separately
test_files=(
  "auth"
  "timeline"
  "comments"
  "notifications"
  "reorder"
  "permissions"
  "rls"
)

failed_tests=()
passed_tests=()

for test in "${test_files[@]}"; do
  echo "----------------------------------------"
  echo "Running: $test"
  echo "----------------------------------------"

  export PLAYWRIGHT_JSON_OUTPUT_NAME="test-results/batches/${RUN_ID}-${test}.json"

  if npm run test:$test; then
    passed_tests+=("$test")
    echo "✅ $test PASSED"
  else
    failed_tests+=("$test")
    echo "❌ $test FAILED"
  fi

  echo ""
done

unset PLAYWRIGHT_JSON_OUTPUT_NAME

# Summary
echo "=========================================="
echo "BATCH TEST SUMMARY"
echo "=========================================="
echo ""
echo "Total test files: ${#test_files[@]}"
echo "Passed: ${#passed_tests[@]}"
echo "Failed: ${#failed_tests[@]}"
echo ""

if [ ${#passed_tests[@]} -gt 0 ]; then
  echo "✅ Passed tests:"
  for test in "${passed_tests[@]}"; do
    echo "  - $test"
  done
  echo ""
fi

if [ ${#failed_tests[@]} -gt 0 ]; then
  echo "❌ Failed tests:"
  for test in "${failed_tests[@]}"; do
    echo "  - $test"
  done
  echo ""
  exit 1
fi

echo "🎉 All tests passed!"
exit 0
