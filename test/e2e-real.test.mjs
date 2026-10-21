// Real production builds, not hand-made fiber shapes: Vite + React 18 and Vite + Vue 3.5, minified,
// no dev hooks, a source map beside each bundle (test/site/real, from test/fixtures/real/build.sh).
// The reuse hint and the source-map fallback must both come out with the original names and files.
// Run: node --test e2e-real.test.mjs   (its own bridge and site, PORT+13 / SITE+13)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMarkdown } from "../bridge/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../extension");
const CLI = path.resolve(here, "../bridge/cli.js");
const CHROME = process.env.PINPOINT_CHROME || undefined;
const PORT = (Number(process.env.PINPOINT_TEST_PORT) || 7399) + 13, SITE = (Number(process.env.PINPOINT_TEST_SITE) || 8081) + 13;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-real-"));
const DIR = path.join(here, "site/real");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };

const site = http.createServer((req, res) => {
  const p = path.join(DIR, path.normalize(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(DIR) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  res.end(fs.readFileSync(p));
});

let daemon, ctx;
before(async () => {
  await new Promise((r) => site.listen(SITE, r));
  daemon = spawn("node", [CLI, "--port", String(PORT)], { env: { ...process.env, PINPOINT_HOME: HOME, PINPOINT_AFTER_DELAY: "0" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  ctx = await chromium.launchPersistentContext("", {
    ...(CHROME ? { executablePath: CHROME } : { channel: "chromium" }), headless: true,
    args: ["--headless=new", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 800 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const token = fs.readFileSync(path.join(HOME, "token"), "utf8").trim();
  for (let i = 0; i < 40; i++) {
    try { await sw.evaluate(async ({ port, token }) => { await chrome.storage.sync.set({ port }); await chrome.storage.local.set({ token }); }, { port: PORT, token }); break; }
    catch { await new Promise((r) => setTimeout(r, 150)); }
  }
});
after(async () => {
  await ctx?.close();
  daemon?.kill();
  site.close();
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}, { timeout: 60000 });

// Pinpoint's UI is in a closed shadow root, reachable only from the content script's isolated
// world — found over CDP, as in e2e.test.mjs.
async function inShadow(page, fn, arg) {
  const cdp = await page.context().newCDPSession(page);
  const ctxs = [];
  cdp.on("Runtime.executionContextCreated", ({ context }) => { if (context.auxData?.type === "isolated" && /Pinpoint/.test(context.name) && context.auxData.isDefault === false) ctxs.push(context); });
  await cdp.send("Runtime.enable");
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const c = ctxs.reverse().find((x) => x.auxData.frameId === frameTree.frame.id);
  if (!c) throw new Error("Pinpoint's content script is not running");
  const r = await cdp.send("Runtime.callFunctionOn", {
    functionDeclaration: `async function (a) { for (let i = 0; i < 60 && !globalThis.__pinpointShadow; i++) await new Promise((r) => setTimeout(r, 50)); return (${fn.toString()})(a); }`,
    executionContextId: c.id, arguments: [{ value: arg ?? null }], returnByValue: true, awaitPromise: true,
  });
  await cdp.detach();
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitShadow(page, fn, arg, timeout = 15000) {
  let last;
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 50))) {
    if ((last = await inShadow(page, fn, arg).catch((e) => e.message)) === true) return;
  }
  throw new Error(`timed out: ${fn.toString().slice(0, 120)} (last: ${JSON.stringify(last)})`);
}
const popover = () => ({ meta: __pinpointShadow.querySelector(".pop .meta").innerText, reuse: __pinpointShadow.querySelector(".pop .reuse").style.display === "none" ? null : __pinpointShadow.querySelector(".pop .reuse .rtext").textContent });

// Pick the nth `sel` on `app`, wait until the popover shows `want` (the name the map gives back),
// send `comment`, and return the popover as it was and the stored note.
async function note(app, sel, nth, want, comment) {
  await fetch(BASE + "/annotations", { method: "DELETE" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${SITE}/${app}/`);
  await page.waitForFunction((s) => !!document.querySelector("pinpoint-root") && document.querySelectorAll(s).length === 3, sel);
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  const loc = page.locator(sel).nth(nth);
  await loc.hover();
  await loc.click();
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");
  await waitShadow(page, (w) => __pinpointShadow.querySelector(".pop .meta").innerText.includes(`<${w}>`), want);
  const shown = await inShadow(page, popover);
  await inShadow(page, (c) => { const t = __pinpointShadow.querySelector("textarea"); t.value = c; t.focus(); __pinpointShadow.querySelector(".send").click(); }, comment);
  await waitShadow(page, () => /Sent|offline|Failed/.test(__pinpointShadow.querySelector(".pop .status").textContent));
  assert.match(await inShadow(page, () => __pinpointShadow.querySelector(".pop .status").textContent), /Sent/);
  const { annotations: [a] } = await (await fetch(BASE + "/annotations?status=pending")).json();
  await page.close();
  return { shown, a };
}

test("React 18 production: the reuse hint and the note name <ProductCard>, traced to its file", async () => {
  const { shown, a } = await note("react", ".card-title", 1, "ProductCard", "bigger title");
  assert.equal(shown.reuse, "<ProductCard> appears 3 times on this page", "the popover's minified name is repainted");
  assert.equal(a.source.framework, "react");
  assert.equal(a.source.method, "sourcemap");
  assert.equal(a.source.file, "src/components/ProductCard.jsx");
  assert.equal(a.source.components[0], "ProductCard");
  assert.deepEqual(a.element.reuse, { component: "ProductCard", count: 3, estimate: false });
  const md = toMarkdown(a);
  assert.match(md, /Reused: <ProductCard> is rendered 3 times on this page/);
  assert.match(md, /src\/components\/ProductCard\.jsx:\d+ \(found through the page's source map\)/);
});

test("React 18 production: an arrow-function component gets its name from the binding before it", async () => {
  const { shown, a } = await note("react", ".price", 2, "Price", "price in red");
  assert.equal(shown.reuse, "<Price> appears 3 times on this page");
  assert.equal(a.source.file, "src/components/Price.jsx");
  assert.equal(a.source.components[0], "Price");
  assert.equal(a.element.reuse.component, "Price");
});

test("Vue 3 production: no __vueParentComponent, yet <PriceCard> is counted and traced to its .vue file", async () => {
  const { shown, a } = await note("vue", ".card-title", 0, "PriceCard", "bigger title");
  assert.equal(shown.reuse, "<PriceCard> appears 3 times on this page");
  assert.equal(a.source.framework, "vue");
  assert.equal(a.source.method, "sourcemap");
  assert.equal(a.source.file, "src/components/PriceCard.vue");
  assert.equal(a.source.components[0], "PriceCard");
  assert.deepEqual(a.element.reuse, { component: "PriceCard", count: 3, estimate: false });
  assert.match(toMarkdown(a), /Reused: <PriceCard> is rendered 3 times on this page/);
});
