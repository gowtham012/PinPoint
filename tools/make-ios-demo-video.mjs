// Records docs/demo-ios.mp4, docs/demo-ios.gif and docs/demo-ios.jpg: one note on a native iOS app,
// made in the bridge's Simulator picker (/ios). The counterpart of tools/make-demo-video.mjs.
//
//   bash demo/ios/run.sh                  (a booted Simulator running Trailhead)
//   node tools/make-ios-demo-video.mjs    (needs test/node_modules — cd test && npm install —, Maestro, ffmpeg)
//   PINPOINT_DEMO_PORT moves its bridge (7955).
//
// Hover → click "Book this trip" → write what should change → ⌘↩ → a numbered pin → what the agent
// got → the agent resolves → Refresh, the pin is gone.
//
// The /ios page is an ordinary page served by the bridge, so plain Playwright records it: no
// extension. The agent is played through the bridge's HTTP API. The picker shows pending pins only —
// it has no place for an agent's question or reply — so the agent's question is left out and its
// reply is shown in our own card, labelled as the agent's side.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "../test/node_modules/playwright/index.mjs";
import { REPO, sleep, startBridge, caption } from "./demo-kit.mjs";

const PORT = Number(process.env.PINPOINT_DEMO_PORT) || 7955;
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const W = 1280, H = 800;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-ios-video-"));
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), "pp-ios-video-raw-"));
let bridge = null, born = 0, posterAt = 0;

// ---------- our cursor (as in make-demo-video.mjs) ----------
const cursorAt = (page, x, y, press = false) => page.evaluate(([x, y, press]) => {
  let c = document.getElementById("__demo_cursor"), ring = document.getElementById("__demo_ring");
  if (!c) {
    c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = `<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#fff" stroke="#121212" stroke-width="2" stroke-linejoin="round"/></svg>`;
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))";
    ring = document.createElement("div");
    ring.id = "__demo_ring";
    ring.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #c6f432;box-shadow:0 0 0 1px #121212;z-index:2147483647;pointer-events:none;opacity:0";
  }
  if (document.documentElement.lastElementChild !== c) document.documentElement.append(ring, c);
  c.style.transform = `translate(${x - 3}px,${y - 2}px)`;
  if (press) {
    ring.style.left = x + "px"; ring.style.top = y + "px";
    ring.animate([{ opacity: 1, scale: 0.4 }, { opacity: 0, scale: 1.4 }], { duration: 500, easing: "ease-out" });
  }
}, [x, y, press]);
let mouse = { x: 1000, y: 560 };
async function moveTo(page, x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const px = from.x + (x - from.x) * e, py = from.y + (y - from.y) * e;
    await page.mouse.move(px, py);
    await cursorAt(page, px, py);
    await sleep(ms / steps / 2);
  }
  mouse = { x, y };
}
async function clickAt(page, x, y, ms) {
  await moveTo(page, x, y, ms);
  await sleep(180);
  await cursorAt(page, x, y, true);
  await page.mouse.down(); await sleep(70); await page.mouse.up();
}
const say = (page, text, tone) => caption(page, text, tone, true);

// Where a node of the Simulator screen sits in the window: its frame in points, scaled like the image.
const nodeCenter = (page, id) => page.evaluate((id) => {
  const n = screen.nodes.find((n) => n.id === id);
  if (!n) throw new Error(`no node #${id} on the screen`);
  const r = document.getElementById("shot").getBoundingClientRect(), s = r.width / screen.viewport.width;
  return { x: r.left + (n.bounds.x + n.bounds.width / 2) * s, y: r.top + (n.bounds.y + n.bounds.height / 2) * s };
}, id);

// ---------- the agent's side, over HTTP ----------
const api = (p, body) => fetch(bridge.base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());

// A card of ours, right of the phone, showing the bridge's copy of the note — labelled as the agent's view.
const showAgent = (page, a) => page.evaluate((a) => {
  let el = document.getElementById("__demo_agent");
  if (!a) return el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = "__demo_agent";
    document.documentElement.appendChild(el);
  }
  const r = document.getElementById("shot").getBoundingClientRect();
  el.style.cssText = `position:fixed;left:${Math.round(r.right + 36)}px;top:${Math.round(r.top + 40)}px;z-index:2147483646;width:${Math.round(Math.min(470, innerWidth - r.right - 60))}px;padding:14px 16px;border-radius:12px;pointer-events:none;` +
    "background:#0d0f12;color:#d8dce2;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 18px 50px rgba(0,0,0,.35);border:1px solid #2a2f37;overflow-wrap:anywhere";
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const row = (k, v) => `<div><span style="color:#5cc8ff">${k}</span> ${v}</div>`;
  el.innerHTML = `<div style="color:#8a929e;margin-bottom:6px">your agent ← get_pending_annotations</div>` +
    row("comment   ", `<span style="color:#c6f432">"${esc(a.comment)}"</span>`) +
    row("identifier", esc(a.id)) +
    row("label     ", esc(a.label)) +
    row("tree path ", esc(a.path)) +
    row("frame     ", esc(a.frame)) +
    row("device    ", esc(a.device)) +
    row("crop      ", esc(a.cropSize)) +
    `<img src="data:image/png;base64,${a.crop}" style="display:block;max-width:100%;max-height:90px;margin-top:8px;border-radius:6px">` +
    (a.reply ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a2f37"><div style="color:#8a929e">your agent → resolve_annotation</div><div style="color:#7ee2a8">"${esc(a.reply)}"</div></div>` : "");
}, a);

