#!/usr/bin/env node

/**
 * Playwright JSON Report Summary Tool
 *
 * Usage:
 *   node test-summary.js [path/to/report.json]
 *   npm run test:summary
 *
 * Reads playwright-report.json and outputs:
 * - Test statistics (passed, failed, skipped, flaky)
 * - Failed test details with issues array
 * - Duration and performance metrics
 */

const fs = require('fs');
const path = require('path');

// Get report path from CLI arg or env var or use default
const reportPath = process.argv[2] || process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'playwright-report.json';

if (!fs.existsSync(reportPath)) {
  console.error(`❌ Report file not found: ${reportPath}`);
  console.error(`\nUsage: node test-summary.js [path/to/report.json]`);
  console.error(`   or: PLAYWRIGHT_JSON_OUTPUT_NAME=custom-report.json node test-summary.js`);
  console.error(`   or: npm run test:summary`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(reportPath, 'utf8');
  // Remove log lines before JSON if any
  const jsonStart = content.indexOf('{');
  const jsonContent = jsonStart > 0 ? content.substring(jsonStart) : content;
  const report = JSON.parse(jsonContent);

  console.log('\n📊 Playwright Test Summary\n');
  console.log('═'.repeat(60));

  // Stats
  const stats = report.stats || {};
  console.log(`\n📈 Statistics:`);
  console.log(`   ✅ Passed:     ${stats.expected || 0}`);
  console.log(`   ❌ Failed:     ${stats.unexpected || 0}`);
  console.log(`   ⏭️  Skipped:    ${stats.skipped || 0}`);
  console.log(`   🔄 Flaky:      ${stats.flaky || 0}`);
  console.log(`   ⏱️  Duration:   ${(stats.duration / 1000).toFixed(2)}s`);

  // Failed tests with issues
  const failedTests = [];

  function extractFailedTests(suites, suitePath = []) {
    for (const suite of suites || []) {
      const currentPath = [...suitePath, suite.title].filter(Boolean);

      // Check specs in this suite
      for (const spec of suite.specs || []) {
        if (!spec.ok) {
          const testInfo = {
            title: spec.title,
            suite: currentPath.join(' > '),
            file: spec.file || suite.file,
            line: spec.line,
            tags: spec.tags || [],
            errors: [],
            issues: []
          };

          // Extract errors and issues from test results
          for (const test of spec.tests || []) {
            for (const result of test.results || []) {
              if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'unexpected') {
                for (const error of result.errors || []) {
                  const errorMsg = error.message || String(error);
                  testInfo.errors.push(errorMsg);

                  // Try to extract issues from error message (API validation errors)
                  const issuesMatch = errorMsg.match(/issues['":]?\s*(\[.*?\])/s);
                  if (issuesMatch) {
                    try {
                      const issues = JSON.parse(issuesMatch[1]);
                      testInfo.issues.push(...issues);
                    } catch (e) {
                      // Could not parse issues JSON
                    }
                  }
                }
              }
            }
          }

          failedTests.push(testInfo);
        }
      }

      // Recurse into nested suites
      if (suite.suites) {
        extractFailedTests(suite.suites, currentPath);
      }
    }
  }

  extractFailedTests(report.suites);

  // Display failed tests
  if (failedTests.length > 0) {
    console.log(`\n❌ Failed Tests (${failedTests.length}):\n`);
    console.log('─'.repeat(60));

    failedTests.forEach((test, index) => {
      console.log(`\n${index + 1}. ${test.title}`);
      if (test.suite) {
        console.log(`   📦 ${test.suite}`);
      }
      console.log(`   📁 ${test.file}:${test.line || '?'}`);

      if (test.tags.length > 0) {
        console.log(`   🏷️  Tags: ${test.tags.join(', ')}`);
      }

      if (test.issues.length > 0) {
        console.log(`   ⚠️  Validation Issues:`);
        test.issues.forEach(issue => {
          const details = issue.message || JSON.stringify(issue);
          console.log(`      • ${issue.code || 'ERROR'}: ${details}`);
        });
      }

      if (test.errors.length > 0 && test.issues.length === 0) {
        const errorPreview = test.errors[0].split('\n')[0].substring(0, 100);
        console.log(`   💥 Error: ${errorPreview}...`);
      }
    });

    console.log('\n' + '─'.repeat(60));
  } else if (stats.unexpected === 0) {
    console.log(`\n✅ All tests passed!`);
  }

  // Summary
  console.log(`\n📝 Report: ${path.resolve(reportPath)}`);
  console.log(`📄 HTML:   npx playwright show-report --host 127.0.0.1 --port 9323`);
  console.log(`\n${'═'.repeat(60)}\n`);

  // Exit with error code if tests failed
  if (stats.unexpected > 0) {
    process.exit(1);
  }

} catch (error) {
  console.error(`\n❌ Error parsing report: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
