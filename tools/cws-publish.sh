#!/usr/bin/env bash
# Upload a store zip to the Chrome Web Store (API v2) and submit it for review. Used by
# .github/workflows/release.yml and cws-publish.yml. Needs CWS_CLIENT_ID, CWS_CLIENT_SECRET,
# CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID and CWS_EXTENSION_ID in the environment.
#   bash tools/cws-publish.sh dist/pinpoint-extension-cws.zip
set -euo pipefail
ZIP="${1:?usage: cws-publish.sh <zip>}"
TOKEN=$(curl -sS https://oauth2.googleapis.com/token \
  -d client_id="$CWS_CLIENT_ID" -d client_secret="$CWS_CLIENT_SECRET" \
  -d refresh_token="$CWS_REFRESH_TOKEN" -d grant_type=refresh_token | jq -r '.access_token // empty')
[ -n "$TOKEN" ] || { echo "::error::Google refused the refresh token — re-run tools/cws-auth.mjs (docs/releasing.md)"; exit 1; }
echo "::add-mask::$TOKEN"
ITEM="https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID"
# No -f anywhere: on an error Google's JSON says why, and it must reach the log.
UP=$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" -T "$ZIP" \
  "https://chromewebstore.googleapis.com/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:upload")
echo "$UP"
STATE=$(echo "$UP" | jq -r '.uploadState // "ERROR"')
for _ in $(seq 1 24); do
  [ "$STATE" = "IN_PROGRESS" ] || break
  sleep 5
  STATE=$(curl -sS -H "Authorization: Bearer $TOKEN" "$ITEM:fetchStatus" | jq -r '.lastAsyncUploadState // "ERROR"')
  echo "upload: $STATE"
done
[ "$STATE" = "SUCCEEDED" ] || { echo "::error::upload ended as $STATE"; exit 1; }
PUB=$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"publishType":"DEFAULT_PUBLISH"}' "$ITEM:publish")
echo "$PUB"
echo "$PUB" | jq -e '.error | not' >/dev/null || { echo "::error::publish refused"; exit 1; }
