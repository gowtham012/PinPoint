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
| Edge Add-ons | the same zip, uploaded and submitted for certification (Update REST API v1.1) | three secrets, below |
| GitHub release | notes from the changelog, every store zip that was built attached | — |

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

### Edge Add-ons API (optional — without it the job is skipped and you upload the zip yourself)

The API only updates a product that already exists, so the first version is a manual upload.

1. [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) → **Microsoft Edge** →
   **Create new extension** → upload `pinpoint-extension-cws.zip` from a GitHub release (the same zip
   as the Chrome Web Store) and fill in the listing.
2. Note the **Product ID** on the extension's overview page (also the GUID in its URL).
3. **Microsoft Edge** → **Publish API** → **Enable** the new experience if asked →
   **Create API credentials**. Note the **Client ID** and the **API key**.
4. Store them as repository secrets:
   ```bash
   gh secret set EDGE_PRODUCT_ID -R gowtham012/pinpoint
   gh secret set EDGE_CLIENT_ID  -R gowtham012/pinpoint
   gh secret set EDGE_API_KEY    -R gowtham012/pinpoint
   ```
   (each prompts for the value, so nothing lands in your shell history).

**API keys expire after 72 days.** A release after that fails the Edge job with a 401 that says so:
create new credentials on the same page and update `EDGE_API_KEY` (and `EDGE_CLIENT_ID` if it
changed), then re-run the job. A release made while the previous one is still in certification
ends with an `InProgressSubmission` notice; the new package waits in the draft, submit it from
Partner Center once the review is done.

Edge assigns the store build its own extension id. Until `bridge/native-host.js` knows it, Edge users
of the store build run `node bridge/cli.js install-native-host --id <edge id>` once for the
**Start bridge** button.

### Safari

Not automated: the Mac App Store needs your signing team. Locally,
`TEAM=<team id> bash tools/make-safari.sh --release` archives and exports a signed build.
