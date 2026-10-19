#!/usr/bin/env bash
# Render every logo asset from tools/logo/mark.svg: the extension icons, the in-page bar's two
# marks (inlined into content.js), and docs/logo/ (all sizes, favicons, wordmarks, store tiles).
#
#   bash tools/make-icons.sh
#
# Needs the test dependencies (cd test && npm install && npx playwright install chromium) and ffmpeg.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
node tools/logo/make-logos.mjs
