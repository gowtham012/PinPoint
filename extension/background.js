// Pinpoint background service worker.
// Responsibilities: crop screenshots (kept in memory, never written to disk), talk to the local
// bridge, keep the toolbar badge in sync, and long-poll the bridge for changes so pins added or
// resolved anywhere show up in every open tab without a reload.

// Safari and Firefox expose the promise-based extension API as `browser`; Chrome only has
// `chrome`. Prefer `browser` where it exists so every `await chrome.…` below works on all three.
// Not named `chrome`: at the top level of a classic script that redeclares the global, and some
// Chrome builds refuse it ("Identifier 'chrome' has already been declared"), which kills the worker.
const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_PORT = 7331;
const WATCH_ALARM = "pinpoint-watch";
const NATIVE_HOST = "com.pinpoint.bridge";

// Pinpoint is a tool for the app you are building, not a thing that follows you around the web.
// It runs on local development pages only; anywhere else you have to turn it on deliberately,
// per tab, from the toolbar.
function isLocalDev(url) {
  if (!url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "file:") return true;
  if (!/^https?:$/.test(u.protocol)) return false;      // chrome://, devtools://, about:, extensions
  const h = u.hostname;
  return h === "localhost" || h.endsWith(".localhost") ||
    h === "0.0.0.0" || h === "[::1]" || h === "::1" ||
    /^127\./.test(h) ||                                  // the whole loopback range
    /^10\./.test(h) ||                                   // private LAN, for testing on a phone
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local") || h.endsWith(".test") || h.endsWith(".localhost");
}

const isBrowserPage = (url) => /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|moz-extension|safari-web-extension|favorites):/.test(url || "");

async function whyNot(url) {
  if (!url) return "Open a page first.";
  if (isBrowserPage(url)) {
    return "Browsers don't let extensions run on browser pages like this one.";
  }
  // Chrome keeps file:// access off per-extension, and off is the default. Without it we are never
  // injected into a file:// page at all — so name the switch instead of claiming the page is fine.
  // api.extension.isAllowedFileSchemeAccess is Chrome-only — Safari has no api.extension
  // and Firefox no equivalent, so ask only where the question can be answered.
  const fileAccess = api.extension?.isAllowedFileSchemeAccess;
  if (url.startsWith("file:") && fileAccess && !(await fileAccess.call(api.extension))) {
    return 'Turn on "Allow access to file URLs" for Pinpoint on chrome://extensions, then reload this page.';
  }
  return "Pinpoint runs on local development pages — localhost, 127.0.0.1, a .local/.test host, or a file:// page.";
}

async function getPort() {
  const { port } = await api.storage.sync.get({ port: DEFAULT_PORT });
  return port;
}

// ---------- the bridge token ----------
// Any installed extension can call 127.0.0.1, so the bridge wants proof that this one is ours: a
// token it keeps in ~/.pinpoint/token. Chrome hands it over through the native host (which only this
// extension's id may reach); Safari and Firefox users paste it into the popup once (`cli.js token`).
let tokenCache = null;
async function getToken({ refresh = false } = {}) {
  if (!refresh && tokenCache) return tokenCache;
  if (!refresh) {
    const { token } = await api.storage.local.get({ token: null });
    if (token) return (tokenCache = token);
  }
  if (typeof api.runtime.sendNativeMessage === "function") {
    try {
      const r = await api.runtime.sendNativeMessage(NATIVE_HOST, { cmd: "token" });
      if (r?.ok === true && typeof r.token === "string") {
        tokenCache = r.token;
        await api.storage.local.set({ token: r.token });
        return r.token;
      }
    } catch {}
  }
  return null;
}
async function setToken(t) {
  tokenCache = t || null;
  if (t) await api.storage.local.set({ token: t });
  else await api.storage.local.remove("token");
}

