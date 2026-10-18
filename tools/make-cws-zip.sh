#!/usr/bin/env bash
# Build dist/pinpoint-extension-cws.zip for the Chrome Web Store and Edge Add-ons: extension/ with
# the manifest's "key" removed. The stores refuse a key; local installs keep it for their stable id.
# Optional argument: where to write the zip instead.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/dist/pinpoint-extension-cws.zip}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$REPO/extension/." "$TMP/"
find "$TMP" -name .DS_Store -delete
node -e 'const f=process.argv[1],m=require(f);delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$TMP/manifest.json"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT"
(cd "$TMP" && zip -qr "$OUT" .)
echo "$OUT ($(node -p "require('$REPO/extension/manifest.json').version"))"
