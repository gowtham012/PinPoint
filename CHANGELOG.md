# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.2] — 2026-10-21

### Added
- **"<ProductCard> appears 6 times on this page."** When the element you pick belongs to a component
  rendered more than once (counted from React's fiber tree or Vue's instance tree, production
  builds included — a Vue 3 production build is read through its app's vnode tree; estimated from
  matching structure on plain HTML), the comment box says so and offers **Just this one** /
  **Everywhere (the component)**. The note carries `element.reuse` with the choice, the agent's
  markdown gets a "Reused:" line, and when nobody chose, the agent is told to ask before it edits the
  shared component.
- **A source hint for production builds, from the page's source maps.** When a minified build has
  stripped React's `_debugSource` and Vue's `__file`, Pinpoint takes the clicked component's own
  minified code, finds it in the scripts the page loaded, follows that script's `sourceMappingURL`
  (or `SourceMap` header; `data:` maps and indexed maps too) and maps it back to the original
  `file:line` and component name — React (Vite, webpack, Next.js) and Vue 3 production builds
  alike, arrow-function components included. The note's source hint says `method: "sourcemap"`.
  The service worker fetches only the page's own origin (or another loopback port from a loopback
  page) — never a third-party host — within 4 seconds and 8 MB per file; on any failure the note
  simply has no file, as before. The VLQ decoder is ~40 lines in `extension/sourcemap.js`, no new dependency.

## [0.7.1] — 2026-10-20

### Added
- **The iOS and Android pickers hold the conversation.** A note waiting on you shows a **?** pin that
  opens the agent's question and an answer box; a finished note shows the agent's reply with
  **Accept** and **Not quite** instead of the pin silently vanishing. Pins follow the bridge live.
  Trailhead takes `--sticky-book` for its "after", and the iOS demo video is re-recorded with the whole
  exchange, zoomed in, plus a 9:16 cut (`docs/demo-ios-vertical.mp4`).

### Changed
- **A new logo: the lime drop pin.** The toolbar icons (now with a 32 px size), the on-page bar,
  the site's favicon and the README use it; the bar shows it in colour, and inverted (ink pin, lime
  dot) while picking. `docs/logo/` has every size, wordmarks, an app icon, favicon.ico, the social
  preview and Chrome Web Store tiles, all rendered from `tools/logo/mark.svg` by
  `bash tools/make-icons.sh`. `node tools/make-bar-shots.mjs` recaptures the README's bar screenshots.
- **No more `innerHTML` with values in the extension.** The bar, popover, notes list, hover tip and
  popup build their dynamic parts with DOM calls, so text from a page, an agent or the bridge can
  never become markup. `web-ext lint` on the Firefox package now reports no "Unsafe assignment to
  innerHTML" warnings (was 11).

### Fixed
- **Picker races on slow machines.** A frame no longer takes back its own mirrored picking state, so
  picking stops coming back over the comment box; an answer older than a note just sent no longer wipes
  its pin; and a capture skips a tab that is navigating away. The browser tests wait for every frame to
  be picking and for the worker, and one failure no longer cascades, so macOS CI now blocks like Ubuntu.
- **Esc right after Send keeps picking off.** Picking comes back once the worker has taken the crop;
  an Esc (or a stop from another frame) in that moment used to be overruled when it did. Now it wins.
- **An agent renaming a button no longer loses it.** An element with no id or data attributes was
  recognised by its text, so a fix that changed the label made the after crop "missing" and re-check
  say gone. Where the selector still lands on the same tag, attributes and neighbouring text, the
  element is found, its after crop is taken and re-check says changed. A different element
  re-rendered into the old spot is still refused.

## [0.7.0] — 2026-10-18

### Added
- **Releases ship from CI.** `bash tools/release.sh x.y.z` sets the version everywhere, closes the
  changelog and pushes a tag; `.github/workflows/release.yml` then tests and publishes to npm (trusted
  publishing, with provenance), the MCP Registry, the Chrome Web Store (API v2) and GitHub releases.
  See `docs/releasing.md`.