async function bridgeFetch(path, init = {}, retried = false) {
  const token = await getToken();
  const headers = { ...(init.headers || {}), ...(token ? { "x-pinpoint-token": token } : {}) };
  const res = await fetch(`http://127.0.0.1:${await getPort()}${path}`, { ...init, headers });
  if (res.status === 401 && !retried) {
    // The bridge has a different token now (a new PINPOINT_HOME, a deleted file): ask once more.
    const fresh = await getToken({ refresh: true });
    if (fresh && fresh !== token) return bridgeFetch(path, init, true);
  }
  if (!res.ok) {
    const e = new Error(res.status === 401 ? "the bridge is running but wants its token — open the Pinpoint popup" : `Bridge ${res.status} ${res.statusText}`);
    if (res.status === 401) e.code = "token";
    throw e;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// ---------- finding the bridge on another port ----------
// `--port 7332` in a terminal and 7331 in the popup is the commonest "it's not working". When the
// saved port does not answer, look at its neighbours for the bridge and move there if there is
// exactly one — several means several projects, and that is the developer's choice, not ours. Only
// when the saved port is itself in that range: a deliberate custom port is left alone.
const SCAN = Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + i);
let lastScan = 0;
async function findBridges(except) {
  const probe = async (port) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 400);
    try {
      const h = await (await fetch(`http://127.0.0.1:${port}/health`, { signal: ctl.signal })).json();
      return h?.service === "pinpoint-bridge" ? { port, project: h.project || null } : null;
    } catch { return null; } finally { clearTimeout(t); }
  };
  return (await Promise.all(SCAN.filter((p) => p !== except).map(probe))).filter(Boolean);
}
async function discoverPort() {
  const current = await getPort();
  if (!SCAN.includes(current) || Date.now() - lastScan < 5000) return null;
  lastScan = Date.now();
  const found = await findBridges(current);
  if (found.length === 1) await api.storage.sync.set({ port: found[0].port });
  return found;
}

// Any server can sit on 7331; only ours answers with this marker. Without the check the popup
// would show a green dot for an unrelated dev server and every send would fail.
async function health() {
  let h = await bridgeFetch("/health");
  if (!h || h.service !== "pinpoint-bridge") throw new Error("Another server is on this port");
  if (h.tokenOk === false) {
    if (await getToken({ refresh: true })) h = await bridgeFetch("/health");
    if (h.tokenOk === false) {
      const e = new Error("The bridge is running, but this browser needs its token");
      e.code = "token";
      throw e;
    }
  }
  return h;
}

async function updateBadge(count) {
  try {
    await api.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    await api.action.setBadgeBackgroundColor({ color: "#c6f432" });
    await api.action.setBadgeTextColor?.({ color: "#121212" });
  } catch {}
}

async function refreshBadge() {
  try {
    const { annotations } = await bridgeFetch("/annotations?status=pending");
    await updateBadge(annotations.length);
    return annotations;
  } catch {
    await updateBadge(0);
    return null;
  }
}

// Tell every tab (and every frame in it) to re-read its pins from the bridge.
async function broadcastReload() {
  // Every tab: one we were opted into by hand needs this as much as a localhost one, and a tab with
  // no content script simply refuses the message.
  const tabs = await api.tabs.query({});
  await Promise.all(tabs.map((t) => t.id && api.tabs.sendMessage(t.id, { type: "reloadPins" }).catch(() => {})));
}

// ---------- change watcher ----------
// A pending fetch keeps the service worker alive; the alarm restarts the loop if Chrome
// still evicts us (or if the bridge was down and has come back).
let watching = false;
async function watch() {
  if (watching) return;
  watching = true;
  try {
    let since = (await api.storage.session.get({ storeVersion: 0 })).storeVersion;
    let first = true;
    for (;;) {
      let res;
      try {
        res = await bridgeFetch(`/events?since=${since}&timeout=25000`);
      } catch {
        await updateBadge(0);
        return; // bridge down: the alarm will try again shortly
      }
      // Something that is not our bridge answers instantly with no version, which turned this loop
      // into a busy spin against it. Only our /events has a numeric version.
      if (typeof res?.version !== "number") { await updateBadge(0); return; }
      if (first) { first = false; broadcastReload(); }   // tell open tabs the bridge is up
      if (res.rechecks?.length) for (const r of res.rechecks) answerRecheck(r);
      if (res.version !== since) {
        since = res.version;
        await api.storage.session.set({ storeVersion: since });
        await refreshBadge();
        await broadcastReload();
      }
    }
  } finally {
    watching = false;
  }
}

