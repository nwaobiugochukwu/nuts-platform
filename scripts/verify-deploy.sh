#!/bin/sh
# Post-deploy check: is everything that should be running actually running?
#
#   scripts/verify-deploy.sh https://staging.example.com
#   scripts/verify-deploy.sh http://localhost:3001        # local
#
# Fails (non-zero exit) if the API is down, its dependencies are unreachable, or
# the worker / jobs programs are not running (the failures that otherwise show
# no error: queued emails and scheduled jobs simply stop).
set -eu

base="${1:-}"
if [ -z "$base" ]; then
  echo "usage: $0 <base-url>   e.g. $0 https://staging.example.com" >&2
  exit 2
fi
base="${base%/}"
fail=0

check() {
  name="$1"; path="$2"
  code=$(curl -sS -m 10 -A 'Mozilla/5.0 verify-deploy' -o /tmp/verify-deploy.$$ -w '%{http_code}' "$base$path" 2>/tmp/verify-deploy.err.$$ || true)
  if [ "$code" = "200" ]; then
    echo "ok    $name"
  else
    echo "FAIL  $name  (HTTP ${code:-none} from $base$path)"
    # Show why: the API explains in plain language what is not running.
    if [ -s /tmp/verify-deploy.$$ ]; then
      tr -d '\n' < /tmp/verify-deploy.$$ | cut -c1-600 | sed 's/^/      /'; echo
    else
      cut -c1-300 /tmp/verify-deploy.err.$$ | sed 's/^/      /'
    fi
    fail=1
  fi
  rm -f /tmp/verify-deploy.$$ /tmp/verify-deploy.err.$$
}

check "api is up"                      /api/v1/health
check "database and cache reachable"   /api/v1/health/ready
check "worker and jobs are running"    /api/v1/health/background

if [ "$fail" -ne 0 ]; then
  echo
  echo "Deploy check FAILED. If worker or jobs is reported missing, start them:"
  echo "  docker compose --profile <staging|prod> up -d     (or set PROCESS_ROLE=all on api-prod)"
  exit 1
fi
echo "Deploy check passed."
