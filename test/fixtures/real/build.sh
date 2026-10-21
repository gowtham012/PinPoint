#!/usr/bin/env bash
# Regenerates test/site/real/{react,vue}: real Vite production builds (minified, no dev hooks, a
# source map beside the bundle) for e2e-real.test.mjs. Not run by the tests: the output is committed.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-package-lock --no-audit --no-fund --silent
for app in react vue; do npx vite build "$app" --logLevel warn; done
