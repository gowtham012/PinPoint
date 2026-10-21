// A production build: a minified component behind a React-shaped fiber with no _debugSource, and
// an esbuild source map next to the bundle. The note's source hint must come from the map.
// Run: node --test e2e-sourcemap.test.mjs   (its own bridge and site, PORT+12 / SITE+12)
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
const PORT = (Number(process.env.PINPOINT_TEST_PORT) || 7399) + 12, SITE = (Number(process.env.PINPOINT_TEST_SITE) || 8081) + 12;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-sourcemap-"));
const DIR = path.join(here, "site/sourcemap");

// /prod.html loads the bundle whose map sits beside it; /cross.html loads the same bundle with its
// map on another origin (notlocal.example, which the browser resolves to this very server — so a
// fetch would succeed and show up in `requests`).
const requests = [];
const site = http.createServer((req, res) => {
  requests.push(`${req.headers.host}${req.url}`);
  const p = req.url.split("?")[0];
  const page = (script) => fs.readFileSync(path.join(DIR, "index.html"), "utf8").replace("SCRIPT", script);
  const bundle = () => fs.readFileSync(path.join(DIR, "app.min.js"), "utf8");
  const send = (type, body) => { res.writeHead(200, { "content-type": type }); res.end(body); };
  if (p === "/prod.html") return send("text/html", page("/sourcemap/app.min.js"));
  if (p === "/cross.html") return send("text/html", page("/sourcemap/cross.min.js"));
  if (p === "/sourcemap/app.min.js") return send("text/javascript", bundle());
  if (p === "/sourcemap/cross.min.js") return send("text/javascript", bundle().replace(/sourceMappingURL=.*/, `sourceMappingURL=http://notlocal.example:${SITE}/sourcemap/app.min.js.map`));
  if (p === "/sourcemap/app.min.js.map") return send("application/json", fs.readFileSync(path.join(DIR, "app.min.js.map")));
  res.writeHead(404); res.end();
});

let daemon, ctx;
before(async () => {
  await new Promise((r) => site.listen(SITE, r));
  daemon = spawn("node", [CLI, "--port", String(PORT)], { env: { ...process.env, PINPOINT_HOME: HOME, PINPOINT_AFTER_DELAY: "0" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  ctx = await chromium.launchPersistentContext("", {
    ...(CHROME ? { executablePath: CHROME } : { channel: "chromium" }), headless: true,
    args: ["--headless=new", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           "--host-resolver-rules=MAP notlocal.example 127.0.0.1"],
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
async function waitShadow(page, fn, timeout = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 50))) {
    if (await inShadow(page, fn).catch(() => false)) return;
  }
  throw new Error("timed out: " + fn.toString().slice(0, 120));
}

async function noteOn(p, comment) {
  await fetch(BASE + "/annotations", { method: "DELETE" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${SITE}${p}`);
  await page.waitForFunction(() => !!document.querySelector("pinpoint-root") && !!document.getElementById("price"));
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  await page.locator("#price").hover();
  await page.locator("#price").click();
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");
  await inShadow(page, (c) => { const t = __pinpointShadow.querySelector("textarea"); t.value = c; t.focus(); __pinpointShadow.querySelector(".send").click(); }, comment);
  await waitShadow(page, () => /Sent|offline|Failed/.test(__pinpointShadow.querySelector(".pop .status").textContent));
  assert.match(await inShadow(page, () => __pinpointShadow.querySelector(".pop .status").textContent), /Sent/);
  const { annotations: [a] } = await (await fetch(BASE + "/annotations?status=pending")).json();
  await page.close();
  return a;
}

test("a minified production component is traced through the source map to its original file:line", async () => {
  const a = await noteOn("/prod.html", "bigger price");
  assert.equal(a.comment, "bigger price");
  assert.equal(a.source.framework, "react");
  assert.equal(a.source.file, "src/components/PriceTag.js");
  assert.equal(a.source.line, 9);
  assert.equal(a.source.method, "sourcemap");
  assert.equal(a.source.components[0], "PriceTag", "the minified name is replaced by the original from names[]");
  assert.match(toMarkdown(a), /Source file: src\/components\/PriceTag\.js:9 \(found through the page's source map\)/);
});

test("a source map on another origin is never fetched, and the note has no source file", async () => {
  requests.length = 0;
  const a = await noteOn("/cross.html", "cross origin");
  assert.equal(a.source.framework, "react");
  assert.equal(a.source.file, null);
  assert.equal(a.source.method, undefined);
  assert.deepEqual(requests.filter((r) => r.startsWith("notlocal.example")), [], "the third-party map was requested");
  assert.ok(requests.some((r) => r.endsWith("/sourcemap/cross.min.js")), "the page itself did load the bundle");
});
