# Launch drafts

Drafts only. Nothing here has been posted anywhere; each one is for you to post by hand.

Links to use everywhere:

- Site: https://gowtham012.github.io/PinPoint/
- Repo: https://github.com/gowtham012/PinPoint
- npm: https://www.npmjs.com/package/pinpoint-bridge
- Demo video: `docs/demo.mp4` (upload it to YouTube for the store listings; title and description below)

Before posting: the install commands below still work from a clean machine, every store link in the
README opens, PRIVACY.md matches the build you are pointing people at, and the issue tracker has a
couple of labels (`bug`, `browser`, `agent`) so first reports land somewhere.

---

## Product Hunt

**Name:** Pinpoint

**Tagline** (44 chars): Point at your app; your coding agent gets it

**Description** (≤ 260 chars):

> Click an element on your local dev site, say what should change, and Claude Code, Cursor or Codex
> gets it with the selector, styles, component chain, source hint and a crop. The agent can ask back
> and reply on the page. Open source, runs locally.

**Topics:** Developer Tools, Artificial Intelligence, Chrome Extensions, Open Source, Design Tools

**Gallery** (1270×760, in this order):

1. The demo video (`docs/demo.mp4`), or its YouTube upload.
2. The picker on a button with the comment popover open (`docs/images/popover.png`, on an ink frame).
3. What the agent receives: the note as `get_pending_annotations` returns it, next to the crop.
4. The agent asking back: the "asks" toast and the answer box in the notes panel.
5. The done card with Accept / Not quite, and the Before / After thumbnails in the panel.
6. The iOS Simulator and Android emulator pickers side by side (`docs/images/ios-pin.png`, `docs/images/android-pick.png`).
7. The install: the two commands on an ink background, and "Stays on your machine" underneath.

**Maker's first comment:**

> Hi Product Hunt 👋
>
> I built Pinpoint because most of my time with coding agents went into describing *which* thing I
> meant. "The button under the hero, no, the other one." Screenshots helped a little, but the agent
> still had to guess which element in the code the pixels came from.
>
> With Pinpoint you press ⌥⇧A on your local dev site, click the element and type what should change.
> Your agent (Claude Code, Cursor, Codex, anything that speaks MCP) gets your words plus the selector,
> DOM path, computed styles, the React/Vue component chain, a source-file hint and a crop. If the
> request is ambiguous it asks back, and you answer on the page. When it is done you see its reply,
> a before/after crop, and Accept or Not quite.
>
> It also works on the iOS Simulator and the Android emulator, and it can record the steps of a bug.
>
> Everything runs on your machine: a small bridge on 127.0.0.1 and a browser extension. No account,
> no analytics. MIT licensed.
>
> I would love to hear where it gets in your way, which agent or framework you want it to know
> better, and what a note should carry that it does not yet.

---

## Show HN

**Title:** Show HN: Pinpoint – Click an element in your dev site, your coding agent gets it

**URL:** https://github.com/gowtham012/PinPoint

**Text:**

> I kept losing time telling coding agents which element I meant. A screenshot shows the pixels but
> not the code behind them, so the agent greps for a class name and edits the wrong button about a
> third of the time.
>
> Pinpoint is a browser extension plus a small local bridge. On your local dev site you press
> Alt+Shift+A, click an element (or drag a box around several) and type what should change. The note
> goes to the bridge on 127.0.0.1 with the selector, DOM path, computed styles, the React/Vue
> component chain, a source-file hint, a crop, and any uncaught errors or failed requests from the
> minute before. Your agent picks it up over MCP or a Claude Code hook. It can ask a question back,
> which shows up on the page; when it resolves the note, its reply and a before/after crop appear,
> with Accept or Not quite.
>
> The same picker works on the iOS Simulator (through the accessibility tree) and the Android
> emulator (adb, uiautomator).
>
> All of it is open source under MIT: the extension (Chrome, Edge, Firefox, Safari), the bridge
> and MCP server (`npx -y pinpoint-bridge`), and the test suite that drives the real extension in
> headless Chromium. Nothing leaves your machine except to the agent you connect, and the extension
> needs a token only the bridge has.
>
> Feedback I would like: does the note carry the right things for your stack (only React and Vue get
> a component chain today), is setup clear on Windows and Linux, and where the
> agent's question/answer loop feels clumsy.

---

## X / Twitter thread

1. Coding agents are good at changing UI. They are bad at knowing *which* UI you meant.
   Pinpoint: click the element on your dev site, say what should change, your agent gets it. 🧵
   [demo video]

2. Each note carries the selector, DOM path, computed styles, the React/Vue component chain, a
   source-file hint and a crop. Plus page errors and failed requests from the minute before.

3. It's a conversation. The agent can ask back ("bigger, or a stronger colour?") and you answer on
   the page. When it's done: its reply, a before/after crop, Accept or Not quite.

4. Works with Claude Code, Cursor, Codex and any MCP client. Chrome, Edge, Firefox, Safari. Also the
   iOS Simulator and the Android emulator.

5. Runs on your machine (bridge on 127.0.0.1), MIT licensed.
   git clone https://github.com/gowtham012/PinPoint pinpoint && node pinpoint/bridge/cli.js setup
   https://gowtham012.github.io/PinPoint/

---

## LinkedIn

> Most of the time I spend with coding agents on UI work isn't spent on the change. It goes on
> explaining which element I mean.
>
> So I built Pinpoint, an open-source browser extension and local MCP server. You click an element
> on your local dev site and type what should change. Claude Code, Cursor or Codex receives your
> words together with the selector, computed styles, the component it belongs to, a source-file hint
> and a cropped screenshot.
>
> The agent can ask a clarifying question, which appears right on the page. When it's finished you
> see what it changed, with before and after crops, and you can accept it or send it back.
>
> It also works on the iOS Simulator and the Android emulator, and everything stays on your machine.
>
> https://gowtham012.github.io/PinPoint/
>
> I'd value feedback from anyone doing front-end work with AI agents, especially on frameworks other
> than React and Vue.

---

## YouTube (for the store listings)

**Title:** Pinpoint: point at your app, your coding agent gets it (45-second demo)

**Description:**

> Click an element on your local dev site, say what should change, and your coding agent (Claude
> Code, Cursor, Codex) gets it with the selector, styles, component chain, source hint and a crop.
> In this recording: pick a button, write a note, the agent asks a question, the answer goes back,
> the agent makes the change, and the before/after crops appear.
>
> Open source: https://github.com/gowtham012/PinPoint
> Site: https://gowtham012.github.io/PinPoint/
