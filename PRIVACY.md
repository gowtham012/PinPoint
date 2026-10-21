# Privacy

*Last updated: 20 October 2026. This describes Pinpoint 0.7 — the extension in `extension/` and
the bridge in `bridge/`, as published in this repository.*

Pinpoint is a developer tool that runs on your own machine. There is no Pinpoint account, no Pinpoint
server, and no analytics: the extension's only network destination is a bridge listening on
`127.0.0.1`, which is a process you start yourself.

## What it handles, and only when you mark something

Nothing is collected while you browse. When you click an element (or drag a region) and press Send,
this is assembled and posted to your local bridge:

- **the page** — URL, title, viewport size, scroll position
- **the element** — tag, id, classes, a CSS selector, DOM path, rendered text, trimmed `outerHTML`,
  `role`/`aria-*`/`data-*` attributes, bounding box, about 25 computed style properties, and a
  fingerprint used to re-find the element after a re-render
- **the framework hint** where a dev build exposes it — React/Vue component chain and `file:line` —
  or, when a production build has stripped that, the `file:line` the page's own source map gives (below)
- **your comment** — the sentence you typed
- **a screenshot** — a PNG cropped to the element, captured by the extension's service worker
- **page errors and failed requests**, only when something went wrong (below)

From the **iOS Simulator picker** (`/ios`, served by the bridge), the same note is made from the
Simulator instead: the bridge takes a screenshot of the booted Simulator with `xcrun simctl` and reads
its accessibility tree (identifiers, labels, visible text, frames) through Maestro, both locally, each
time you open or refresh the page. Only the element you click and send is stored, with a crop of it;
the full screenshot and tree are discarded.

From the **Android emulator picker** (`/android`), the bridge runs `adb` on your machine against the
emulator (or the device named by `ANDROID_SERIAL`; a physical device is never read otherwise). It
reads the screen with `uiautomator dump` into a temporary file on the device
(`/sdcard/pp-<random>.xml`) and then takes a `screencap`. The file is deleted once both steps have
finished, whether they succeed or fail. Both stay on your machine and are stored only as part of a
note you send, like the iOS picker's. Nothing is sent anywhere else.

**Page errors and failed requests.** When you send a note, Pinpoint attaches what went wrong on that
page in the previous 60 seconds: uncaught JavaScript errors and unhandled promise rejections (message
plus up to three stack lines), and failed network requests (method, URL with the query string
removed, and the HTTP status or network error). Only requests made by local development pages are
recorded. Request and response bodies and headers are never read. The record is kept in the
extension's memory only, per tab, and is dropped when the tab closes or loads a new page. Nothing is
attached when nothing went wrong.

**Source maps.** When the framework hint finds no file (a production build), the extension's
service worker reads the page's own scripts and their source maps to find where the clicked component
came from: it downloads only scripts the page itself loaded, and only from the page's own origin (or,
on a loopback page, another loopback port), without cookies, at most 8 MB each, for at most 1.5
seconds. Scripts and maps on any other host are never requested. What it keeps is a file path, a
line and a component name in the note's source hint; the scripts and maps stay in the worker's
memory for a minute and are not stored or sent anywhere.

Before page errors and failed requests leave the browser, they are cut to 2000 characters and then
scrubbed. Query strings and fragments are dropped from URLs, but a stack frame's line:col is kept.
Passwords in URLs (`scheme://user:pass@host`) are removed. Bearer and Basic credentials, JWTs, long
hex and base64 strings are replaced. So are the values of key=value and "key":"value" pairs whose name
ends in a secret word (api key, token, secret, password/passwd/pwd, session id, sid, signature/sig,
auth), including prefixed names such as DB_PASSWORD or csrf_token. Each string is capped at 300
characters. If the redaction code is missing, nothing is attached.

