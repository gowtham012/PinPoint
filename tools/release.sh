#!/usr/bin/env bash
# Cut a release: set the version everywhere, close the changelog's Unreleased section, commit, tag
# and push. The tag starts .github/workflows/release.yml, which tests and publishes everything.
#
#   bash tools/release.sh 0.6.1             do it
#   bash tools/release.sh 0.6.1 --dry-run   show what would change, then put everything back
set -euo pipefail
V="${1:-}"; DRY="${2:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: bash tools/release.sh <x.y.z> [--dry-run]"; exit 2; }
cd "$(dirname "$0")/.."

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "release from main"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first"; exit 1; }
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "v$V already exists"; exit 1; }
# The changelog is the release notes: an empty Unreleased section means nothing to announce.
awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f && /[^[:space:]]/{n++} END{exit n?0:1}' CHANGELOG.md \
  || { echo "CHANGELOG.md has nothing under [Unreleased] — write the notes first"; exit 1; }

FILES=(extension/manifest.json bridge/package.json bridge/package-lock.json bridge/server.json CHANGELOG.md)
node - "$V" <<'JS'
const fs = require("fs"), v = process.argv[2];
const edit = (f, fn) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); fn(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n"); };
edit("extension/manifest.json", (j) => { j.version = v; });
edit("bridge/package.json", (j) => { j.version = v; });
edit("bridge/package-lock.json", (j) => { j.version = v; if (j.packages?.[""]) j.packages[""].version = v; });
edit("bridge/server.json", (j) => { j.version = v; for (const p of j.packages || []) p.version = v; });
const today = new Date().toISOString().slice(0, 10);
const c = fs.readFileSync("CHANGELOG.md", "utf8").replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${v}] — ${today}\n`);
fs.writeFileSync("CHANGELOG.md", c);
JS
# manifest.json keeps its non-ASCII name escaped, the way Chrome's own tools write it
node -e 'const f="extension/manifest.json",fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/[\u0080-￿]/g,(c)=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0")))'

git --no-pager diff --stat
if [ "$DRY" = "--dry-run" ]; then
  git checkout -- "${FILES[@]}"
  echo "dry run: nothing committed, files restored"
  exit 0
fi
git add "${FILES[@]}"
git commit -q -m "Release $V"
git tag -a "v$V" -m "Pinpoint $V"
git push origin main "v$V"
echo "pushed v$V — follow it at https://github.com/gowtham012/pinpoint/actions"
