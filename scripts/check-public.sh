#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

blocked_paths='(^|/)(\.env($|\.)|\.npmrc$|\.netrc$|credentials|secrets|session\.json$|.*history.*|\.ssh/|\.aws/|\.azure/|\.copilot/|\.claude/)'
secret_patterns='(AKIA[0-9A-Z]{16}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(^|[^A-Za-z])(password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*[^[:space:]$<{][^[:space:]]*)'
work_patterns='(microsoft\.com|dev\.azure\.com|visualstudio\.com|Xbox[\\]|Xbox\.Apps|Xbox\.Streaming|xgang|fresno)'

failed=0
secret_results="$(mktemp "${TMPDIR:-/tmp}/herdr-maestro-secret-scan.XXXXXX")"
work_results="$(mktemp "${TMPDIR:-/tmp}/herdr-maestro-work-scan.XXXXXX")"
trap 'rm -f "$secret_results" "$work_results"' EXIT

while IFS= read -r path; do
  if [[ "$path" =~ $blocked_paths ]]; then
    echo "blocked tracked path: $path" >&2
    failed=1
  fi
done < <(git ls-files)

if git grep --cached -lEI "$secret_patterns" -- . \
  ':(exclude)scripts/check-public.sh' >"$secret_results" 2>/dev/null; then
  echo "possible secret in tracked files:" >&2
  cat "$secret_results" >&2
  failed=1
fi

if git grep --cached -lEI "$work_patterns" -- . \
  ':(exclude)scripts/check-public.sh' >"$work_results" 2>/dev/null; then
  echo "possible employer-specific content in tracked files:" >&2
  cat "$work_results" >&2
  failed=1
fi

git diff --check
git diff --cached --check

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir --no-banner --redact .
  gitleaks git --no-banner --redact .
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "Public-content checks passed."
