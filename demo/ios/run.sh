#!/usr/bin/env bash
# Build Trailhead for the iOS Simulator and launch it on the booted device — no Xcode project.
#   bash demo/ios/run.sh                 (bash demo/ios/run.sh --sticky-book: the "after")
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/pinpoint-trailhead"
APP="$OUT/Trailhead.app"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x86_64"

xcrun simctl list devices booted | grep -q Booted || { echo "Boot a Simulator first (open -a Simulator)."; exit 1; }
rm -rf "$APP" && mkdir -p "$APP"
xcrun --sdk iphonesimulator swiftc -parse-as-library -O -target "$ARCH-apple-ios26.0-simulator" -sdk "$SDK" \
  "$HERE/TrailheadApp.swift" -o "$APP/Trailhead"
cp "$HERE/Info.plist" "$APP/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
xcrun simctl install booted "$APP"
xcrun simctl launch --terminate-running-process booted dev.pinpoint.trailhead "$@" >/dev/null
echo "Trailhead is running in the Simulator. With the bridge up, open http://127.0.0.1:7331/ios"