api.alarms.create(WATCH_ALARM, { periodInMinutes: 0.5 });
api.alarms.onAlarm.addListener((a) => a.name === WATCH_ALARM && watch());
api.runtime.onStartup.addListener(() => { refreshBadge(); watch(); });
api.runtime.onInstalled.addListener(() => { refreshBadge(); watch(); });
watch();

// Crop the visible tab to `rect` (CSS px, top-document viewport coordinates) at ratio `dpr`.
async function captureElement(windowId, rect, dpr, pad = 8) {
  const dataUrl = await api.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const sx = Math.max(0, Math.floor((rect.x - pad) * dpr));
  const sy = Math.max(0, Math.floor((rect.y - pad) * dpr));
  const sw = Math.min(bitmap.width - sx, Math.ceil((rect.width + pad * 2) * dpr));
  const sh = Math.min(bitmap.height - sy, Math.ceil((rect.height + pad * 2) * dpr));
  if (sw <= 0 || sh <= 0) { bitmap.close(); return null; }

  const scale = Math.min(1, 1200 / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), width: canvas.width, height: canvas.height };
}

// Chrome rate-limits captureVisibleTab (a couple of calls a second) and simply throws past that,
// so captures are serialised with a small gap and retried once. Annotating three things quickly
// must not cost you three screenshots.
let captureChain = Promise.resolve();
let lastCaptureAt = 0;
const MIN_GAP_MS = 650;

function queueCapture(fn) {
  const run = captureChain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCaptureAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastCaptureAt = Date.now(); }
  });
  captureChain = run.catch(() => {});
  return run;
}

// A queued capture must never photograph a different page: if the tab has navigated, been closed,
// or is no longer the visible one, we skip the picture rather than attach a misleading one.
async function tabState(tab, expectedUrl) {
  try {
    const t = await api.tabs.get(tab.id);
    if (!t) return "gone";
    if ((t.url || "").split("#")[0] !== (expectedUrl || "").split("#")[0]) return "navigated";
    return t.active ? "ready" : "hidden";
  } catch {
    return "gone";
  }
}

// captureVisibleTab photographs whichever tab is visible, so we can only shoot while ours is.
// Switching to your editor the moment you hit Send is the most natural thing in the world, so
// wait a few seconds for the tab to come back rather than silently dropping the picture.
async function waitUntilCapturable(tab, expectedUrl, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const state = await tabState(tab, expectedUrl);
    if (state !== "hidden") return state;
    if (Date.now() > deadline) return "hidden";
    await new Promise((r) => setTimeout(r, 200));
  }
}

// capture.rect was measured when it was asked for; the queue may have waited since, and the page may
// have scrolled. Re-derive the rect from document space, which does not move. Returns { rect } or
// { why } when the element is no longer where a picture of it could be taken.
async function rectNow(tab, capture, expectedUrl) {
  if (!capture.doc) return { rect: capture.rect };
  // frameId 0 — the top document. Without it this goes to every frame and an iframe can answer
  // first, reporting its own scroll and its own URL.
  const vp = await api.tabs.sendMessage(tab.id, { type: "viewportNow" }, { frameId: 0 }).catch(() => null);
  if (!vp) return { rect: capture.rect };
  // This round trip is itself a window in which the page can navigate. The content script reports
  // the URL it is actually on, so a navigation during the query is caught rather than widened.
  if (expectedUrl && vp.url && vp.url.split("#")[0] !== expectedUrl.split("#")[0]) return { why: "the page changed before it could be taken" };
  const left = capture.doc.x - vp.x, top = capture.doc.y - vp.y;
  // The visible part only: clamping just the origin kept the full size, so an element half off the
  // top was cropped together with whatever sat below it.
  const w = Math.min(vp.w, left + capture.doc.width) - Math.max(0, left);
  const h = Math.min(vp.h, top + capture.doc.height) - Math.max(0, top);
  if (left > vp.w - 2 || top > vp.h - 2 || left + capture.doc.width < 2 || top + capture.doc.height < 2 || w < 2 || h < 2) {
    return { why: "the page scrolled away from it before the picture could be taken" };
  }
  return { rect: { x: Math.max(0, left), y: Math.max(0, top), width: w, height: h } };
}

