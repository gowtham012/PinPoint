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

// The conversation, as the extension has it: the agent asks, you answer from the picker; the agent
// resolves, its reply shows with Accept and Not quite. Agent text is rendered as text, never as HTML.
const api = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const note = (id) => fetch(`${BASE}/annotations/${id}`).then((r) => r.json()).then((b) => b.annotation);

async function converse(kind, screen, target, tipText) {
  const { page, annotation: a } = await pickAndSend(kind, screen, target, tipText);
  // The agent asks: the pin turns into a "?" without a refresh.
  const question = 'Sticky always, or only after scrolling? <img src=x onerror="window.__pwned=1">';
  assert.equal((await api(`/annotations/${a.id}/reply`, { text: question, by: "claude-code" })).ok, true);
  await page.locator(".pin.ask").waitFor();
  assert.equal(await page.locator(".pin.ask").textContent(), "?");
  await page.click(".pin.ask");
  await page.locator("#note").waitFor();
  assert.match(await page.locator("#note").textContent(), /claude-code/);
  assert.ok((await page.locator("#note").textContent()).includes(question), "the question is shown as text");
  assert.equal(await page.locator("#note img").count(), 0, "never parsed as HTML");
  await page.fill("#note textarea", "Always");
  await page.click("#note button[type=submit]");
  await page.locator(".pin.ask").waitFor({ state: "detached" });
  let n = await note(a.id);
  assert.equal(n.status, "pending");
  assert.deepEqual(n.thread.map((m) => [m.by, m.text]), [["agent", question], ["you", "Always"]]);

  // The agent resolves: the reply shows, the pin goes. Not quite reopens it with a follow-up.
  await api(`/annotations/${a.id}/resolve`, { note: "Pinned with .safeAreaInset(edge: .bottom)", by: "claude-code" });
  await page.locator("#done").waitFor();
  assert.match(await page.locator("#done").textContent(), /done.*Pinned with \.safeAreaInset\(edge: \.bottom\)/s);
  await page.locator(".pin").waitFor({ state: "detached" });
  await page.click("#notquite");
  await page.fill("#done textarea", "Add a shadow above it");
  await page.click("#done button[type=submit]");
  await page.locator(".pin").waitFor();
  n = await note(a.id);
  assert.equal(n.status, "pending");
  assert.deepEqual(n.thread.slice(-2).map((m) => [m.by, m.kind || "", m.text]), [["agent", "resolution", "Pinned with .safeAreaInset(edge: .bottom)"], ["you", "", "Add a shadow above it"]]);

  // Resolved again: Accept marks it accepted.
  await api(`/annotations/${a.id}/resolve`, { note: "Added a shadow", by: "claude-code" });
  await page.locator("#done").waitFor();
  assert.match(await page.locator("#done").textContent(), /Added a shadow/);
  await page.click("#accept");
  await page.locator("#done").waitFor({ state: "hidden" });
  for (let i = 0; i < 20 && !(await note(a.id)).acceptedAt; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok((await note(a.id)).acceptedAt, "accepted");
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await page.close();
}

test("the iOS picker: the agent's question, your answer, its reply, Accept and Not quite", async () => {
  const button = { id: "book-button", label: "Book this trip", text: "", value: "", hint: "", bounds: { x: 20, y: 700, width: 362, height: 50 }, path: '"Trailhead" > #book-button' };
  const screen = {
    device: { udid: "U-2", name: "iPhone Talk" },
    url: "ios-simulator://iPhone Talk",
    viewport: { width: 402, height: 874, dpr: 1 },
    nodes: [{ id: "", label: "Trailhead", text: "", value: "", hint: "", bounds: { x: 0, y: 0, width: 402, height: 874 }, path: '"Trailhead"' }, button],
  };
  screen.png = await fakeScreen({ width: 402, height: 874 }, button.bounds);
  await converse("ios", screen, button, "#book-button");
});

test("the Android picker: the same conversation at /android", async () => {
  const sw = { id: "save", label: "Save", text: "", class: "android.widget.Button", bounds: { x: 100, y: 1800, width: 880, height: 160 }, path: '"Form" > #save' };
  const screen = {
    device: { serial: "emulator-5556", name: "Pixel_Talk", emulator: true },
    url: "android-emulator://Pixel_Talk",
    viewport: { width: 1080, height: 2400, dpr: 1 },
    nodes: [{ id: "", label: "", text: "Form", class: "android.widget.FrameLayout", bounds: { x: 0, y: 0, width: 1080, height: 2400 }, path: '"Form"' }, sw],
  };
  screen.png = await fakeScreen({ width: 1080, height: 2400 }, sw.bounds);
  await converse("android", screen, sw, "#save");
});
