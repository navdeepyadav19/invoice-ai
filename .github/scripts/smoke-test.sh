#!/usr/bin/env bash
# Post-deploy smoke test: request a few routes on the live site and fail the
# pipeline if any of them returns an unexpected HTTP status, then check the
# MCP server's OAuth discovery chain.
#
#   bash .github/scripts/smoke-test.sh https://invoice.horizonpay.co
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
  # rendered but couldn't reach the database, which is the classic bad-env-var deploy.
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

# The MCP server's sign-in discovery. Claude and ChatGPT connect with nothing
# but the /mcp URL: a 401 that names the resource metadata, which names the
# authorization server. If any link in that chain breaks, every assistant
# connection does. All three requests are unauthenticated and change nothing.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

JSON_PATHS=(
  "/.well-known/oauth-authorization-server"
  "/.well-known/oauth-protected-resource/mcp"
)

for path in "${JSON_PATHS[@]}"; do
  status=000
  type=""
  for attempt in 1 2 3 4 5; do
    read -r status type < <(curl --silent --max-time 20 --output "$tmp/body" \
      --write-out '%{http_code} %{content_type}\n' "$BASE_URL$path" || echo "000 -")
    [ "$status" = "200" ] && [[ "$type" == application/json* ]] && break
    sleep $((attempt * 3))
  done

  if [ "$status" = "200" ] && [[ "$type" == application/json* ]] && [ "$(head -c 1 "$tmp/body")" = "{" ]; then
    echo "✓ $path → $status JSON"
  else
    echo "::error::$path returned $status ($type), expected 200 with a JSON object"
    failures=$((failures + 1))
  fi
done

# POST /mcp with no credential: must be a 401 whose WWW-Authenticate header
# points at the resource metadata. A 307 to /login or a missing header means
# assistants can't find where to sign in.
status=000
challenge=""
for attempt in 1 2 3 4 5; do
  status=$(curl --silent --max-time 20 --request POST \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
    --dump-header "$tmp/headers" --output /dev/null --write-out '%{http_code}' \
    "$BASE_URL/mcp") || status=000
  challenge=$(grep -i '^www-authenticate:' "$tmp/headers" 2>/dev/null || true)
  [ "$status" = "401" ] && [[ "$challenge" == *resource_metadata=* ]] && break
  sleep $((attempt * 3))
done

if [ "$status" = "401" ] && [[ "$challenge" == *resource_metadata=* ]]; then
  echo "✓ POST /mcp → 401 with resource_metadata"
else
  echo "::error::POST /mcp returned $status, expected 401 with a WWW-Authenticate resource_metadata challenge"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures smoke check(s) failed against $BASE_URL"
  exit 1
fi
echo "All smoke checks passed against $BASE_URL"
