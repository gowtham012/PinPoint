// The store package (Chrome Web Store and Edge Add-ons ship the same zip) loads, and the popup's
// Firefox paths behave. Run: node --test e2e-ship.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.PINPOINT_CHROME || undefined;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pp-e2e-ship-"));
// Windows runners have no `zip`, so there the popup checks run against extension/ itself.
const WIN = process.platform === "win32";
const EXT = WIN ? path.resolve(here, "../extension") : path.join(TMP, "ext");
let ctx, extId;

before(async () => {
  if (!WIN) {
    const zip = path.join(TMP, "cws.zip");
    execFileSync("bash", [path.resolve(here, "../tools/make-cws-zip.sh"), zip], { stdio: "pipe" });
    execFileSync("unzip", ["-q", zip, "-d", EXT]);
  }
  ctx = await chromium.launchPersistentContext("", {
    ...(CHROME ? { executablePath: CHROME } : { channel: "chromium" }), headless: true,
    args: ["--headless=new", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  extId = new URL(sw.url()).host;
});
after(async () => { await ctx?.close(); fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10 }); });

test("the key-stripped store package loads, and Chrome needs no Grant button", async () => {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector("#status");
  // Give the permissions.contains answer a moment to land, then check it kept the button hidden.
  await popup.waitForTimeout(300);
  assert.equal(await popup.isHidden("#grant"), true, "Chrome grants host access at install");
  await popup.close();
});

// Firefox as the popup sees it: a moz-extension URL, host access withheld, a file:// tab.
async function firefoxPopup({ granted = false } = {}) {
  const popup = await ctx.newPage();
  await popup.addInitScript((granted) => {
    const getURL = chrome.runtime.getURL.bind(chrome.runtime);
    chrome.runtime.getURL = (p) => (p ? getURL(p) : "moz-extension://pinpoint/");
    chrome.permissions.contains = async () => granted;
    chrome.permissions.request = async (o) => { window.__asked = o; granted = true; return true; };
    chrome.runtime.sendMessage = async (m) => m.type === "canRun"
      ? { url: "file:///x.html", local: false, code: "file_access", reason: "Turn on file access." }
      : m.type === "health" ? { ok: false } : null;
  }, granted);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForFunction(() => document.querySelector("#where").style.display === "block");
  return popup;
}

test("Firefox: file access gets directions, not a chrome:// link that cannot open", async () => {
  const popup = await firefoxPopup({ granted: true });
  assert.equal(await popup.locator("#where button").count(), 0);
  assert.match(await popup.textContent("#where"), /about:addons/);
  assert.equal(await popup.isHidden("#grant"), true, "already granted: no button");
  await popup.close();
});

test("Firefox: withheld host access shows Grant, which asks for the local sites only", async () => {
  const popup = await firefoxPopup({ granted: false });
  await popup.waitForSelector("#grant", { state: "visible" });
  await popup.click("#grant");
  await popup.waitForFunction(() => window.__asked);
  const { origins } = await popup.evaluate(() => window.__asked);
  assert.ok(origins.includes("http://localhost/*") && origins.includes("http://127.0.0.1/*"));
  assert.ok(!origins.some((o) => o.startsWith("file:") || o === "<all_urls>"), "nothing beyond local dev sites");
  await popup.waitForSelector("#grant", { state: "hidden" });
  assert.match(await popup.textContent("#hint"), /reload/i);
  await popup.close();
});
