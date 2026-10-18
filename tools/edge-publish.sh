#!/usr/bin/env bash
# Upload a zip to Microsoft Edge Add-ons and submit it for certification (Update REST API v1.1).
#   EDGE_PRODUCT_ID=… EDGE_CLIENT_ID=… EDGE_API_KEY=… bash tools/edge-publish.sh dist/pinpoint-extension-cws.zip
# The first version is uploaded by hand in Partner Center; the API only updates an existing product.
# Upload and submit each answer 202 with an operation id in Location, and are polled until they
# leave InProgress. A submission already in review, or a package identical to the live one, is a
# notice: the job did all it could. EDGE_API_BASE and EDGE_POLL_SECONDS exist for the tests.
set -euo pipefail
ZIP="${1:?usage: edge-publish.sh <zip>}"
if [ -z "${EDGE_PRODUCT_ID:-}" ] || [ -z "${EDGE_CLIENT_ID:-}" ] || [ -z "${EDGE_API_KEY:-}" ]; then
  echo "::notice::Edge Add-ons secrets are not set — upload $ZIP in Partner Center by hand (docs/releasing.md)."
  exit 0
fi
API="${EDGE_API_BASE:-https://api.addons.microsoftedge.microsoft.com}/v1/products/$EDGE_PRODUCT_ID/submissions"
WAIT="${EDGE_POLL_SECONDS:-5}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
# The key goes to curl through a header file, never on its command line or in the log.
printf 'Authorization: ApiKey %s\nX-ClientID: %s\n' "$EDGE_API_KEY" "$EDGE_CLIENT_ID" > "$T/auth"

# req <curl args…>: body → $T/body, headers → $T/head, prints the HTTP status.
req() {
  local code
  code=$(curl -sS -o "$T/body" -D "$T/head" -w '%{http_code}' -H @"$T/auth" "$@") || code=000
  if [ "$code" = 401 ]; then
    echo "::error::Edge Add-ons answered 401: the API key is wrong or expired (keys last 72 days). Partner Center → Microsoft Edge → Publish API → Create API credentials, then update EDGE_API_KEY (and EDGE_CLIENT_ID)." >&2
    exit 1
  fi
  echo "$code"
}
# The operation id is the last path segment of Location, whether that is a bare id or a URL.
opid() { grep -i '^location:' "$T/head" | tail -1 | tr -d '\r' | sed 's/^[^:]*:[[:space:]]*//; s#.*/##'; }

# poll <url> <what>: waits for the operation to finish; fails, or notes, on anything but Succeeded.
poll() {
  local status code
  for _ in $(seq 1 60); do
    code=$(req "$1")
    [ "$code" = 200 ] || { echo "::error::$2: status check answered $code: $(cat "$T/body")"; exit 1; }
    status=$(jq -r '.status // ""' "$T/body")
    [ "$status" = InProgress ] || break
    sleep "$WAIT"
  done
  jq -c '{status, message, errorCode, errors}' "$T/body"
  local err msg
  err=$(jq -r '.errorCode // ""' "$T/body")
  msg=$(jq -r '[.message // "", (.errors // [] | map(if type == "object" then .message else . end) | join("; "))] | map(select(. != "")) | join(" — ")' "$T/body")
  case "$status:$err" in
    Succeeded:*) return 0 ;;
    Failed:InProgressSubmission|Failed:NoModulesUpdated)
      echo "::notice::Edge $2: $err — $msg"; exit 0 ;;
    *) echo "::error::Edge $2 ended as ${status:-unknown}${err:+ ($err)}: $msg"; exit 1 ;;
  esac
}

code=$(req -X POST -H "Content-Type: application/zip" -T "$ZIP" "$API/draft/package")
[ "$code" = 202 ] || { echo "::error::Edge upload answered $code: $(cat "$T/body")"; exit 1; }
poll "$API/draft/package/operations/$(opid)" "upload"

V=$(unzip -p "$ZIP" manifest.json 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)
NOTES=$(jq -n --arg v "${V:-new}" '{notes: ("Pinpoint " + $v + ". Same package as the Chrome Web Store build. It talks only to a bridge the developer runs on 127.0.0.1; to test, run `npx -y pinpoint-bridge` and open any localhost page.")}')
code=$(req -X POST -H "Content-Type: application/json" -d "$NOTES" "$API")
[ "$code" = 202 ] || { echo "::error::Edge submit answered $code: $(cat "$T/body")"; exit 1; }
poll "$API/operations/$(opid)" "submission"
echo "Submitted to Edge Add-ons for certification."
