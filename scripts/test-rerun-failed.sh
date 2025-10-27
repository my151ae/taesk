#!/usr/bin/env bash
set -euo pipefail

REPORT_PATH="playwright-report.json"
OUTPUT_PATH="playwright-report-rerun.json"
PROJECT="core"

usage() {
  cat <<'USAGE'
Usage: scripts/test-rerun-failed.sh [options]
  -r, --report <path>   Source JSON reporter output (default: playwright-report.json)
  -o, --output <path>   Destination JSON reporter output for the re-run (default: playwright-report-rerun.json)
  -p, --project <name>  Playwright project to run (default: core)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--report)
      REPORT_PATH="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -p|--project)
      PROJECT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$REPORT_PATH" ]]; then
  echo "Report not found: $REPORT_PATH" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

# Trim any non-JSON prelude emitted by Playwright (dotenv logs, etc.)
sed -n '/^{/,$p' "$REPORT_PATH" > "$TMP_JSON"

mapfile -t SPEC_FILES < <(jq -r '
  .. | .specs? // empty | .[] |
  select(any(.tests[]?; .status == "unexpected")) |
  .file
' "$TMP_JSON" | sort -u)

if [[ ${#SPEC_FILES[@]} -eq 0 ]]; then
  echo "No unexpected tests found to re-run."
  exit 0
fi

RESOLVED_SPECS=()
for spec in "${SPEC_FILES[@]}"; do
  if [[ -f "$spec" ]]; then
    RESOLVED_SPECS+=("$spec")
  elif [[ -f "e2e/$spec" ]]; then
    RESOLVED_SPECS+=("e2e/$spec")
  else
    RESOLVED_SPECS+=("$spec")
  fi
done

printf 'Re-running %d spec(s): %s\n' "${#RESOLVED_SPECS[@]}" "${RESOLVED_SPECS[*]}"

# Ensure Playwright writes JSON to stdout so we can capture it in OUTPUT_PATH
npx playwright test --project="$PROJECT" --reporter=json "${RESOLVED_SPECS[@]}" > "$OUTPUT_PATH"

echo "Re-run JSON report written to $OUTPUT_PATH"
echo "Inspect stats with: sed -n '/^{/,$p' $OUTPUT_PATH | jq '.stats'"
