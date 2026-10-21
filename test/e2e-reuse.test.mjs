// "This element is one of several": the reuse hint, end to end. Run: node --test e2e-reuse.test.mjs
// Same harness as e2e.test.mjs, cut to what these tests need, on ports of its own (P+12, S+12).
import { test as nodeTest, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../bridge/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../bridge/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";

const test = (name, fn) => nodeTest(name, { timeout: 180000 }, fn);
const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../extension");
const CLI = path.resolve(here, "../bridge/cli.js");
const CHROME = process.env.PINPOINT_CHROME || undefined;
const PORT = (Number(process.env.PINPOINT_TEST_PORT) || 7399) + 12, SITE = (Number(process.env.PINPOINT_TEST_SITE) || 8081) + 12;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-reuse-"));
const ENV = { ...process.env, PINPOINT_HOME: HOME, PINPOINT_AFTER_DELAY: "0" };

const site = http.createServer((req, res) => {
  const files = {
    "/": "site/index.html", "/react.development.js": "node_modules/react/umd/react.development.js", "/react-dom.development.js": "node_modules/react-dom/umd/react-dom.development.js",
    "/vue.html": "site/vue.html", "/vue.global.js": "node_modules/vue/dist/vue.global.js", "/reuse.html": "site/reuse.html",
  };
  const f = files[req.url.split("?")[0]];
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" });
  fs.createReadStream(path.join(here, f)).pipe(res);
});

let daemon, ctx;
before(async () => {
  await new Promise((r) => site.listen(SITE, r));
  daemon = spawn("node", [CLI, "--port", String(PORT)], { env: ENV, stdio: "ignore" });
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
  if (daemon && daemon.exitCode === null) { const gone = new Promise((r) => daemon.once("exit", r)); daemon.kill(); await gone; }
  site.close();
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 });
}, { timeout: 60000 });
afterEach(async () => { for (const p of ctx.pages()) await p.close().catch(() => {}); });

// Pinpoint's UI is a closed shadow root; read it from the content script's world over CDP.
async function inShadow(page, fn, arg) {
  const cdp = await page.context().newCDPSession(page);
  const ctxs = [];
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    if (context.auxData?.type === "isolated" && /Pinpoint/.test(context.name) && context.auxData.isDefault === false) ctxs.push(context);
  });
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
  const t0 = Date.now();
  for (;;) {
    const v = await inShadow(page, fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("waitShadow timed out: " + fn.toString().slice(0, 120));
    await new Promise((r) => setTimeout(r, 50));
  }
}
const clearAll = () => fetch(BASE + "/annotations", { method: "DELETE" });
const pending = async () => (await (await fetch(BASE + "/annotations?status=pending")).json()).annotations;

// Open the page, pick `sel`, and return what the popover says about reuse.
async function pick(p, sel) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${SITE}${p}`);
  await page.waitForFunction(() => !!document.querySelector("pinpoint-root"));
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  await page.locator(sel).first().hover();
  await page.locator(sel).first().click();
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");
  const hint = await inShadow(page, () => {
    const r = __pinpointShadow.querySelector(".pop .reuse");
    return { shown: r.style.display !== "none", text: r.querySelector(".rtext").textContent,
             pressed: [...r.querySelectorAll("button")].map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`) };
  });
  return { page, hint };
}
async function send(page, comment) {
  await inShadow(page, (c) => { const t = __pinpointShadow.querySelector("textarea"); t.value = c; __pinpointShadow.querySelector(".send").click(); }, comment);
  await waitShadow(page, () => /Sent/.test(__pinpointShadow.querySelector(".pop .status").textContent) || __pinpointShadow.querySelector(".pop").style.display === "none");
  for (let i = 0; i < 50; i++) { const [a] = await pending(); if (a) return a; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("the note never reached the bridge");
}
async function markdownOf(id) {
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(BASE + "/mcp")));
  const got = await c.callTool({ name: "get_annotation", arguments: { id } });
  await c.close();
  return got.content.find((b) => b.type === "text").text;
}

test("React: a component rendered 3 times shows the hint; choosing 'Everywhere' reaches the agent", async () => {
  await clearAll();
  const { page, hint } = await pick("/", ".card h3");
  assert.equal(hint.shown, true);
  assert.equal(hint.text, "<Card> appears 3 times on this page");
  assert.deepEqual(hint.pressed, ["Just this one:false", "Everywhere (the component):false"], "nothing is chosen for you");
  // Keyboard: focus the option and press Space, like any button.
  // The popover focuses its textarea a tick after opening; wait for that, or it steals focus back.
  await waitShadow(page, () => __pinpointShadow.activeElement?.tagName === "TEXTAREA");
  await inShadow(page, () => __pinpointShadow.querySelector(".pop .reuse .r-all").focus());
  await page.keyboard.press("Space");
  assert.deepEqual((await inShadow(page, () => [...__pinpointShadow.querySelectorAll(".pop .reuse button")].map((b) => b.getAttribute("aria-pressed")))), ["false", "true"]);
  const a = await send(page, "bigger title");
  assert.deepEqual(a.element.reuse, { component: "Card", count: 3, estimate: false, scope: "component" });
  assert.equal(a.source.reuse, undefined, "reuse lives on the element, not in the source hint");
  const md = await markdownOf(a.id);
  assert.match(md, /- Reused: <Card> is rendered 3 times on this page\. Scope: the component/);
});

test("React: a component used once shows no hint, and the note has no reuse", async () => {
  await clearAll();
  const { page, hint } = await pick("/", "#get-started");
  assert.equal(hint.shown, false);
  const a = await send(page, "once");
  assert.equal(a.element.reuse, undefined);
  assert.doesNotMatch(await markdownOf(a.id), /Reused:/);
});

test("Vue: mounted instances of the same component are counted; 'Just this one' is stored", async () => {
  await clearAll();
  const { page, hint } = await pick("/vue.html", ".buy");
  assert.equal(hint.shown, true);
  assert.equal(hint.text, "<PriceCard> appears 2 times on this page");
  await inShadow(page, () => __pinpointShadow.querySelector(".pop .reuse .r-one").click());
  const a = await send(page, "only the pro one");
  assert.deepEqual(a.element.reuse, { component: "PriceCard", count: 2, estimate: false, scope: "instance" });
  assert.match(await markdownOf(a.id), /- Reused: <PriceCard> is rendered 2 times on this page\. Scope: just this instance/);
});

test("plain HTML: four identical cards are an estimate; no choice means 'not specified'", async () => {
  await clearAll();
  const { page, hint } = await pick("/reuse.html", ".card h3");
  assert.equal(hint.shown, true);
  assert.equal(hint.text, "div.card > h3 appears 4 times on this page (estimate)");
  // Choosing and un-choosing leaves it unspecified.
  await inShadow(page, () => { const b = __pinpointShadow.querySelector(".pop .reuse .r-one"); b.click(); b.click(); });
  const a = await send(page, "smaller");
  assert.deepEqual(a.element.reuse, { component: "div.card > h3", count: 4, estimate: true });
  const md = await markdownOf(a.id);
  assert.match(md, /- Reused: div\.card > h3 is rendered 4 times on this page \(an estimate/);
  assert.match(md, /Scope: not specified — .*ask with reply_annotation before editing/);
});

test("plain HTML: an element that exists once shows no hint", async () => {
  const { hint } = await pick("/reuse.html", "#checkout");
  assert.equal(hint.shown, false);
});
