#!/usr/bin/env bash
# Post-deploy smoke test: request a few routes on the live site and fail the
# pipeline if any of them returns an unexpected HTTP status.
#
#   bash .github/scripts/smoke-test.sh https://invoice-ai-horizonpay.vercel.app
set -uo pipefail

BASE_URL="${1:?usage: smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"

# "<path> <expected status>". Keep these public, fast, and free of side effects:
# this runs against real production.
CHECKS=(
  "/ 200"
  "/login 200"
  "/signup 200"
  # An unknown share token must be a clean 404. A 500 here means the server
  # rendered but couldn't reach Supabase, which is the classic bad-env-var deploy.
  "/i/00000000-0000-0000-0000-000000000000 404"
)

failures=0
for check in "${CHECKS[@]}"; do
  read -r path expected <<<"$check"

  # Retry briefly: the production alias can take a few seconds to switch over.
  status=000
  for attempt in 1 2 3 4 5; do
    status=$(curl --silent --location --max-time 20 --output /dev/null --write-out '%{http_code}' "$BASE_URL$path") || status=000
    [ "$status" = "$expected" ] && break
    sleep $((attempt * 3))
  done

  if [ "$status" = "$expected" ]; then
    echo "✓ $path → $status"
  else
    echo "::error::$path returned $status, expected $expected"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures smoke check(s) failed against $BASE_URL"
  exit 1
fi
echo "All smoke checks passed against $BASE_URL"
