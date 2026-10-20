// Records docs/demo-ios.mp4, .gif, .jpg and docs/demo-ios-vertical.mp4 (1080×1920, for X/Shorts): one
// note on a native iOS app, made in the bridge's Simulator picker (/ios). The counterpart of
// tools/make-demo-video.mjs.
//
//   bash demo/ios/run.sh                  (a booted Simulator with Trailhead installed)
//   node tools/make-ios-demo-video.mjs    (needs test/node_modules — cd test && npm install —, Maestro, ffmpeg)
//   PINPOINT_DEMO_PORT moves its bridge (7955).
//
// Hover → click "Book this trip" → say what should change → ⌘↩ → a pin → what the agent got → the
// agent asks → you answer in the picker → the agent changes the app (Trailhead relaunched with
// --sticky-book, its "after") and resolves with a reply → Accept → Refresh: sticky, and the pin gone.
//
// The /ios page is an ordinary page served by the bridge, so plain Playwright records it: no
// extension. The agent is played through the bridge's HTTP API; the card on the right is ours,
// labelled as the agent's side. The question, the answer box and the done card are the picker's own.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "../test/node_modules/playwright/index.mjs";
import { REPO, sleep, startBridge } from "./demo-kit.mjs";

const PORT = Number(process.env.PINPOINT_DEMO_PORT) || 7955;
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const APP = "dev.pinpoint.trailhead";
// K: recorded pixels per CSS pixel. Playwright's screencast is 1× whatever the deviceScaleFactor.
const W = 1280, H = 800, K = 1;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-ios-video-"));
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), "pp-ios-video-raw-"));
let bridge = null, born = 0, start = 0, posterAt = 0;
const now = () => (Date.now() - born) / 1000 - start;
const agentShown = []; // [from, to] seconds, for the vertical cut

const launchApp = (...args) => execFileSync("xcrun", ["simctl", "launch", "--terminate-running-process", "booted", APP, ...args], { stdio: "ignore" });

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
async function clickOn(page, sel, ms = 700) {
  const b = await page.locator(sel).boundingBox();
  await clickAt(page, b.x + b.width / 2, b.y + b.height / 2, ms);
}

// The caption: a box of ours in the left column, above nothing the product draws.
const CAP = { x: 32, y: 150, w: 372, h: 150 };
const say = (page, text, tone = "") => page.evaluate(([t, tone, c]) => {
  let el = document.getElementById("__demo_caption");
  if (!el) {
    el = document.createElement("div");
    el.id = "__demo_caption";
    el.style.cssText = `position:fixed;left:${c.x}px;top:${c.y}px;width:${c.w}px;z-index:2147483646;pointer-events:none;box-sizing:border-box;` +
      "padding:16px 20px;border-radius:14px;font:600 21px/1.4 -apple-system,system-ui,sans-serif;background:#14181f;box-shadow:0 10px 30px rgba(0,0,0,.25)";
    document.documentElement.appendChild(el);
  }
  el.style.color = tone === "good" ? "#7ee2a8" : "#f2f4f7";
  el.textContent = t;
}, [text, tone, CAP]);

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
  el.style.cssText = `position:fixed;left:${Math.round(r.right + 32)}px;top:${Math.round(r.top + 12)}px;z-index:2147483646;width:${Math.round(innerWidth - r.right - 64)}px;padding:14px 16px;border-radius:12px;pointer-events:none;box-sizing:border-box;` +
    "background:#0d0f12;color:#d8dce2;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 18px 50px rgba(0,0,0,.35);border:1px solid #2a2f37;overflow-wrap:anywhere";
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const row = (k, v) => `<div><span style="color:#5cc8ff">${k}</span> ${v}</div>`;
  const step = (head, text, color) => `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a2f37"><div style="color:#8a929e">${head}</div><div style="color:${color}">"${esc(text)}"</div></div>`;
  el.innerHTML = `<div style="color:#8a929e;margin-bottom:6px">your agent ← get_pending_annotations</div>` +
    row("comment   ", `<span style="color:#c6f432">"${esc(a.comment)}"</span>`) +
    row("identifier", esc(a.id)) +
    row("label     ", esc(a.label)) +
    row("tree path ", esc(a.path)) +
    row("frame     ", esc(a.frame)) +
    row("device    ", esc(a.device)) +
    `<img src="data:image/png;base64,${a.crop}" style="display:block;max-width:100%;max-height:70px;margin-top:8px;border-radius:6px">` +
    (a.ask ? step("your agent → reply_annotation", a.ask, "#ffb020") : "") +
    (a.answer ? step("your agent ← your answer", a.answer, "#c6f432") : "") +
    (a.reply ? step("your agent → resolve_annotation", a.reply, "#7ee2a8") : "");
}, a);