- **Android emulator picker** at `/android`: the same point-and-comment page as `/ios`. It reads the
  screen through adb (`uiautomator dump` + `screencap`), with no driver to install. It prefers the one
  running emulator and reads a physical device only when `ANDROID_SERIAL` names it. Notes carry
  `android-emulator://<avd>` URLs and an `android-native` source hint, and the MCP instructions and
  `pending.md` tell agents to grep the `resource-id` first. `setup --for android` checks for adb.
  (`bridge/ios.html` is now `bridge/picker.html` and serves both pages.)
- **Accept / Not quite.** When your agent finishes a note, the "#n done" message is now a card with its
  reply and two buttons. **Accept** marks the note accepted. **Not quite** opens the notes panel with
  that note's reopen box ready to type in. The card stays about 10 seconds and holds while the pointer
  is on it. A note you accepted never pops up again in another tab. Reopening a note, or the agent
  resolving it again, clears the acceptance. New bridge route: `POST /annotations/:id/accept`, which
  works only on a resolved note and needs the bridge token like every other extension call.
- **Page context on every note.** A note now carries the page's uncaught errors and unhandled promise
  rejections (message plus three stack lines) and its failed requests (status 400 or above, or a
  network error) from the minute before you marked it. It is attached only when something went wrong.
  Everything is redacted in the browser first (see Security). Request bodies and headers are never
  read. Agents get it as page data, not instructions. The console is not wrapped, so DevTools still
  points at your own code. `inspector.js` now runs at `document_start` so it catches errors thrown
  while the page loads.
- **Dictation.** A mic button in the comment box, in Chrome and Safari on secure pages (localhost
  counts). Only a real click starts it; click again to stop. Speech is added to whatever you have
  already typed. A blocked microphone, a missing microphone and an unreachable speech service each get
  their own message. Not offered on Firefox.
- **Record steps.** While picking, **Record steps** on the bar turns each real click into a step
  (selector, description, label, URL; at most 10). Recording survives navigation in the same tab (kept
  in `storage.session` per tab, cleared on Done, Esc or tab close). Done sends one note of kind `flow`
  with `steps[]`. The markdown lists "Steps to reproduce", and `get_annotation` attaches up to 5 step
  crops (each 600 px at most).
- **Before / after on resolve.** `PINPOINT_AFTER_DELAY` ms after a resolve (default 3000, `0` = off),
  the bridge re-checks the element and stores an `after` crop, but only if the note is still the same
  resolved answer. The page also asks for one when it shows the done card or the panel. The panel
  shows Before / After thumbnails. Only the newest 20 done notes keep after pixels. New route
  `POST /annotations/:id/after` (token-guarded like every extension route).
- **Edge Add-ons.** The release workflow uploads the same zip as the Chrome Web Store and submits it
  for certification through the Edge Add-ons Update REST API v1.1 (`tools/edge-publish.sh`). It is
  skipped until `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID` and `EDGE_API_KEY` are set.
- **Firefox.** `tools/make-firefox-zip.sh` builds an addons.mozilla.org package from the same
  `extension/` (gecko id `pinpoint@gowtham012.github.io`, Firefox 140+, `redact.js` loaded before
  `background.js`, no Firefox for Android). CI runs `web-ext lint` on it, and the release submits it
  with `web-ext sign --channel listed` when `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` are set.
- **"Start bridge" on Firefox.** `install-native-host` also registers the bridge launcher with Firefox
  (`~/Library/Application Support/Mozilla/NativeMessagingHosts` or `~/.mozilla/native-messaging-hosts`).
- **Grant access to local sites.** A popup button that appears when the browser has withheld access to
  local dev sites (Firefox lets users do this at install). It asks for the local patterns only.
- **GitHub releases attach every store zip** that was built (Chrome/Edge and Firefox).
- **CI runs on ubuntu, macOS and Windows.** Only ubuntu blocks PRs and releases for now. macOS and
  Windows report results, and each starts blocking once its `macos-blocking` / `windows-blocking` input
  is set to true.

### Changed
- **New permission: `webRequest`**, used only to see which requests from your local dev pages failed.
  Chrome shows no new install warning (checked with `chrome.management.getPermissionWarningsByManifest`
  against the 0.6.0 manifest; the warnings are identical).
