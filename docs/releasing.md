# Releasing

One command, then CI does the rest:

```bash
bash tools/release.sh 0.6.1            # --dry-run first if you like
```

It sets the version in `extension/manifest.json`, `bridge/package.json` (and its lock file) and
`bridge/server.json`, turns the changelog's **Unreleased** section into `## [0.6.1] — <date>`, commits,
tags `v0.6.1` and pushes. Write the release notes under **Unreleased** first: the script refuses an
empty section, because those notes become the GitHub release.

The tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml):

| Step | What it does | Needs |
|---|---|---|
| versions | tag, extension, npm package and registry entry all agree; the changelog has the section | — |
| tests | the full bridge and browser suite | — |
| npm | `npm publish` with automatic provenance (skipped if the version is already there) | trusted publisher, below |
| MCP Registry | `mcp-publisher publish` for `io.github.gowtham012/pinpoint` (skipped if listed) | nothing: GitHub OIDC |
| Chrome Web Store | builds the zip (manifest `key` stripped), uploads (API v2), submits for review | five secrets, below |
| GitHub release | notes from the changelog, the store zip attached | — |

Pushing needs write access to `gowtham012/pinpoint`. If git signs in as another account, run
`gh auth switch -u gowtham012` (and `gh auth setup-git`) first.

## One-time setup

### npm: trusted publishing (no token)

npmjs.com → **pinpoint-bridge** → **Settings** → **Trusted Publisher** → **GitHub Actions**:

- Organization or user: `gowtham012`
- Repository: `pinpoint`
- Workflow filename: `release.yml`
- Allowed actions: tick **`npm publish`** (configurations made after 2026-09-03 only allow
  `npm stage publish` until you do)

That is all: the workflow proves who it is with GitHub's OIDC token, so there is no npm token to
leak, expire or rotate, and every release carries provenance. Your account's 2FA stays on.

### MCP Registry

Nothing to set up. The registry trusts GitHub's OIDC token for the `io.github.gowtham012/*`
namespace, so the workflow publishes `bridge/server.json` itself.

### Chrome Web Store API (optional — without it the job builds the zip and you upload it)

1. [Google Cloud console](https://console.cloud.google.com/) → new project → **APIs & Services** →
   enable **Chrome Web Store API**.
2. **OAuth consent screen** (Google Auth Platform → **Audience**): External, then **Publish app** so
   the status reads **In production**. While it says *Testing*, Google expires the refresh token after
   7 days and the next release fails with `invalid_grant`.
3. **Credentials** → **Create credentials** → **OAuth client ID** → **Desktop app**. Note the client
   ID and secret.
4. In the OAuth client, add `http://localhost:8765` as an authorised redirect URI if it asks for one
   (Desktop clients accept localhost already).
5. Run, on your machine, signed in to `gh` as `gowtham012`:
   ```bash
   node tools/cws-auth.mjs ~/.config/pinpoint/client_secret_….json <EXTENSION_ID> <PUBLISHER_ID>
   ```
   `PUBLISHER_ID` is the UUID in the developer dashboard's URL. Keep the client JSON outside the
   repository (`client_secret_*.json` is git-ignored as a backstop).
   Approve in the browser. The script stores `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID` and `CWS_PUBLISHER_ID` as repository secrets; nothing is
   printed.

The job uploads to the existing listing and submits it for review; the listing text and screenshots
stay what you set in the dashboard.

### Safari

Not automated: the Mac App Store needs your signing team. Locally,
`TEAM=<team id> bash tools/make-safari.sh --release` archives and exports a signed build.
