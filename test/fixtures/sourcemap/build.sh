#!/usr/bin/env bash
# Regenerates test/site/sourcemap/app.min.js(.map). Not run by the tests: the output is committed.
set -euo pipefail
cd "$(dirname "$0")"
npx --yes esbuild@0.24.2 src/main.js --bundle --minify --format=iife --sourcemap --outfile=../../site/sourcemap/app.min.js
