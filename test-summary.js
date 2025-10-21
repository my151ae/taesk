#!/usr/bin/env node
/**
 * Simple test summary extractor
 * Reads playwright-report.json and outputs a readable summary
 */

const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, 'playwright-report.json');

if (!fs.existsSync(reportPath)) {
  console.log('❌ No test report found. Run tests first.');
  process.exit(1);
}

const content = fs.readFileSync(reportPath, 'utf8');
// Remove log lines before JSON
const jsonStart = content.indexOf('{');
const jsonContent = content.substring(jsonStart);
const report = JSON.parse(jsonContent);

console.log('\n🧪 Test Summary');
console.log('================\n');

const stats = report.stats;
console.log(`✅ Passed:  ${stats.expected}`);
console.log(`❌ Failed:  ${stats.unexpected}`);
console.log(`⏭️  Skipped: ${stats.skipped}`);
console.log(`⚠️  Flaky:   ${stats.flaky}`);
console.log(`⏱️  Duration: ${(stats.duration / 1000).toFixed(1)}s\n`);

// Extract failed tests
const failedTests = [];
function extractTests(suite, suitePath = []) {
  const currentPath = [...suitePath, suite.title].filter(Boolean);

  if (suite.specs) {
    suite.specs.forEach(spec => {
      if (spec.tests) {
        spec.tests.forEach(test => {
          if (test.results) {
            test.results.forEach(result => {
              if (result.status === 'unexpected') {
                failedTests.push({
                  suite: currentPath.join(' > '),
                  test: spec.title,
                  error: result.error?.message || 'Unknown error',
                  file: suite.file || 'unknown'
                });
              }
            });
          }
        });
      }
    });
  }

  if (suite.suites) {
    suite.suites.forEach(s => extractTests(s, currentPath));
  }
}

report.suites.forEach(suite => extractTests(suite));

if (failedTests.length > 0) {
  console.log('❌ Failed Tests:\n');
  failedTests.forEach((test, i) => {
    console.log(`${i + 1}. ${test.suite} > ${test.test}`);
    const errorLines = test.error.split('\n').slice(0, 2);
    errorLines.forEach(line => console.log(`   ${line}`));
    console.log('');
  });
}

console.log('\n📄 For detailed report, open: playwright-report/index.html\n');