- **Lighter note lists.** `GET /annotations` and the project's `pending.json` carry step and after
  crops as their size only, without pixels (`images=1` still returns everything).
- **Re-checks blink less.** A re-check hides Pinpoint's overlay only when part of it would be in the
  crop. If that part is the open panel or the comment box, it skips the fresh crop ("Pinpoint's own
  panel was in front of it") instead of blinking them.
- **The notes panel no longer re-renders** over an answer you are typing.
- **After crops from the panel** wait the same rebuild delay as a resolve does, are no longer asked
  for notes resolved more than 10 minutes ago, and an element that is gone is recorded once, so the
  panel stops asking for it.
- **The Android screenshot is taken after the view tree has settled**, so hover boxes and crops match
  the picture even when the screen was still animating.
- **Selectors built from app or page strings** (Android, iOS) are kept to one line, with quotes
  escaped, in `list_annotations` and the bridge log.
- **The ui-* test suites run** in `npm test`, `test:bridge` and CI.

### Fixed
- **Restarting the bridge on Windows** no longer kills the replacement along with the old process.
- **"Start bridge" works for the Chrome Web Store install.** The Store gives the extension its own id
  (`mkjegdlcpijniabibingcbmjfedcepgp`); the native host now allows it as well as the unpacked build.
  Re-run `node bridge/cli.js install-native-host` once to pick it up.
- **`resolve_annotation`'s "never re-checked" warning never went away.** It read
  `element.recheckedAt`, but nothing ever wrote it. Every successful re-check (`recheck_annotation`
  and the automatic after check) now sets it.
- **`setup` on Windows** runs `claude` and `npm` as one quoted command line, so the `.cmd` shims work,
  with no DEP0190 warning.
- **Firefox: `file://` pages** no longer show Chrome's "Allow access to file URLs" advice, or a
  `chrome://extensions` link that cannot open there.
- **The setup test's `/ios` URL** follows `PINPOINT_TEST_PORT`.

### Security
- **Page context is redacted before it leaves the browser** (`extension/redact.js`). Each string is cut
  to 2000 characters, scrubbed, then capped at 300. Query strings and fragments are dropped from URLs
  (a stack frame's `:line:col` is kept, even after Vite's `?t=`), passwords in URLs are removed, and
  Bearer and Basic credentials, JWTs and long hex/base64 strings are replaced. So are the values of
  `key=value` and `"key":"value"` pairs whose name ends in a secret word, including prefixed names
  such as `DB_PASSWORD`, `csrf_token` and `connect.sid`. If the redaction script is missing, nothing
  is attached.
- **Page context and recorded steps are untrusted data** in the agent's markdown: flattened to one
  line, emphasis and backticks removed, under a label saying they are page data. Only trusted
  pointerdown events in the top frame become steps.
- **Dictation starts only from a trusted click** inside Pinpoint's closed shadow root.
- **`/android/screen` (which runs adb) needs the `x-pinpoint: 1` header**, like `/ios/screen`, and the
  `/android` routes accept only the bridge's own origin or a token-carrying extension. View-tree text
  is rendered with `textContent` only.
- **Release credentials stay in repository secrets.** `tools/edge-publish.sh` hands the Edge key to
  curl through a temporary header file, never on a command line or in the log. The Firefox
  native-messaging manifest allows only Pinpoint's gecko id.

## [0.6.0] — 2026-10-18

A deep review (15 agents, every finding adversarially verified) and a redesign. 152 automated tests.

### Security
- **A web page can no longer drive Pinpoint.** The in-page UI is a closed shadow root and the picker
  ignores synthetic events, so a page script cannot type into the comment box, press Send, or arm the
  picker to file a note the developer never wrote.
- **Only Pinpoint's own extension can use the bridge.** Any installed extension could call
  `127.0.0.1`; extension requests now need the token in `~/.pinpoint/token`. Chrome fetches it through
  the native host; Safari and Firefox paste it into the popup once (`node bridge/cli.js token`).
  **Upgrade the extension and the bridge together** — a 0.5 extension cannot send the token.
- `/annotations/wait` and `/ios/screen` need an `x-pinpoint` header, so an `<img>` on any website
  cannot claim a note or start Maestro. Scraped page text is flattened so it cannot forge a
  `**Change:**` line, and the HTML fence outgrows any backticks inside it.

### Added
- **Notes are conversations.** New MCP tool `reply_annotation`: the agent asks instead of guessing,
  the pin shows a **?**, and the answer from the notes panel sends the note back with the whole
  thread. Finished notes can be reopened with **Reply…**.
- **Drafts** (**Draft** or ⇧⌘↩) stay on the page until **Send** on the bar hands them all over.
- **Whole-page notes**, cropped to the window.
- **Move the bar anywhere** by dragging it; it stays put per site.
- **Keyboard picking**: Tab moves the highlight, arrows walk the tree, Enter picks.
- A **"Bridge off · Start"** pill when the bridge stops, and Send starts it and resends; a toast with
  the agent's reply and an unread dot; one-click remove and **Clear done** in the panel; the popup
  finds a bridge on a neighbouring port, shows agent activity, and jumps to a note's tab.
- **Trailhead**, a one-screen SwiftUI demo in `demo/ios/` for trying the Simulator picker.
- **Published.** `pinpoint-bridge` is on npm, Pinpoint is in the official MCP Registry as
  `io.github.gowtham012/pinpoint`, and on cursor.directory and Glama. `npx -y pinpoint-bridge mcp` is
  now the MCP entry the README suggests, and `npx -y pinpoint-bridge` runs the bridge (and the iOS
  picker) with no clone at all.
- **`Dockerfile` and `glama.json`**, so Glama can build the server, list its tools and score it, and
  so the listing can be claimed. A hosted container is for that inspection only: Pinpoint talks to
  your browser and Simulator on `127.0.0.1`, so it cannot do anything useful deployed elsewhere.

### Changed
- **A new look**: ink panels and a lime accent in every theme, a crop-mark highlight, pins as
  numbered drops. Opaque surfaces, AA contrast, visible focus, reduced motion respected.

### Fixed
- Resolves were silently undone on non-default ports; abandoned `wait_for_annotation` calls swallowed
  the next note; `/restart` re-ran the setup wizard; a region drag followed the link under it; Esc
  reached the page's own modals; crops of half-scrolled elements included what sat below; region pins
  lost their box; pins outlived client-side route changes; picking drifted between frames; the
  shortcut threw away a half-written note; `setup --for ios` hung on Maestro 2.9; and about thirty more.
- The bridge's `package-lock.json` is tracked, so a fresh clone (and Glama's build) can `npm ci`.
- **CI has been red since 10 September.** The setup test assumed a `claude` CLI on the machine,
  which CI does not have, so setup skipped the hooks the test then looked for. The test now puts a
  stub `claude` on its own PATH.