**Recorded steps.** For each click while you record steps, Pinpoint keeps the clicked element's
selector, a short description, its visible label (never an input's value) and the page URL, plus a
small screenshot crop (600 px at most). Text and URLs go through the same redaction as page context.
Until you press **Done** they are held only in the browser's session storage for that tab, which
content scripts and pages cannot read. They are deleted on Done, Esc or when the tab closes, and never
written to disk by the extension. After Done they travel with the note to the local bridge like any
other note.

**After crops.** When a note is resolved, the bridge asks your open tab for one more crop of the
element, so you can compare Before and After. It is stored with the note in
`~/.pinpoint/annotations.json`, only for the newest 20 done notes, and never leaves your machine
except to your coding agent over MCP. `PINPOINT_AFTER_DELAY=0` turns it off.

**Dictation.** The mic button uses your browser's built-in speech recognition
(`webkitSpeechRecognition`). In Chrome, and in Safari depending on its settings, your browser sends
the audio to its maker's speech service (Google for Chrome, Apple for Safari) to turn it into text.
Pinpoint never receives, stores or sends the audio; it only sees the text the browser returns, which
goes into your comment box for you to edit. The microphone is only switched on by your own click on
the mic button and stops when you click it again, send the note or close the box. Your browser asks
for microphone permission the first time. Dictation is not offered on Firefox.

## Where it goes

To `http://127.0.0.1:<port>` (7331 by default) and nowhere else. The extension contains no other
network destination — no telemetry endpoint, no remote code, no update service beyond the browser's
own. (The one other request it makes is the source-map lookup above: to the local page's own dev
server, for files that page already loaded.) The bridge refuses any request carrying a web page's `Origin`, accepts an extension only with the
token in `~/.pinpoint/token`, and only listens on loopback.

**The one place data leaves Pinpoint is the one you asked for:** the coding agent you connect. Over
MCP, or through the Claude Code hooks, your annotations are handed to Claude Code, Cursor, Codex or
whatever client you configured — and from that point their own terms and privacy policies apply.
Pinpoint has no control over what your agent does with what it is given.

The one thing that can leave your machine without going through Pinpoint is **dictation audio**,
which your browser itself sends to its maker's speech service (see *Dictation* above).

**Firefox's data-collection declaration.** On Firefox, Pinpoint declares the `websiteContent` and
`browsingActivity` data-collection permissions, and Firefox shows them in the install prompt.
`websiteContent` covers what you annotate (the element's HTML, its text and a cropped screenshot);
`browsingActivity` covers the URLs of failed requests and of recorded steps. Both leave the add-on
only for the Pinpoint bridge you run on your own machine at 127.0.0.1, and from there the coding
agent you connect. Mozilla counts data handled outside the add-on or the browser as transmitted, so
we declare it, even though none of it is ever sent to us or to any third party by Pinpoint.

## What is stored, and for how long

- `~/.pinpoint/annotations.json` (or `$PINPOINT_HOME`) — the annotations, with screenshots
  base64-encoded inline rather than as loose image files. Resolved annotations are pruned past 200
  (`PINPOINT_MAX_RESOLVED`); pending ones stay until you resolve or clear them. After crops are kept
  for the newest 20 done notes only.
- `<your project>/.pinpoint/pending.md` — only when the bridge is run with `--project`. It carries
  its own `.gitignore`, so it stays out of your commits.
- `~/.pinpoint/token` — a random secret the bridge checks, so only Pinpoint's extension can talk to it.
- **Browser storage** — settings only: the bridge port, which corner the bar sits in, the sites you
  hid it on, the path shown in the popup, and the bridge token. The only page content is a recording
  in progress, held in session storage for that tab until Done, Esc or the tab closes.
- **Extension memory** — the last minute of failed requests per tab, dropped when the tab closes or
  loads a new page.

`node bridge/cli.js clear` empties the store. Deleting `~/.pinpoint` and removing the extension
leaves nothing behind.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `host_permissions: <all_urls>` | Chrome requires a broad host permission for `tabs.captureVisibleTab`, which takes the screenshot. A narrower permission does not grant that API. It is not used to read or inject into pages beyond the local-development matches below; the only fetches it allows are the source-map lookup's, to a local page's own origin. |
| `activeTab`, `scripting` | Show the bar and the picker on the page you are annotating. |
| `tabs` | Know which tab is being captured, and keep pins in sync across tabs showing the same page. |
| `storage` | The settings listed above. |
| `alarms` | Periodically check whether the bridge is running. |
| `webRequest` | See which requests from your local development pages failed (status and URL only, never bodies or headers), so a note can say so. |
| `nativeMessaging` | Optional. Lets the popup's **Start bridge** button launch this repo's own `cli.js`; it can do nothing else. |

Content scripts are injected automatically only on `localhost`, `127.0.0.1`, `*.localhost`,
`*.local`, `*.test` and `file://` pages. Any other site — including staging and LAN addresses —
requires you to turn Pinpoint on for that tab from the toolbar popup.

## Children

Pinpoint is a developer tool and is not directed at children.

## Questions, and changes to this policy

Open an issue: https://github.com/gowtham012/pinpoint/issues. Changes are made in this file, with the
date at the top; the repository history is the record of what changed and when.