async function main() {
  launchApp(); // the "before", whatever the Simulator was showing
  bridge = await startBridge(PORT, HOME);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light", recordVideo: { dir: RAW, size: { width: W * K, height: H * K } } });
  const page = await ctx.newPage();
  born = Date.now();
  await page.goto(`${bridge.base}/ios`);
  // Zoomed in: the phone takes the full height, the header and our caption the left column, the
  // agent's card the right one.
  await page.addStyleTag({ content: `
    header { position: fixed; left: ${CAP.x}px; top: 28px; width: ${CAP.w}px; flex-wrap: wrap; border: 0; padding: 0; gap: 6px 12px; }
    header b { font-size: 17px; flex: 1; }
    #status { flex-basis: 100%; order: 3; font-size: 13px; }
    main { padding: 14px 0 0; }
    #shot { max-height: calc(100vh - 28px); border-radius: 22px; }
    #done { width: 340px; }` });
  // Maestro's first start installs its on-device driver: 10–60 s. Not recorded — trimmed below.
  console.log("  · waiting for the first screen (Maestro's driver can take a minute)…");
  await page.waitForFunction(() => /elements\./.test(document.getElementById("status").textContent) || /^(Could|no |Maestro)/i.test(document.getElementById("status").textContent), null, { timeout: 240000 });
  const status = await page.textContent("#status");
  if (!/elements\./.test(status)) throw new Error("the picker could not read the Simulator: " + status);
  const phone = await page.locator("#shot").boundingBox();
  await page.mouse.move(mouse.x, mouse.y);
  await cursorAt(page, mouse.x, mouse.y);
  await say(page, "Your iOS app in the Simulator. Something should change.");
  await sleep(600);
  start = (Date.now() - born) / 1000;
  await sleep(2400);

  // --- 1. hover: every element names itself ---
  await say(page, "Hover: each element shows its accessibilityIdentifier.");
  for (const id of ["trip-title", "price-label"]) {
    const p = await nodeCenter(page, id);
    await moveTo(page, p.x, p.y, 700);
    await sleep(800);
    console.log("  · hover tag:", await page.textContent("#tip"));
  }

  // --- 2. click the CTA, say what should change ---
  const book = await nodeCenter(page, "book-button");
  await moveTo(page, book.x, book.y, 600);
  await say(page, "Click the one you mean, say what should change.");
  await sleep(600);
  await clickAt(page, book.x, book.y, 100);
  await page.waitForFunction(() => !document.getElementById("pop").hidden);
  await sleep(400);
  await page.keyboard.type("Make this sticky at the bottom so it's always reachable", { delay: 32 });
  await say(page, "⌘↩ sends it to your agent.");
  await sleep(700);
  await page.keyboard.press("Meta+Enter");
  await page.waitForFunction(() => /Sent #/.test(document.getElementById("status").textContent));
  await page.waitForSelector(".pin");
  // Parked in the gap left of the phone: over the screen, the whole-screen container would light up.
  const park = (y) => moveTo(page, phone.x - 36, y, 500);
  await park(book.y);
  await say(page, "A numbered pin marks it.");
  await sleep(1400);

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
    crop: a.screenshot?.base64 || "",
  };
  await showAgent(page, card);
  const shownAt = now();
  await say(page, "Your agent gets the identifier, label, tree path, frame and a crop.");
  posterAt = (Date.now() - born) / 1000 + 0.6;
  await sleep(4200);
  agentShown.push([shownAt, now()]);

  // --- 4. the agent asks; you answer in the picker ---
  const ask = "Sticky at the bottom always, or only after scrolling?";
  await api(`/annotations/${a.id}/reply`, { text: ask, by: "claude-code" });
  card.ask = ask;
  await showAgent(page, card);
  await page.waitForSelector(".pin.ask");
  await say(page, "Not sure? Your agent asks — the pin turns into a ?");
  await sleep(1800);
  await clickOn(page, ".pin.ask", 700);
  await page.waitForSelector("#note:not([hidden]) textarea");
  await say(page, "Answer it right here in the picker.");
  await sleep(1200);
  const answer = "Always — it should never scroll away.";
  await page.keyboard.type(answer, { delay: 38 });
  await sleep(400);
  await page.keyboard.press("Meta+Enter");
  await page.waitForSelector(".pin.ask", { state: "detached" });
  card.answer = answer;
  await showAgent(page, card);
  await park(book.y + 60);
  await sleep(1500);

  // --- 5. the agent changes the app and resolves with a reply ---
  await say(page, "Your agent changes the app and replies…");
  launchApp("--sticky-book");
  await sleep(800);
  const reply = "book-button now sits in .safeAreaInset(edge: .bottom), with a shadow — always on screen.";
  await api(`/annotations/${a.id}/resolve`, { note: reply, by: "claude-code" });
  card.reply = reply;
  await showAgent(page, card);
  await page.waitForSelector("#done:not([hidden])");
  await sleep(1200);
  await say(page, "…and its reply shows: Accept, or Not quite to reopen it.");
  await sleep(2600);
  await clickOn(page, "#accept", 800);
  await page.waitForSelector("#done", { state: "hidden" });
  await park(book.y + 60);
  await sleep(300);

  // --- 6. refresh: the real after, and no pin ---
  await say(page, "Refresh: the button is sticky now, and the pin is gone.");
  await clickOn(page, "#refresh", 800);
  await page.waitForFunction(() => /elements\./.test(document.getElementById("status").textContent) && !document.querySelector(".pin"), null, { timeout: 60000 });
  const b2 = await nodeCenter(page, "book-button");
  await moveTo(page, phone.x - 30, b2.y, 900); // beside the button, off the screen so nothing highlights
  await sleep(2800);
  await showAgent(page, null);
  await say(page, "Pinpoint — point at it in the Simulator, talk it through with your agent. Runs locally.", "good");
  await sleep(3200);

  const video = page.video();
  await ctx.close();
  await browser.close();
  bridge.proc.kill();
  launchApp(); // leave the Simulator on the "before"
  encode(await video.path(), phone);
}