async function finishCapture(tab, capture, id, expectedUrl) {
  try {
    let why = null;
    const shot = await queueCapture(async () => {
      const state = await waitUntilCapturable(tab, expectedUrl);
      if (state !== "ready") {
        why = { navigated: "the page changed before it could be taken", gone: "the tab was closed", hidden: "the tab stayed in the background" }[state];
        return null;
      }
      // Give the compositor a frame to paint without our overlay before grabbing the pixels.
      await new Promise((r) => setTimeout(r, 60));
      const where = await rectNow(tab, capture, expectedUrl);
      if (where.why) { why = where.why; return null; }
      const rect = where.rect;
      const win = (await api.tabs.get(tab.id).catch(() => null))?.windowId ?? tab.windowId;
      try {
        return await captureElement(win, rect, capture.dpr);
      } catch {
        await new Promise((r) => setTimeout(r, 700));
        return captureElement(win, rect, capture.dpr);
      }
    });
    // Either way the bridge is told, so nothing silently pretends a picture exists.
    await bridgeFetch(`/annotations/${encodeURIComponent(id)}/screenshot`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(shot || { skipped: why || "the screenshot could not be taken" }),
    });
  } catch (e) {
    console.warn("[pinpoint] screenshot not attached:", e);
  } finally {
    // Let the page show its overlay again (harmless if the tab has already gone).
    api.tabs.sendMessage(tab.id, { type: "captureDone" }).catch(() => {});
  }
}

// ---------- re-checking a pin against the live page ----------
// An agent asked whether an element is still what the developer marked. Only the page can answer,
// so this finds a tab showing it, has the content script re-identify the element, and crops it
// again — reusing the same capture chain as a first screenshot, including its honesty about a tab
// that is not in front.
const answering = new Set();

