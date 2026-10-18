#!/usr/bin/env bash
# Build dist/pinpoint-extension-firefox.zip for addons.mozilla.org from the same extension/.
# Firefox differs from Chrome only in the manifest: no "key" (AMO ids come from the gecko id), an
# event-page background instead of a service worker (Firefox has no MV3 service workers), and the
# gecko settings AMO requires. data_collection_permissions declares websiteContent: the element's
# HTML, text and a cropped screenshot leave the add-on for the developer's own bridge on 127.0.0.1
# and from there their coding agent — never us (PRIVACY.md). 140 is the first Firefox that shows
# that declaration in its install prompt, so nothing older may install it (142 on Android, said only
# so the linter can check the key; Android has no native messaging for the bridge). AMO caps the
# name at 45 characters.
# Optional argument: where to write the zip instead.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/dist/pinpoint-extension-firefox.zip}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$REPO/extension/." "$TMP/"
find "$TMP" -name .DS_Store -delete
node -e '
const f = process.argv[1], m = require(f);
delete m.key;
m.name = "Pinpoint \u2014 annotate UI for your coding agent";
m.background = { scripts: ["background.js"] };
m.browser_specific_settings = { gecko: {
  id: "pinpoint@gowtham012.github.io",
  strict_min_version: "140.0",
  data_collection_permissions: { required: ["websiteContent"] },
}, gecko_android: { strict_min_version: "142.0" } };
require("fs").writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$TMP/manifest.json"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT"
(cd "$TMP" && zip -qr "$OUT" .)
echo "$OUT ($(node -p "require('$REPO/extension/manifest.json').version"))"