function encode(raw, phone) {
  const out = (name) => path.join(REPO, "docs", name);
  const pal = path.join(RAW, "palette.png");
  const ss = ["-ss", start.toFixed(2)];
  const enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-vf", `scale=${W}:${H}:flags=lanczos`, ...enc, out("demo-ios.mp4")]);
  const vf = "fps=10,scale=760:-1:flags=lanczos";
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-vf", `${vf},palettegen=max_colors=96:stats_mode=diff`, pal]);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-i", pal,
    "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, out("demo-ios.gif")]);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", raw, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-q:v", "4", out("demo-ios.jpg")]);

  // 9:16 from the same recording, reframed: the caption on top, the phone under it — and, while the
  // agent's card is up, the card over the lower half. Crops are in recorded (×K) pixels.
  const c = (x, y, w, h) => `crop=${Math.round(w * K)}:${Math.round(h * K)}:${Math.round(x * K)}:${Math.round(y * K)}`;
  const ph = { x: phone.x - 8, y: phone.y - 8, w: phone.width + 16, h: phone.height + 16 };
  const phH = 1440, phW = Math.round(phH * ph.w / ph.h / 2) * 2;
  const capW = 1000, capH = Math.round(capW * CAP.h / CAP.w / 2) * 2;
  const ag = { x: phone.x + phone.width + 32, y: phone.y + 12, w: W - phone.x - phone.width - 64, h: 420 };
  const agW = 1000, agH = Math.round(agW * ag.h / ag.w / 2) * 2;
  const on = agentShown.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+") || "0";
  const fc = `color=c=#f6f6f4:s=1080x1920:r=25[bg];` +
    // Playwright's webm is variable-rate and does not start at 0: without this the overlays drift.
    `[0:v]fps=25,setpts=PTS-STARTPTS,split=3[v1][v2][v3];` +
    `[v1]${c(CAP.x, CAP.y, CAP.w, CAP.h)},scale=${capW}:${capH}:flags=lanczos[cap];` +
    `[v2]${c(ph.x, ph.y, ph.w, ph.h)},scale=${phW}:${phH}:flags=lanczos[ph];` +
    `[v3]${c(ag.x, ag.y, ag.w, ag.h)},scale=${agW}:${agH}:flags=lanczos[ag];` +
    `[bg][cap]overlay=${(1080 - capW) / 2}:40:shortest=1[a];` +
    `[a][ph]overlay=${(1080 - phW) / 2}:${1920 - phH - 30}[b];` +
    `[b][ag]overlay=${(1080 - agW) / 2}:${1920 - agH - 60}:enable='${on}'`;
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-filter_complex", fc, ...enc, out("demo-ios-vertical.mp4")]);
  for (const f of ["demo-ios.mp4", "demo-ios.gif", "demo-ios.jpg", "demo-ios-vertical.mp4"].map(out)) console.log(`▸ ${f}  (${(fs.statSync(f).size / 1e6).toFixed(1)} MB)`);
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(String(e.stack || e.message || e));
  bridge?.proc.kill();
  process.exit(1);
});
