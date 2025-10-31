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
const defaultReportPath = path.join('test-results', 'playwright-report.json');

const resolveReportPath = (input) => {
  if (!input) return defaultReportPath;
  if (path.isAbsolute(input)) return input;
  if (input.includes('/') || input.includes('\\')) {
    return input;
  }
  return path.join('test-results', input);
};

const envReport = resolveReportPath(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME);
const cliReport = resolveReportPath(process.argv[2]);

const reportPath = cliReport || envReport;

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
  const jsonMatch = content.match(/\{\s*"config"/);
  const jsonStart = jsonMatch ? jsonMatch.index : -1;
  const jsonContent = jsonStart >= 0 ? content.substring(jsonStart) : content;
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
  const metricsByOperation = {};

  const pushMetric = (operation, durations) => {
    if (!metricsByOperation[operation]) {
      metricsByOperation[operation] = [];
    }
    metricsByOperation[operation].push(...durations);
  };

  const parseMetricsLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('METRICS_JSON')) {
      return null;
    }

    const jsonPart = trimmed.slice('METRICS_JSON'.length).trim();
    if (!jsonPart) return null;

    try {
      const parsed = JSON.parse(jsonPart);
      if (!parsed || typeof parsed !== 'object') return null;
      const { operation, traces } = parsed;
      if (typeof operation !== 'string' || !Array.isArray(traces)) return null;
      const successful = traces.filter(
        (trace) => trace && typeof trace.status === 'string' && trace.status.toLowerCase() === 'success'
      );
      const durations = successful
        .map((trace) => Number(trace?.durationMs))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (!durations.length) return null;
      return { operation, durations };
    } catch (error) {
      console.warn('Failed to parse METRICS_JSON entry:', error);
      return null;
    }
  };

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

      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            const outputs = [
              ...(result.stdout || []),
              ...(result.stderr || []),
            ];

            for (const output of outputs) {
              const text = typeof output === 'string' ? output : output?.text ?? output?.message;
              if (!text) continue;
              const lines = Array.isArray(text) ? text : String(text).split('\n');
              for (const line of lines) {
                const metric = parseMetricsLine(line);
                if (metric) {
                  pushMetric(metric.operation, metric.durations);
                }
              }
            }
          }
        }
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

  const computeP95 = (values) => {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index];
  };

  const PERF_THRESHOLDS_MS = {
    'board-load': Number(process.env.BOARD_LOAD_P95_THRESHOLD_MS || process.env.PERF_P95_THRESHOLD_MS || 3000),
  };

  const perfSummaries = Object.entries(metricsByOperation).map(([operation, durations]) => {
    const p95 = computeP95(durations);
    const average =
      durations.reduce((total, value) => total + value, 0) / durations.length;
    const max = Math.max(...durations);

    const fallbackThreshold =
      typeof process.env.PERF_P95_THRESHOLD_MS === 'string' && process.env.PERF_P95_THRESHOLD_MS.trim().length > 0
        ? Number(process.env.PERF_P95_THRESHOLD_MS)
        : null;
    const operationThreshold =
      Object.prototype.hasOwnProperty.call(PERF_THRESHOLDS_MS, operation) &&
      Number.isFinite(PERF_THRESHOLDS_MS[operation])
        ? Number(PERF_THRESHOLDS_MS[operation])
        : null;

    const threshold = operationThreshold ?? fallbackThreshold;
    const exceeded =
      typeof threshold === 'number' &&
      Number.isFinite(threshold) &&
      threshold > 0 &&
      p95 !== null &&
      p95 > threshold;

    return {
      operation,
      samples: durations.length,
      average,
      p95,
      max,
      threshold,
      exceeded,
    };
  });

  if (perfSummaries.length > 0) {
    console.log(`\n🚦 Performance Metrics (p95)\n`);
    console.log('─'.repeat(60));
    perfSummaries.forEach((summary) => {
      console.log(
        `\n${summary.operation}\n` +
          `   Samples: ${summary.samples}\n` +
          `   Avg:     ${summary.average.toFixed(1)} ms\n` +
          `   p95:     ${summary.p95 !== null ? summary.p95.toFixed(1) : 'n/a'} ms\n` +
          `   Max:     ${summary.max.toFixed(1)} ms\n` +
          `   Threshold: ${summary.threshold ? `${summary.threshold} ms` : 'n/a'}\n` +
          `   Status:  ${summary.exceeded ? '❌ Exceeded' : '✅ OK'}`
      );
    });
    console.log('\n' + '─'.repeat(60));
  } else {
    console.log('\n⚠️  No performance metrics captured (METRICS_JSON).');
  }

  const perfExceeded = perfSummaries.some((summary) => summary.exceeded);

  // Summary
  console.log(`\n📝 Report: ${path.resolve(reportPath)}`);
  console.log(`📄 HTML:   npx playwright show-report --host 127.0.0.1 --port 9323`);
  console.log(`\n${'═'.repeat(60)}\n`);

  // Exit with error code if tests failed
  if (stats.unexpected > 0) {
    process.exit(1);
  }

  if (perfExceeded) {
    console.error('❌ Performance thresholds exceeded (p95)');
    process.exit(1);
  }

} catch (error) {
  console.error(`\n❌ Error parsing report: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
