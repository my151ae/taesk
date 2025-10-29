#!/bin/bash

# Test runner that executes all tests in batches and aggregates results
# Usage: bash scripts/test-all-batches.sh

set -e

echo "=========================================="
echo "Running all tests in batches..."
echo "=========================================="
echo ""

# Create results directory
mkdir -p test-results/batches

# Run each test file separately
test_files=(
  "auth"
  "kanban"
  "reorder"
  "comments"
  "notifications"
  "permissions"
  "rls"
)

failed_tests=()
passed_tests=()

for test in "${test_files[@]}"; do
  echo "----------------------------------------"
  echo "Running: $test"
  echo "----------------------------------------"

  if npm run test:$test; then
    passed_tests+=("$test")
    echo "✅ $test PASSED"
  else
    failed_tests+=("$test")
    echo "❌ $test FAILED"
  fi

  echo ""
done

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
