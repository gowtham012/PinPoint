// The native-app picker pages (/ios, /android) in a real headless Chromium. No Simulator or emulator
// here: /<kind>/screen is answered by a canned snapshot, and everything else — the page, the POST,
// the stored annotation, the pins — is the real bridge. Run: node --test e2e-picker.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../bridge/cli.js");
// P+10: clear of every port bridge.test.mjs and e2e.test.mjs derive from the same base.
const PORT = (Number(process.env.PINPOINT_TEST_PORT) || 7399) + 10;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-picker-"));

let daemon, browser;
before(async () => {
  daemon = spawn("node", [CLI, "--port", String(PORT), "--quiet"], { env: { ...process.env, PINPOINT_HOME: HOME }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  daemon?.kill();
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// A screenshot to pick on: a plain screen with one box where the target node is.
async function fakeScreen(size, box) {
  const p = await browser.newPage({ viewport: size });
  await p.setContent(`<body style="margin:0;background:#eee"><div style="position:absolute;background:#36c;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px"></div>`);
  const png = (await p.screenshot()).toString("base64");
  await p.close();
  return png;
}

// Hover the target, check the tip, click it, write a note, send it; returns the stored annotation.
async function pickAndSend(kind, screen, target, tipText) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.route(`${BASE}/${kind}/screen`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(screen) }));
  await page.goto(`${BASE}/${kind}`);
  await page.waitForFunction((n) => document.getElementById("status").textContent.includes(`${n} elements`), screen.nodes.length);
  const box = await page.locator("#shot").boundingBox();
  const s = box.width / screen.viewport.width;
  const at = { x: box.x + (target.bounds.x + target.bounds.width / 2) * s, y: box.y + (target.bounds.y + target.bounds.height / 2) * s };
  await page.mouse.move(at.x, at.y);
  assert.equal(await page.locator("#tip").textContent(), tipText);
  await page.mouse.click(at.x, at.y);
  assert.equal(await page.locator("#what").textContent(), target.path);
  await page.fill("#comment", "make it bigger");
  await page.click("#send");
  await page.waitForFunction(() => /Sent #\d+/.test(document.getElementById("status").textContent));
  await page.locator(".pin").first().waitFor();
  const { annotations: [mine] } = await (await fetch(`${BASE}/annotations?status=pending&url=${encodeURIComponent(screen.url)}`)).json();
  const { annotation } = await (await fetch(`${BASE}/annotations/${mine.id}`)).json();
  return { page, annotation };
}

test("the iOS picker: hover, click, comment, send — and the pin appears", async () => {
  const button = { id: "tab-home", label: "Home", text: "", value: "", hint: "", bounds: { x: 20, y: 780, width: 80, height: 50 }, path: '"Home" > #tab-home' };
  const screen = {
    device: { udid: "U-1", name: "iPhone Test" },
    url: "ios-simulator://iPhone Test",
    viewport: { width: 402, height: 874, dpr: 1 },
    nodes: [{ id: "", label: "Home", text: "", value: "", hint: "", bounds: { x: 0, y: 0, width: 402, height: 874 }, path: '"Home"' }, button],
  };
  screen.png = await fakeScreen({ width: 402, height: 874 }, button.bounds);
  const { page, annotation: a } = await pickAndSend("ios", screen, button, "#tab-home");
  assert.equal(await page.title(), "Pinpoint — iOS Simulator");
  assert.equal(a.comment, "make it bigger");
  assert.equal(a.page.url, "ios-simulator://iPhone Test");
  assert.equal(a.element.selector, '[accessibilityIdentifier="tab-home"]');
  assert.equal(a.source.framework, "ios-native");
  assert.ok(a.screenshot?.width > 0, "the page crops the node out of the screenshot");
  await page.close();
});

test("the Android picker: same page at /android, an emulator annotation comes out", async () => {
  const sw = { id: "switch_widget", label: "Wi-Fi", text: "", class: "android.widget.Switch", bounds: { x: 860, y: 600, width: 160, height: 120 }, path: '"Settings" > #switch_widget' };
  const screen = {
    device: { serial: "emulator-5554", name: "Pixel_Test", emulator: true },
    url: "android-emulator://Pixel_Test",
    viewport: { width: 1080, height: 2400, dpr: 1 },
    nodes: [{ id: "", label: "", text: "Settings", class: "android.widget.FrameLayout", bounds: { x: 0, y: 0, width: 1080, height: 2400 }, path: '"Settings"' }, sw],
  };
  screen.png = await fakeScreen({ width: 1080, height: 2400 }, sw.bounds);
  const { page, annotation: a } = await pickAndSend("android", screen, sw, "#switch_widget");
  assert.equal(await page.title(), "Pinpoint — Android emulator");
  assert.match(await page.locator("header b").textContent(), /Android emulator/);
  assert.equal(a.page.url, "android-emulator://Pixel_Test");
  assert.equal(a.element.selector, '[resource-id="switch_widget"]');
  assert.equal(a.source.framework, "android-native");
  assert.ok(a.screenshot?.width > 0);
  await page.close();
});
