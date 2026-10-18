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
| npm | `npm publish --provenance` (skipped if the version is already there) | trusted publisher, below |
| MCP Registry | `mcp-publisher publish` for `io.github.gowtham012/pinpoint` | nothing: GitHub OIDC |
| Chrome Web Store | builds the zip (manifest `key` stripped), uploads, submits for review | four secrets, below |
| GitHub release | notes from the changelog, the store zip attached | — |

Pushing needs write access to `gowtham012/pinpoint`. If git signs in as another account, run
`gh auth switch -u gowtham012` (and `gh auth setup-git`) first.

## One-time setup

### npm: trusted publishing (no token)

npmjs.com → **pinpoint-bridge** → **Settings** → **Trusted Publisher** → **GitHub Actions**:

- Organization or user: `gowtham012`
- Repository: `pinpoint`
- Workflow filename: `release.yml`

That is all: the workflow proves who it is with GitHub's OIDC token, so there is no npm token to
leak, expire or rotate, and every release carries provenance. Your account's 2FA stays on.

### MCP Registry

Nothing to set up. The registry trusts GitHub's OIDC token for the `io.github.gowtham012/*`
namespace, so the workflow publishes `bridge/server.json` itself.

### Chrome Web Store API (optional — without it the job builds the zip and you upload it)

1. [Google Cloud console](https://console.cloud.google.com/) → new project → **APIs & Services** →
   enable **Chrome Web Store API**.
2. **OAuth consent screen**: External, add yourself as a test user.
3. **Credentials** → **Create credentials** → **OAuth client ID** → **Desktop app**. Note the client
   ID and secret.
4. Get a refresh token once, on your machine:
   ```bash
   open "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent"
   # approve, copy the code, then:
   curl -s https://oauth2.googleapis.com/token -d client_id=<CLIENT_ID> -d client_secret=<CLIENT_SECRET> \
     -d code=<CODE> -d grant_type=authorization_code -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
   If Google refuses the `oob` redirect for your client, use `http://localhost` as the redirect URI
   and copy the `code` from the address bar of the page it fails to load.
5. GitHub → **Settings** → **Secrets and variables** → **Actions** → add
   `CWS_EXTENSION_ID` (the 32-letter item id), `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.

The job uploads to the existing listing and submits it for review; the listing text and screenshots
stay what you set in the dashboard.

### Safari

Not automated: the Mac App Store needs your signing team. Locally,
`TEAM=<team id> bash tools/make-safari.sh --release` archives and exports a signed build.