async function answerRecheck({ reqId, id, url }) {
  if (answering.has(reqId)) return;
  answering.add(reqId);
  const send = (body) => bridgeFetch(`/rechecks/${encodeURIComponent(reqId)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => {});
  try {
    const bits = await annotationBits(id);
    if (!bits.selector) return void (await send({ status: "no_answer", error: "could not read the annotation from the bridge" }));
    // An element inside an iframe has the frame's url; the tab shows the top page's.
    const tabUrl = (bits.topUrl || url).split("#")[0];
    const tabs = (await api.tabs.query({})).filter((t) => (t.url || "").split("#")[0] === tabUrl);
    if (!tabs.length) return void (await send({ status: "no_tab" }));
    // Prefer a tab that is in front: only a visible tab can be photographed.
    const tab = tabs.find((t) => t.active) || tabs[0];

    const { topUrl, frameId, ...ask } = bits;
    const askFrame = (f) => api.tabs.sendMessage(tab.id, { type: "recheck", ...ask }, { frameId: f }).catch(() => null);
    // Frame ids do not survive a reload; if that frame is gone, the top document is the best guess.
    const found = (frameId ? await askFrame(frameId) : null) || await askFrame(0);
    if (!found) return void (await send({ status: "no_answer" }));
    if (!found.found) return void (await send({ status: "ok", element: null, url: found.url }));

    let screenshot = null, screenshotSkipped = null;
    if (found.capture) {
      await api.tabs.sendMessage(tab.id, { type: "hideForCapture" }).catch(() => {});
      try {
        const shot = await queueCapture(async () => {
          const state = await waitUntilCapturable(tab, tab.url, 2000);
          if (state !== "ready") return { skipped: { navigated: "the page changed", gone: "the tab was closed", hidden: "the tab was not in front" }[state] };
          await new Promise((r) => setTimeout(r, 60));
          const where = await rectNow(tab, found.capture, tab.url);
          if (where.why) return { skipped: where.why };
          const win = (await api.tabs.get(tab.id).catch(() => null))?.windowId ?? tab.windowId;
          return { shot: await captureElement(win, where.rect, found.capture.dpr) };
        });
        screenshot = shot.shot || null;
        screenshotSkipped = shot.skipped || null;
      } catch (e) {
        screenshotSkipped = "the picture could not be taken";
      }
      api.tabs.sendMessage(tab.id, { type: "captureDone" }).catch(() => {});
    } else {
      screenshotSkipped = "the element is not visible on screen";
    }
    await send({ status: "ok", element: found.element, selectorStillMatches: found.selectorStillMatches, url: found.url, screenshot, screenshotSkipped });
  } catch (e) {
    await send({ status: "no_answer", error: String(e.message || e) });
  } finally {
    answering.delete(reqId);
  }
}

// The page needs the selector and identity card to look with; ask the bridge for them rather than
// carrying a copy of the annotation around.
async function annotationBits(id) {
  try {
    const { annotation } = await bridgeFetch(`/annotations/${encodeURIComponent(id)}`);
    return {
      selector: annotation.element.selector, fingerprint: annotation.element.fingerprint, region: annotation.region || null,
      topUrl: annotation.page.topUrl || null, frameId: annotation.page.frameId || 0,
    };
  } catch {
    return {};
  }
}

// ---------- starting and restarting the bridge ----------
// A content script cannot reach native messaging — only this worker, the popup and other extension
// pages can. Never add a api.runtime.onMessageExternal handler: without one, other installed
// extensions cannot reach these cases either, and that is the whole containment.
//
// The port is read from storage here and NEVER taken from the message, so the most a compromised
// page could ask for is "start the bridge on the port I already configured in the popup".
function hostError(e) {
  const m = String(e?.message || e || "");
  if (/not found|not installed|Access to the specified native messaging host is forbidden/i.test(m)) return "no_host";
  if (/exited|Error when communicating/i.test(m)) return "no_node";
  return "no_host"; // an unrecognised failure here is almost always "run the installer"
}

async function startBridge() {
  if (typeof api.runtime.sendNativeMessage !== "function") {
    return { ok: false, code: "unsupported", error: "This browser cannot start the bridge for you — start it in a terminal." };
  }
  const port = await getPort();
  let r;
  try {
    r = await api.runtime.sendNativeMessage(NATIVE_HOST, { cmd: "start", port });
  } catch (e) {
    return { ok: false, code: hostError(e), error: String(e.message || e) };
  }
  // Safari has sendNativeMessage, but it reaches the containing app's handler, not our Node host — and
  // that answers with something that is not our reply at all. Say what to do instead of a vague failure.
  if (r && typeof r.ok !== "boolean") {
    return { ok: false, code: "unsupported", error: "This browser can't start the bridge for you — run `node <pinpoint>/bridge/cli.js start` in a terminal." };
  }
  if (r?.ok) { refreshBadge(); watch(); broadcastReload(); }
  return r || { ok: false, code: "no_host", error: "no reply from the launcher" };
}

// Restart is plain HTTP to the daemon, not native messaging: it needs no launcher, works in every
// browser, and never gives anything reachable from a page the authority to kill a process.
async function restartBridge() {
  await bridgeFetch("/restart", { method: "POST" });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const h = await health();
      refreshBadge(); watch(); broadcastReload();
      return { ok: true, ...h };
    } catch {}
  }
  return { ok: false, error: "the bridge did not come back — start it in a terminal to see why" };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "capture": {
        const windowId = sender.tab ? sender.tab.windowId : api.windows.WINDOW_ID_CURRENT;
        return captureElement(windowId, msg.rect, msg.dpr);
      }
      // Two-phase send: the comment is stored first so nothing is lost if the page navigates
      // while the screenshot is being taken.
      case "submit": {
        if (sender.tab) msg.annotation.page = { ...msg.annotation.page, topUrl: sender.tab.url || null, frameId: sender.frameId || 0 };
        const result = await bridgeFetch("/annotations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.annotation),
        });
        refreshBadge();
        // The crop is taken and attached HERE, in the worker, after we have already answered.
        // The page can navigate or reload the instant it sees "Sent ✓" and both the comment and
        // its screenshot still arrive.
        if (msg.capture && sender.tab) {
          // Compare against the TAB's url, not the annotation's — an element inside an iframe
          // has the frame's url but is captured from the top-level tab.
          setTimeout(() => finishCapture(sender.tab, msg.capture, result.id, sender.tab.url), 0);
        }
        return result;
      }
      // A pin telling us the page has moved underneath it. Fire and forget: the bridge stores it
      // without bumping its version, so this can never turn into a reload loop.
      case "elementState": {
        try {
          await bridgeFetch(`/annotations/${encodeURIComponent(msg.id)}/element-state`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: msg.state, url: msg.url, at: new Date().toISOString() }),
          });
        } catch {}
        return { ok: true };
      }
      case "attachScreenshot": {
        return bridgeFetch(`/annotations/${encodeURIComponent(msg.id)}/screenshot`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.screenshot),
        });
      }
      case "list": {
        const status = ["resolved", "open"].includes(msg.status) ? msg.status : "pending";
        const q = msg.url ? `?status=${status}&url=${encodeURIComponent(msg.url)}` : `?status=${status}`;
        return bridgeFetch(`/annotations${q}`);
      }
      case "delete": {
        const r = await bridgeFetch(`/annotations/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
        refreshBadge();
        return r;
      }
      // You answering the agent, or reopening a finished note with a follow-up.
      case "answer": {
        return bridgeFetch(`/annotations/${encodeURIComponent(msg.id)}/answer`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: String(msg.text || "") }),
        });
      }
      case "sendDrafts": {
        const r = await bridgeFetch("/annotations/send-drafts", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: msg.url || null }),
        });
        refreshBadge();
        return r;
      }
      case "clear": {
        const r = await bridgeFetch("/annotations", { method: "DELETE" });
        refreshBadge();
        return r;
      }
      case "health": {
        try {
          const h = await health();
          watch();
          return { ok: true, ...h };
        } catch (e) {
          // Nothing answered at all (not "wrong server", not "needs token"): the bridge may simply be
          // on a neighbouring port.
          if (!e.code && !/Another server/.test(e.message || "")) {
            const found = await discoverPort();
            if (found?.length === 1) {
              try { const h = await health(); watch(); return { ok: true, movedTo: h.port, ...h }; } catch {}
            }
            if (found?.length > 1) return { ok: false, error: String(e.message || e), code: "several", candidates: found };
          }
          return { ok: false, error: String(e.message || e), code: e.code || null };
        }
      }
      // Only the popup asks this (content scripts have no reason to): the token pasted by hand where
      // there is no native host to fetch it.
      case "setToken": {
        if (sender.tab) return { ok: false, error: "not from a page" };
        await setToken(String(msg.token || "").trim());
        try { return { ok: true, ...(await health()) }; }
        catch (e) { return { ok: false, error: String(e.message || e), code: e.code || null }; }
      }
      case "startBridge":
        return startBridge();
      case "restartBridge":
        return restartBridge();
      case "refreshBadge":
        return refreshBadge();
      // A content script that handled the shortcut itself asks us to mirror it into sibling frames.
      case "mirrorPicking": {
        if (sender.tab?.id) {
          api.tabs.sendMessage(sender.tab.id, { type: "setPicking", picking: msg.picking, from: sender.frameId ?? 0 }).catch(() => {});
        }
        return { ok: true };
      }
      case "pick": {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "No active tab." };
        return togglePicker(tab, true);
      }
      case "canRun": {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        const reason = await whyNot(tab?.url);
        const code = isBrowserPage(tab?.url) ? "browser_page" : /Allow access to file URLs/.test(reason) ? "file_access" : null;
        // A file:// page without file access is "local" but unreachable: say so, with the switch.
        return { url: tab?.url || null, local: isLocalDev(tab?.url) && code !== "file_access", reason, code };
      }
      default:
        return { error: `unknown message ${msg.type}` };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e.message || e) }));
  return true; // async response
});

// The keyboard command and the popup button both go to every frame, so elements inside
// iframes can be picked too.
async function togglePicker(tab, force) {
  const msg = { type: force ? "startPicker" : "togglePicker" };
  try {
    await api.tabs.sendMessage(tab.id, msg);
    return { ok: true };
  } catch {}
  // Not injected yet — either the page pre-dates the extension, or the user is opting in on a
  // page outside the local-dev list (the toolbar click grants us this one tab).
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["inspector.js"], world: "MAIN" });
    await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    await api.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ["content.css"] });
    await api.tabs.sendMessage(tab.id, msg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: await whyNot(tab.url) };
  }
}

api.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-picker") return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) togglePicker(tab, false).catch(() => {});
});