## [0.5.0] — 2026-10-02

Found by installing Pinpoint and using it as a first-time user, then reading the code for causes.

### Added
- **Notes can be about behaviour, not only looks.** Every channel used to call a note a "UI change
  request" and the MCP server pointed agents at "UI or styling" tasks, so "this should save the draft
  first" got the button restyled. Now the agent is told a note may be about how the element looks *or*
  what it does, that the comment in the developer's own words is the whole instruction, and that for a
  behaviour change the element is the way in — follow it into the handlers, state, API calls and
  backend behind it. The comment box says so too ("how it looks or what it does?").
- **`setup` asks whether the app is web or native iOS.** Web gets the browser extension as before;
  iOS skips the browser step, checks for Xcode, Maestro and Java (saying how to get whichever is
  missing, installing nothing), and opens the Simulator picker. `--for web|ios|both` answers it
  without asking.
- **Native iOS apps, from the Simulator.** A native app has no DOM, so the bridge now serves a picker
  at `/ios` that shows the booted Simulator's screen (`xcrun simctl`) over its accessibility tree
  (Maestro, kept running as one `maestro mcp` process so a refresh takes ~1s rather than the ~14s a
  `maestro hierarchy` run costs to boot its JVM and driver). Hover to see each element, click one, say what should change — it becomes an
  ordinary annotation with the accessibility identifier, label, tree path, frame and a crop, so MCP,
  hooks and `pending.md` need no changes. Works for SwiftUI, UIKit, React Native and Flutter with
  nothing added to the app. No source-file hint (the tree has none) and no `recheck_annotation` yet.
