#!/usr/bin/env bash
# Build the Safari version of Pinpoint.
#
#   bash tools/make-safari.sh [output-dir]                 a Debug build to run locally (default ./safari-build)
#   TEAM=ABCDE12345 bash tools/make-safari.sh --release    archive + export for App Store Connect
#
# --release needs a paid Apple Developer team (TEAM, from developer.apple.com > Membership) and
# signs automatically. BUNDLE overrides the bundle id (default dev.pinpoint.Pinpoint).
#
# Safari does not load unpacked extensions the way Chrome does: the extension has to be wrapped in
# a macOS app and built with Xcode. This runs Apple's converter with the arguments that actually
# work, then builds it.
#
# The gotcha this script exists to save you from: the converter derives the APP's bundle id from
# the last component of --bundle-identifier and the extension's as "<that>.Extension". Pass
# "dev.pinpoint.safari" with an app named Pinpoint and you get app dev.pinpoint.Pinpoint but
# extension dev.pinpoint.safari.Extension — which is not a prefix of the app id, and Xcode fails
# with "Embedded binary's bundle identifier is not prefixed with the parent app's bundle
# identifier". The last component must match the app name.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE=0
[ "${1:-}" = "--release" ] && { RELEASE=1; shift; }
OUT="${1:-$REPO/safari-build}"
APP="Pinpoint"
BUNDLE="${BUNDLE:-dev.pinpoint.$APP}"
# The App Store reads these from the build, not from the extension: keep them in step with it.
VERSION="$(node -p "require('$REPO/extension/manifest.json').version")"
BUILD_NO="${BUILD_NO:-$(git -C "$REPO" rev-list --count HEAD)}"
# The converter targets the newest macOS it knows (26.x), which shuts out most Macs; Safari web
# extensions run from macOS 13.
SETTINGS=(MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NO" MACOSX_DEPLOYMENT_TARGET=13.0
          INFOPLIST_KEY_LSApplicationCategoryType=public.app-category.developer-tools)

command -v xcrun >/dev/null || { echo "Xcode is required (not just the command line tools)."; exit 1; }
xcrun --find safari-web-extension-converter >/dev/null 2>&1 || {
  echo "safari-web-extension-converter not found — install Xcode from the App Store."; exit 1; }

echo "▸ converting extension/ for Safari"
rm -rf "$OUT"
mkdir -p "$OUT"
xcrun safari-web-extension-converter "$REPO/extension" \
  --project-location "$OUT" \
  --app-name "$APP" \
  --bundle-identifier "$BUNDLE" \
  --macos-only --no-open --no-prompt --force

echo
if [ "$RELEASE" = 1 ]; then
  [ -n "${TEAM:-}" ] || { echo "--release needs TEAM=<your Apple Developer team id>"; exit 1; }
  echo "▸ archiving $APP $VERSION ($BUILD_NO) for team $TEAM"
  xcodebuild -project "$OUT/$APP/$APP.xcodeproj" -scheme "$APP" -configuration Release \
    -archivePath "$OUT/$APP.xcarchive" -destination 'generic/platform=macOS' -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic "${SETTINGS[@]}" archive | tail -3
  cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath "$OUT/$APP.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
    -exportPath "$OUT/export" -allowProvisioningUpdates | tail -3
  cat <<EOF2

▸ exported: $OUT/export
Upload it with Transporter (Mac App Store) or: xcrun altool --upload-app -f "$OUT/export/$APP.pkg" -t macos --apiKey … --apiIssuer …
In App Store Connect, the review notes should say the extension needs the Pinpoint bridge running
locally (node bridge/cli.js start, from github.com/gowtham012/pinpoint) and how to paste its token.
EOF2
  exit 0
fi

echo "▸ building $APP $VERSION"
xcodebuild -project "$OUT/$APP/$APP.xcodeproj" -scheme "$APP" -configuration Debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" -destination 'platform=macOS' "${SETTINGS[@]}" build \
  | tail -3

APP_PATH="$(xcodebuild -project "$OUT/$APP/$APP.xcodeproj" -scheme "$APP" -configuration Debug \
  -showBuildSettings 2>/dev/null | awk -F' = ' '/ BUILT_PRODUCTS_DIR/ {print $2; exit}')/$APP.app"

cat <<EOF

▸ built: $APP_PATH

To run it:
  1. open "$APP_PATH"                    (launches once so Safari sees it)
  2. Safari ▸ Settings ▸ Advanced ▸ tick "Show features for web developers"
  3. Safari ▸ Develop ▸ tick "Allow Unsigned Extensions"   (resets when Safari quits)
  4. Safari ▸ Settings ▸ Extensions ▸ enable Pinpoint, and allow it on localhost

Known Safari limitation: the manifest's "world": "MAIN" content script is not supported, so the
React/Vue component chain and source-file hint are not available there. Everything else — picking,
regions, comments, pins, screenshots, the bridge and MCP — works the same. Pinpoint already handles
a page with no framework metadata, and tells the agent so.
EOF
