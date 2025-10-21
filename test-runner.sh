#!/bin/bash
# Simple test runner with better output

echo "🧪 Running E2E Tests..."
echo "======================="
echo ""

# Run tests with line reporter (simpler output)
npx playwright test --reporter=line,html 2>&1 | tee test-output.log

# Extract summary
echo ""
echo "📊 Test Summary:"
echo "================"
grep -E "passed|failed|skipped" test-output.log | tail -1

# Show failed tests
echo ""
echo "❌ Failed Tests:"
echo "================"
grep "✘" test-output.log || echo "No failures found"

echo ""
echo "📄 Full report: playwright-report/index.html"
