#!/usr/bin/env bash
# Build dist/pinpoint-extension-cws.zip for the Chrome Web Store: extension/ with the manifest's
# "key" removed. The Store refuses a key; local installs keep it for their stable extension id.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$REPO/extension/." "$TMP/"
find "$TMP" -name .DS_Store -delete
node -e 'const f=process.argv[1],m=require(f);delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$TMP/manifest.json"
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/pinpoint-extension-cws.zip"
(cd "$TMP" && zip -qr "$REPO/dist/pinpoint-extension-cws.zip" .)
echo "dist/pinpoint-extension-cws.zip ($(node -p "require('$REPO/extension/manifest.json').version"))"