async function main() {
  bridge = await startBridge(PORT, HOME);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light", recordVideo: { dir: RAW, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  born = Date.now();
  await page.goto(`${bridge.base}/ios`);
  // Room for the caption pill between the header and the phone.
  await page.addStyleTag({ content: "main{padding-top:88px} #shot{max-height:calc(100vh - 200px)}" });
  // Maestro's first start installs its on-device driver: 10–60 s. Not recorded — trimmed below.
  console.log("  · waiting for the first screen (Maestro's driver can take a minute)…");
  await page.waitForFunction(() => /elements\./.test(document.getElementById("status").textContent) || /^(Could|no |Maestro)/i.test(document.getElementById("status").textContent), null, { timeout: 240000 });
  const status = await page.textContent("#status");
  if (!/elements\./.test(status)) throw new Error("the picker could not read the Simulator: " + status);
  await page.mouse.move(mouse.x, mouse.y);
  await cursorAt(page, mouse.x, mouse.y);
  await sleep(600);
  const start = (Date.now() - born) / 1000;

  await say(page, "Your iOS app in the Simulator. Something should change.");
  await sleep(2600);

  // --- 1. hover: every element names itself ---
  await say(page, "Hover: each element shows its accessibilityIdentifier.");
  for (const id of ["trip-title", "trip-summary", "price-label"]) {
    const p = await nodeCenter(page, id);
    await moveTo(page, p.x, p.y, 750);
    await sleep(900);
    console.log("  · hover tag:", await page.textContent("#tip"));
  }

  // --- 2. click the CTA, say what should change ---
  const book = await nodeCenter(page, "book-button");
  await moveTo(page, book.x, book.y, 700);
  await sleep(900);
  await say(page, "Click the one you mean, say what should change.");
  await clickAt(page, book.x, book.y, 100);
  await page.waitForFunction(() => !document.getElementById("pop").hidden);
  await sleep(500);
  await page.keyboard.type("Make this sticky at the bottom so it's always reachable", { delay: 40 });
  await sleep(500);
  await say(page, "⌘↩ sends it to your agent.");
  await sleep(900);
  await page.keyboard.press("Meta+Enter");
  await page.waitForFunction(() => /Sent #/.test(document.getElementById("status").textContent));
  await page.waitForSelector(".pin");
  // Parked left of the phone: the agent's card goes on the right.
  const left = (await page.locator("#shot").boundingBox()).x;
  await moveTo(page, left - 120, book.y - 60, 600);
  await say(page, "A numbered pin marks it.");
  await sleep(1800);

  // --- 3. what the agent gets ---
  const [a] = (await api("/annotations?status=pending&images=1")).annotations;
  const r = a.element.rect, at = a.element.attributes;
  const card = {
    comment: a.comment,
    id: at.accessibilityIdentifier || "—",
    label: at.accessibilityLabel || at.text || a.element.text || "—",
    path: a.element.domPath,
    frame: `x ${r.x}, y ${r.y}, ${r.width}×${r.height} pt`,
    device: a.page.url,
    cropSize: a.screenshot ? `${a.screenshot.width}×${a.screenshot.height} png` : "—",
    crop: a.screenshot?.base64 || "",
  };
  await showAgent(page, card);
  await say(page, "Your agent gets the identifier, label, tree path, frame and a crop.");
  await cursorAt(page, mouse.x, mouse.y);
  posterAt = (Date.now() - born) / 1000 + 0.6;
  await sleep(4800);

  // --- 4. the agent resolves ---
  const reply = "book-button is now pinned to the bottom with .safeAreaInset(edge: .bottom) in TripScreen";
  await api(`/annotations/${a.id}/resolve`, { note: reply, by: "claude-code" });
  await showAgent(page, { ...card, reply });
  await say(page, "It changes the code and resolves the note with a reply…");
  await sleep(3600);

  // --- 5. refresh: the pin is gone ---
  await say(page, "…and on the next refresh the pin is gone.");
  const btn = await page.locator("#refresh").boundingBox();
  await clickAt(page, btn.x + btn.width / 2, btn.y + btn.height / 2, 800);
  await page.waitForFunction(() => /elements\./.test(document.getElementById("status").textContent) && !document.querySelector(".pin"), null, { timeout: 60000 });
  const b2 = await nodeCenter(page, "book-button");
  await moveTo(page, left - 40, b2.y, 900); // beside the button, off the screen so nothing highlights
  await sleep(2000);
  await showAgent(page, null);
  await say(page, "Pinpoint — point at it in the Simulator, your agent gets it. Runs locally.", "good");
  await sleep(3000);

  const video = page.video();
  await ctx.close();
  await browser.close();
  bridge.proc.kill();
  encode(await video.path(), start);
}

function encode(raw, start) {
  const out = (ext) => path.join(REPO, "docs", `demo-ios.${ext}`);
  const pal = path.join(RAW, "palette.png");
  const ss = ["-ss", start.toFixed(2)];
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-c:v", "libx264", "-preset", "slow", "-crf", "22",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out("mp4")]);
  const vf = "fps=10,scale=760:-1:flags=lanczos";
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-vf", `${vf},palettegen=max_colors=96:stats_mode=diff`, pal]);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-i", pal,
    "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, out("gif")]);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", raw, "-frames:v", "1", "-q:v", "4", out("jpg")]);
  for (const f of ["mp4", "gif", "jpg"].map(out)) console.log(`▸ ${f}  (${(fs.statSync(f).size / 1e6).toFixed(1)} MB)`);
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(String(e.stack || e.message || e));
  bridge?.proc.kill();
  process.exit(1);
});