- **`docs/stale-demo.gif`**, and `tools/make-stale-demo.mjs` that records it: two notes on a panel
  that rebuilds itself, so one pin re-finds its element among new nodes while the other says it is
  not on this view — and the verdicts an agent gets for both. The recorder waits on the states it
  narrates rather than on timers, so it cannot film a claim that is not true.
- **A pin can tell you it has gone stale.** The browser already re-identified elements after a
  re-render — a pin either finds its own element again or hides rather than sit on a stranger — but
  that knowledge never left the page. Now the bridge is told, and the agent reads it: an annotation
  whose element went missing, or whose selector stopped matching it, arrives marked *possibly stale*
  with what to do about it. **`recheck_annotation`** does that on demand: it asks the open tab to
  find the element again, and answers with a verdict (gone / moved / changed / unchanged), the
  specific differences — text, size, the computed properties that changed by name — and a fresh crop
  next to the one taken when it was marked. With no tab open it says it could not look, which is
  never the same answer as "nothing changed". Resolving something the page had moved under still
  works, and now says so. Asked for by a reader, and tested the way they framed it: a page that
  rebuilds its DOM between the pin and the edit.
- **`node bridge/cli.js setup` — the whole install in one command.** With `git clone` in front of it
  that is two commands and nothing else: it installs the bridge's dependencies itself (it is written
  to run before `npm install`), then asks, with a default on every question — which project to
  annotate, which of Claude Code, Cursor and Codex to register (merging their config rather than
  replacing it, and backing up Codex's TOML), whether to install the hooks, and which of your
  installed browsers to load the extension into. It opens that browser's extensions page, puts the
  `extension/` path on your clipboard, and then *confirms* the extension connected — the bridge now
  records `extensionSeenAt` and reports it on `/health`. `--yes` runs it unattended; a pipe or a CI
  runner is treated the same way rather than hanging on a prompt. `setup.sh` is now a shim for it.
- **[PRIVACY.md](PRIVACY.md) and [docs/chrome-web-store.md](docs/chrome-web-store.md).** What the
  extension handles, where it is stored, and the one place it leaves by design — the agent you
  connect; plus the packaging, permission justifications and listing copy needed to put the extension
  on the Chrome Web Store, so "Load unpacked" stops being the only way in. The README also says
  plainly what Pinpoint is *not*: a browser-driving agent.
- **Start and restart the bridge from the browser.** `node cli.js install-native-host` registers a
  small native messaging launcher with every Chromium-based browser on the machine; after that the
  popup's **Start bridge** button really starts the process, and while the bridge is running that
  button and the new **↻** in the on-page bar restart it — so picking up a new build no longer
  means going back to a terminal. The launcher can run exactly one thing, this repo's own `cli.js`,
  on a port taken from the popup's own setting: no path, command or project directory crosses that
  boundary. Restart is plain HTTP to the bridge itself, so it needs no launcher and works in Safari.
  macOS and Linux only; on Windows the bridge still starts in a terminal.
- **`/health` reports `cliPath`**, so the popup can print the real command to run instead of a
  `<pinpoint>` placeholder nobody can copy.
- **Agents are told apart.** The MCP handshake carries each client's own name, so with more than one
  connected the bar names the agent that is working (`claude-code`, `cursor-vscode`, `codex`) rather
  than saying "your agent", and each reply in the notes panel is attributed to whoever wrote it
  (`resolvedBy`).

### Changed
- **The extension now pins its id** with a manifest `key`, because native messaging must whitelist
  an exact id and an unpinned one is derived from the install path. **If you already have Pinpoint
  loaded, reload it once** — the id changes, so the popup's port and corner reset to their defaults
  and, if you had turned on *"Allow access to file URLs"*, you must turn it back on. Remove the old
  entry from `chrome://extensions` afterwards. (If Pinpoint is ever submitted to the Chrome Web
  Store, this key must be stripped from the uploaded zip.)

### Fixed
- **The iOS picker recovers when another Maestro restarts the Simulator driver.** Every Maestro on a
  machine shares one on-device driver; when another one (an agent's Maestro MCP server, a test run)
  restarted it, the bridge's Maestro kept talking to the dead one and every refresh failed with
  "Device became unreachable" until the bridge was restarted. A failed read now starts a fresh Maestro
  and retries once, and a cold start may take up to two minutes rather than timing out at one.
- **Two agents watching at once both got the same note.** `wait_for_annotation` woke every blocked
  waiter with the same annotation, so they duplicated the work and the second `resolve_annotation`
  silently replaced the first agent's reply. Each new note now goes to exactly one waiter, and
  resolving something another agent already finished says so instead of overwriting it quietly.
- **Restarting the bridge froze the pins for 25 seconds at a time.** The extension long-polls
  `/events?since=<n>`, and a restarted bridge starts counting from 1 again — so every poll from a
  client that was ahead sat out the full timeout before returning. A client from a previous life is
  answered at once.
- **The agent's replies were unreachable, so a finished note looked deleted.** The bar's counter is
  the only way into the notes panel, and it hid itself whenever nothing was pending — so the moment
  an agent finished the last note, the reply it had just written could never be opened. The counter
  now stays while there is anything to read and says "1 done" rather than "1 note" when nothing is
  outstanding.
- **The counter was inert while picking.** The whole bar is click-through so it can never block the
  element you are aiming at, and only Stop was exempt — but checking what you have already marked
  is exactly a mid-picking act. It takes clicks now, like Stop.
- **A screenshot could show a different part of the page, with nothing saying so.** The crop was
  measured in viewport coordinates when Send was pressed but taken moments later by the worker, so
  scrolling in between left those coordinates pointing at whatever had moved into that spot — and
  `screenshotSkipped` stayed unset, so the agent received a confident picture of something the
  developer never marked. Worse than no picture. The rect is now also sent in document coordinates
  and re-derived against the page's actual scroll at capture time, so a small scroll still gets a
  correct crop and scrolling away is refused with a reason. (The README already promised this
  behaviour; it was not true.)
- **Clicking Stop also opened a comment box on the bar itself.** `isOurs()` asked
  `el.closest("pinpoint-root")`, and `closest()` does not cross shadow boundaries — so from inside
  our own shadow root every control Pinpoint owns read as page content, and the document's
  capture-phase click handler tried to annotate the Stop button. It only ever showed on Stop
  because that is the one control clickable *while* picking.
- The MCP server announced itself as `0.1.0` while the package was `0.4.0` — the string every MCP
  client shows in its server list. It reads `package.json` now, so the two cannot drift.
- **A region anchored to the whole page instead of the thing you drew around.** Nobody drags
  pixel-perfect: a box drawn generously around a card is contained by no card, so a rule asking for
  the element that *contains* the box reached `<main>`. Asking instead for the outermost mostly-
  covered element fails the same way, because a short page container is itself mostly covered and,
  being outermost, swallows the card inside it. The rule now is **the smallest element that
  accounts for at least half the box**: share is measured against the box, so a candidate must
  already be about the size of what was drawn, and the smallest such element is the most specific
  one. Span three cards and no single card reaches half, so their grid wins instead.
- **`file://` pages were promised but dead.** Chrome keeps *Allow access to file URLs* off per
  extension, so the content script never injected — while `isLocalDev()` returned true for `file:`,
  so the popup offered to annotate and then reported a message asserting `file://` pages work.
- **`install-hooks` broke on any path containing a space**, because the quotes that made the path
  safe were stripped. The install reported success and every prompt failed afterwards.
- **Hook merging deleted unrelated hooks** — ownership was a substring match on `"pinpoint"`, so a
  user's own hook mentioning it, or any repo in a `pinpoint/` folder, was dropped.
- **A flag before a subcommand started a daemon**: `cli.js --port 7332 status` answered by running
  a server instead.
- `install-hooks` errors reached the user as raw stack traces instead of the sentences it writes.
- The origin guard admitted `http://localhost` — the dev site being annotated. `SECURITY.md` and
  the README both said otherwise; the code now matches.
- `setup.sh` defaulted the project to a personal path (`~/Desktop/markus`) in a public repo.
- `content.js` called `captureScreenshot()`, which is defined nowhere. It never fired because
  nothing passes `{screenshot: true}`, but it would have thrown for whoever did. Removed.
- **Windows: the installed hook carried a mangled path.** The path was JSON-escaped rather than
  quoted, so `C:\Users\dev\...` reached the shell as `C:\\Users\\dev\\...`. Windows often
  tolerates doubled separators, but when it does not the only symptom is "Cannot find module" on
  every prompt.
- **The browser suite could not run on a fresh clone.** Playwright ≥1.49 launches
  `chrome-headless-shell` for `headless: true`, which cannot load extensions.
- **`npm test` had never worked** — it hands both files to one `node --test`, which runs them in
  parallel, and both bind port 7399. It is sequential now, matching CI.
- **The bar could land in the wrong place** on pages whose `<html>` carries a transform.
  `keepDockOnScreen()` sets `transform: none` and measures on the next line, but the bar also
  transitioned `transform` over 140ms — so the rect was read mid-animation and the correction was
  computed from the wrong position. It self-corrected on the next pass, which is why it only
  showed up intermittently. The transform is only ever a position fix, never an effect, so the
  transition is gone.

### Changed
- **New logo** — a click: an open ring, the burst of the press, and the cursor coming through the
  gap. Drawn as SVG rather than traced from a raster, so it carries transparency and stays crisp.
  Two cuts on purpose: at 16px the burst strokes and the ring merge into an unreadable blob, so the
  toolbar size drops the burst, thickens the ring and enlarges the cursor. Sources and a
  regeneration script live in `tools/logo/` and `tools/make-icons.sh`. It is violet rather than
  black because a black icon disappears on a dark browser toolbar.
- **Note numbers are per page.** One global counter meant the first note on a new site could read
  "#14", which tells the person looking at it nothing. Each page now numbers from 1, matching the
  pins on screen, the panel titled "Notes on this page", and the counter. Ids stay globally unique
  and remain what an agent resolves by; a number still works as a convenience while it names one
  note, and resolves nothing when it does not — `DELETE /annotations/1` would previously have
  deleted #1 from every page in the store.
- **The bar now opens in the top-right corner** rather than bottom-left, and the popup's corner
  picker opens on the same default.
- **Two hues in the bar instead of three.** "You" was `#a8577f`, a mauve unrelated to anything
  else, so the bar carried violet (h248), mauve (h330) and orange (h18) — three corners of the
  wheel, which is why it read as muddy. "You" is now the same violet as your pins and the brand
  mark; orange stays the agent.
- **The idle agent avatar was an unreadable blob.** Greyscaling the orange fill at 38% produced
  about `#cacaca`, leaving its white glyph at 1.64:1. It is now drawn as an outline — absent
  rather than muddy — at 5.26:1.
- **One optical row.** The bar's children padded 5/10, 5/8, 5/10 and 0/4/0/6 — four rhythms in a
  200px bar. Every control is now 24px tall on a single horizontal rhythm, the separators are
  centred, and the `⌥⇧A` keycap has the size and tracking it needs to be legible at all.
- Your avatar now stacks in front of the agent's, which is what stacked presence means.
- **The on-page bar is no longer dimmed.** Fading it (`.58` at rest, `.4` minified) put the label
  at 4.4:1, the shortcut keycap at 2.34:1 and the minified bar at 2.55:1 against a white page —
  below the 4.5:1 AA floor. Discretion now comes from size and position.
- **Pins, note numbers and the picked-element chip are no longer error red.** White on `#e5484d`
  measured 3.91:1 at 11px bold, and a pending note is not a fault. Red now means only *error* or
  *delete*.
- **Stop is clickable while picking.** The bar stays inert so it can never block the element you
  are aiming at, but clicking Stop no longer falls through and annotates the page behind it.
  (Its first cut was white-on-white — 1.00:1, invisible — because the mockup had a violet bar while
  only the toggle pill actually turns violet. The test now measures the control's contrast, not
  just that it responds.)
- The popup honours `prefers-color-scheme`; it was a white flash in a dark browser.

### Added
- **Safari support.** `tools/make-safari.sh` converts the extension with Apple's
  `safari-web-extension-converter` and builds it — verified end to end here, `BUILD SUCCEEDED`.
  The script bakes in the argument that otherwise wastes an afternoon: the converter derives the
  app id from the last component of `--bundle-identifier`, so if that component does not match the
  app name the extension's id is not a prefix of the app's and Xcode refuses to embed it.
  Safari does not support `"world": "MAIN"` content scripts, so the React/Vue component chain and
  source-file hint are unavailable there; everything else behaves the same.
- Cross-browser namespace shim: Safari and Firefox expose the promise API as `browser`, Chrome as
  `chrome`. Each script now prefers whichever exists, so the ~30 `await chrome.…` calls work on all
  three. `chrome.extension.isAllowedFileSchemeAccess` is Chrome-only and is probed before use.
- **You can see what your agent did.** A finished note used to disappear, leaving you with a
  vanished pin and no idea what changed. It now stays in the notes panel with the agent's reply
  underneath it. That reply is the `note` on `resolve_annotation`, which was optional and so was
  simply skipped — every resolved annotation came back with `resolution: null`. It is required now,
  and the tool says plainly that the developer reads it in their browser and that "done" is not an
  answer. `cli.js resolve` gained `--note` to match; it accepted one internally but never passed it.
- `demo/index.html` — a self-contained demo site for trying Pinpoint and filming it: card grid,
  pricing tiers, near-identical siblings, a tab panel that rebuilds itself, a dense table, a form.
- **Region selection.** Drag instead of clicking to mark an area rather than a single element.
  A box has no element of its own, so it is anchored to the deepest element that fully contains
  it — which is what lets a region pin re-find itself after a re-render exactly as an element pin
  does, and gives the agent a container to edit plus the list of what the box held. The screenshot
  crops to the box.
- README screenshots — the bar idle and picking, the popover, a pin, and a hero shot. Generated
  from the shipped extension by a script that runs its own bridge on a scratch port.
- `prefers-reduced-motion` support — seven animations ran unconditionally, two of them forever.
- README: prerequisites, corrected step order (the bridge blocks the terminal — you need a second
  one), the `file://` permission step, `setup.sh`, and a Troubleshooting section.
- Three tests, taking the suite from 79 to 82: a flag before a subcommand, hooks surviving a path
  with a space (and leaving unrelated hooks alone), and Stop ending a pick with a real mouse click
  while the rest of the bar stays inert.

## [0.4.0] — 2026-09-08

First public release.

### Added
- **Extension** — click any element on a local dev page, type what should change, send it.
  Sticky comment mode, hover outlines naming the React/Vue component, numbered pins that
  live in the bridge (so they survive reloads and appear in every tab showing that page),
  an on-page bar with a notes list and live agent presence, and a per-site corner setting.
- **Bridge** (`127.0.0.1:7331`) — stores annotations in `~/.pinpoint/annotations.json`,
  streams live events to the extension, mirrors pending notes to `<repo>/.pinpoint/pending.md`,
  and prunes resolved annotations past 200 (`PINPOINT_MAX_RESOLVED`).
- **MCP server** over both stdio and Streamable HTTP: `get_pending_annotations`,
  `list_annotations`, `get_annotation`, `resolve_annotation`, `wait_for_annotation`,
  `clear_annotations`, plus the `pinpoint://pending` resource.
- **Claude Code hooks** — `cli.js install-hooks <repo>` wires `SessionStart` and
  `UserPromptSubmit` so pending annotations arrive with your next message, without
  Pinpoint ever being mentioned. Existing settings are preserved; re-running updates
  rather than duplicates.
- **Capture** — element screenshot (element + 8px, long edge ≤1200px) taken by the
  service worker after the comment is stored, so navigating away costs the picture,
  never the note. Selectors prefer stable attributes over positions, and each annotation
  carries a fingerprint so a pin can tell whether its element is still the one you clicked.
- **Offline fallback** — with the bridge down, **Send** copies a ready-to-paste prompt
  to the clipboard.
- 79 tests: bridge/CLI/hooks/MCP on a scratch daemon, and a Chromium suite that loads the
  unpacked extension and drives React, Vue, shadow DOM, an iframe, a strict-CSP page, a
  3,600-node stress page and a form that rebuilds its own DOM.

[0.4.0]: https://github.com/gowtham012/pinpoint/releases/tag/v0.4.0
