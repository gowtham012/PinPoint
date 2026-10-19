// What the recording scripts share: the demo site, a bridge of their own, the real extension in
// Chromium, and a way into Pinpoint's closed shadow root — the same one test/e2e.test.mjs uses.
//
// Nothing here is shown as Pinpoint's UI. The caption bar and the cursor are ours, drawn in the page,
// so a recording never passes our overlay off as the product.
import { chromium } from "../test/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const EXT = path.join(REPO, "extension");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- demo/ over http ----------
export function serveDemo(port) {
  const root = path.join(REPO, "demo");
  const site = http.createServer((req, res) => {
    const f = path.join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "text/plain" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => site.listen(port, () => r(site)));
}

// ---------- a bridge of our own ----------
// Its own PINPOINT_HOME, so a recording never posts into the bridge you actually use, and its
// token is the one handed to the extension below.
export async function startBridge(port, home, env = {}) {
  const base = `http://127.0.0.1:${port}`;
  const alive = async () => { try { return (await (await fetch(base + "/health")).json()).service === "pinpoint-bridge"; } catch { return false; } };
  if (await alive()) throw new Error(`something is already answering on ${port}; pick another port`);
  const proc = spawn("node", [path.join(REPO, "bridge", "cli.js"), "--port", String(port), "--quiet"],
    { env: { ...process.env, PINPOINT_HOME: home, ...env }, stdio: "ignore" });
  for (let i = 0; i < 80 && !(await alive()); i++) await sleep(100);
  if (!(await alive())) throw new Error("the bridge did not start");
  return { base, proc, token: fs.readFileSync(path.join(home, "token"), "utf8").trim() };
}

// ---------- the real extension ----------
export async function launch({ port, token, ...opts }) {
  const ctx = await chromium.launchPersistentContext("", {
    // channel "chromium": the headless shell Playwright picks otherwise cannot load extensions.
    channel: "chromium", headless: true,
    args: ["--headless=new", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    ...opts,
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  // Point it at THIS bridge, with the token a real install gets from the native host. Without the
  // port it keeps its stored default (7331); without the token every call is a 401.
  for (let i = 0; i < 40; i++) {
    try { await sw.evaluate(async ({ port, token }) => { await chrome.storage.sync.set({ port }); await chrome.storage.local.set({ token }); }, { port, token }); break; }
    catch { await sleep(150); }
  }
  return ctx;
}

// ---------- Pinpoint's world ----------
// The UI is in a CLOSED shadow root: page.evaluate runs as the page and cannot reach it. The content
// script leaves __pinpointShadow in its isolated world, which we find over CDP.
const worlds = new WeakMap();
async function worldOf(page) {
  let w = worlds.get(page);
  if (w) return w;
  const cdp = await page.context().newCDPSession(page);
  const ctxs = new Map();
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    if (context.auxData?.type === "isolated" && /Pinpoint/.test(context.name)) ctxs.set(context.id, context);
  });
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => ctxs.delete(executionContextId));
  cdp.on("Runtime.executionContextsCleared", () => ctxs.clear());
  await cdp.send("Runtime.enable");
  w = { cdp, ctxs };
  worlds.set(page, w);
  return w;
}
// Like page.evaluate(fn, arg), in Pinpoint's world of the top frame.
export async function inShadow(page, fn, arg) {
  const w = await worldOf(page);
  const decl = `async function (a) {
    for (let i = 0; i < 60 && !globalThis.__pinpointShadow; i++) await new Promise((r) => setTimeout(r, 50));
    return (${fn.toString()})(a);
  }`;
  for (let i = 0; ; i++) {
    const { frameTree } = await w.cdp.send("Page.getFrameTree");
    const ctx = [...w.ctxs.values()].reverse().find((c) => c.auxData.frameId === frameTree.frame.id);
    if (ctx) {
      const r = await w.cdp.send("Runtime.callFunctionOn", {
        functionDeclaration: decl, executionContextId: ctx.id,
        arguments: [{ value: arg === undefined ? null : arg }], returnByValue: true, awaitPromise: true,
      }).catch((e) => ({ gone: String(e.message || e) }));
      if (r.gone) { if (i < 40) { await sleep(100); continue; } throw new Error(r.gone); }
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    }
    if (i > 60) throw new Error("Pinpoint's content script is not running in this page");
    await sleep(100);
  }
}
// Like page.waitForFunction(fn, arg, { timeout }), in Pinpoint's world.
export async function waitShadow(page, fn, arg, { timeout = 15000 } = {}) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    try { const v = await inShadow(page, fn, arg); if (v) return v; } catch (e) { last = e; }
    if (Date.now() - t0 > timeout) throw new Error(`waitShadow timed out after ${timeout}ms: ${fn.toString().slice(0, 140)}${last ? " — " + last.message : ""}`);
    await sleep(50);
  }
}
// Where a control in the shadow root sits once it has stopped moving (cards slide in).
export const shadowPoint = (page, sel) => inShadow(page, async (s) => {
  const at = () => { const r = __pinpointShadow.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; };
  let prev = at();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const now = at();
    if (now.w > 0 && now.x === prev.x && now.y === prev.y) return now;
    prev = now;
  }
  return prev;
}, sel);

// ---------- our overlay: a caption bar ----------
// `top`: a pill under the page's header instead of a bar along the bottom.
export const caption = (page, text, tone = "", top = false) =>
  page.evaluate(([t, tone, top]) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483646;padding:14px 20px;pointer-events:none;" +
        "font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#14181f;color:#e8eaee";
      document.documentElement.appendChild(el);
      if (top) el.style.cssText += ";left:50%;right:auto;bottom:auto;top:78px;transform:translateX(-50%);border-radius:999px;padding:10px 22px;white-space:nowrap;box-shadow:0 10px 30px rgba(0,0,0,.25)";
    }
    el.style.display = t ? "block" : "none";
    el.style.color = tone === "good" ? "#7ee2a8" : tone === "bad" ? "#ffb4ab" : "#e8eaee";
    el.textContent = t;
  }, [text, tone, top]);
