# Chrome Web Store — publishing checklist

The listing is the single biggest thing standing between Pinpoint and the developers who would use
it: "Load unpacked + Developer mode" loses most people before they ever start the bridge. This is the
path from this repository to an approved item.

**The honest residual, first:** the Store distributes the *extension* only. The bridge is still a Node
process on `127.0.0.1` that the developer starts themselves (`node bridge/cli.js setup`). Approval
does not change that, and the listing should not imply otherwise. Until it is approved, Load unpacked
stays the documented install.

## Packaging

1. Bump `version` in `extension/manifest.json`. The Store rejects a version it has already seen.
2. Zip the contents of `extension/` — reviewers expect `manifest.json` at the zip root. Nothing from
   `bridge/`, `node_modules/`, `.git/` or the test fixtures belongs in it.
   ```bash
   S=$(mktemp -d) && cp -R extension/ "$S/" && rm -f "$S/.DS_Store"
   node -e 'const f=process.argv[1],m=require(f);delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$S/manifest.json"
   (cd "$S" && zip -qr "$OLDPWD/dist/pinpoint-extension-cws.zip" .) && rm -rf "$S"
   ```
3. **Strip `key` from the zip only.** The Store rejects it ("key field is not allowed in manifest")
   and assigns its own id. Keep it in `extension/manifest.json`: Load-unpacked installs and the
   native host depend on that stable id. The Store id must also be in the native host's
   `allowed_origins`, or "Start bridge" fails for Store installs.
   The manifest `description` must be ≤132 characters.
4. Smoke-test the zip itself: unpack it somewhere else, Load unpacked from there, green toolbar dot
   with the bridge running, then mark an element on `demo/index.html`.

## Privacy policy

[PRIVACY.md](../PRIVACY.md) is the policy; the Store needs a URL, so link to it on GitHub (or publish
it through Pages). It is written to match what the code actually does — local-only, no telemetry, the
`<all_urls>`/`captureVisibleTab` story, and the one honest caveat that annotations are handed to the
coding agent you connect. Do not claim "nothing ever leaves your machine" without that caveat.

## Listing copy

**Name:** Pinpoint — UI annotations for coding agents

**Short description** (≤132 characters):

```
Click elements on localhost; send selector, styles, and a cropped screenshot to Claude Code, Cursor, or Codex via a local bridge.
```

**Detailed description:**

```
Pinpoint helps you brief coding agents about UI changes without describing "the third button on the left."

HOW IT WORKS
1. Run the local Pinpoint bridge on your machine (127.0.0.1) — `git clone`, then `node pinpoint/bridge/cli.js setup`, which asks the rest.
2. Open your local dev site (localhost, 127.0.0.1, .local / .test, or file:// with file access enabled).
3. Click the Pinpoint bar (or press Alt+Shift+A), click an element or drag a region, and write what should change.
4. Your agent receives the CSS selector, DOM path, computed styles, React/Vue component chain, source-file hint, and a cropped screenshot over MCP — or via a pending markdown file, or a copied prompt.

WHO IT'S FOR
Developers using Claude Code, Cursor, Codex, or any MCP client while building web UIs locally.

WHAT IT IS NOT
Pinpoint does not drive or automate the browser. You point; the coding agent edits. It is not a scraper, and it does not annotate production websites by default.

LOCAL-ONLY
The bridge listens on 127.0.0.1 only, and refuses any request carrying a web page's origin. Page content stays on your machine unless you hand it to an agent yourself. The extension appears on local development pages; any other tab requires explicit opt-in from the popup.

SETUP
This extension expects the open-source Pinpoint bridge (Node 18+): https://github.com/gowtham012/pinpoint

PERMISSIONS (WHY)
• Tab capture — to crop a screenshot of the element you marked.
• Host access — required by Chrome for tab capture; automatic injection is still limited to local development hosts.
• Native messaging (optional) — so the popup can start the local bridge after a one-time host install.

Open source (MIT).
```

**Category:** Developer Tools · **Language:** English

## Screenshots

1280×800, captured from the real extension on `test/site/index.html` — no mockups, no stock AI art.
They are generated into `dist/store/` (gitignored) and match the README images in `docs/images/`.

| # | File | Shows |
|---|---|---|
| 1 | `store-1-pick.png` | Picking: the highlight on the CTA and the bar while armed |
| 2 | `store-2-comment.png` | A typed instruction against the element it picked, with its component |
| 3 | `store-3-pins.png` | Numbered pins on a real page |
| 4 | `store-4-reply.png` | The agent's reply: the toast and the notes panel |

Promo tile: *"Click the element. Your coding agent gets the context."* over local dev UI.
`docs/demo.mp4` works as the promo video if it fits the size limit.

## Single purpose, and the questions reviewers will ask

| What looks risky | What is true, and how to say it |
|---|---|
| `<all_urls>` on a small tool | It exists solely for `tabs.captureVisibleTab`; no narrower permission grants that API. Automatic injection is limited to local-development matches in the manifest. |
| Looks like a general web annotator | Single purpose: annotating **local development** UI for coding agents. Other sites need an explicit per-tab opt-in. |
| Native messaging | The launcher runs exactly one thing — this repository's `cli.js` — on a port from the popup's own setting. No downloaded code, no shell. |
| Confusion with browser-driving agents | "Does not drive or automate the browser" belongs in the description, not just the reply. |

Reviewer note worth pasting into the submission: *Pinpoint is a developer tool. The host permission
exists solely for `captureVisibleTab`, which crops a screenshot of an element the developer clicked.
Content scripts auto-match local development hosts only; anything else is opt-in per tab. The
companion Node bridge is open source and binds to loopback.*

## Submitting

1. Chrome Web Store Developer account (one-time $5 fee).
2. Privacy policy URL — [PRIVACY.md](../PRIVACY.md) on GitHub is enough.
3. Build the zip, upload it as a **New item**.
4. Listing copy, category, language; screenshots and promo tile.
5. Permission justifications — the `captureVisibleTab` story above, verbatim.
6. Single purpose statement, then submit. Review lag is normal; nothing in the repo should wait on it.
7. After approval: put the Store link in the README's first screen, and keep the Store version in step
   with the tags here.
