#!/bin/bash
# Quick test runner - runs one test file at a time for easier debugging

echo "🧪 Quick Test Runner"
echo "===================="
echo ""

TEST_FILE=${1:-"e2e/kanban.spec.ts"}

echo "Running: $TEST_FILE"
echo ""

npx playwright test "$TEST_FILE" \
  --reporter=list \
  --max-failures=5 \
  2>&1 | grep -E "(PASSED|FAILED|Error:|Expected:|Received:)" | head -50

echo ""
echo "✅ Done. Check output above for failures."
