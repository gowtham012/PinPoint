// Records docs/demo.mp4, docs/demo.gif and docs/demo.jpg (the site's poster): one note, start to finish, with the real extension.
//
//   node tools/make-demo-video.mjs        (needs test/node_modules — cd test && npm install — and ffmpeg)
//   PINPOINT_DEMO_PORT / PINPOINT_DEMO_SITE move its bridge (7950) and the demo site (8950).
//
// Pick a button on demo/index.html → write what should change → send → the agent asks back → answer
// → the agent changes it and replies → the done card, Accept → Before / After in the notes panel.
//
// The agent is played through the bridge's HTTP API, exactly as test/e2e.test.mjs does: /reply asks,
// /resolve answers. Its code edit is a style change made in the page, standing in for the dev
// server's hot reload. Everything the extension does is the extension: real clicks, real keys,
// its own bridge (temp PINPOINT_HOME, its own token), and an after crop the bridge takes by itself.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO, sleep, serveDemo, startBridge, launch, inShadow, waitShadow, shadowPoint, caption } from "./demo-kit.mjs";

const PORT = Number(process.env.PINPOINT_DEMO_PORT) || 7950, SITE = Number(process.env.PINPOINT_DEMO_SITE) || 8950;
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const W = 1280, H = 800;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-video-"));
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), "pp-video-raw-"));
const MOD = process.platform === "darwin" ? "Meta" : "Control";
let bridge = null, born = 0, posterAt = 0;

// ---------- our cursor ----------
// Headless video has no pointer, so we draw one. It goes where the real mouse events go (the ones
// Pinpoint's picker sees), is re-appended last so it paints over Pinpoint's layer, and rings on a press.
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
    ring.style.left = x + "px"; ring.style.top = y + "px"; // not transform: `scale` below would scale it too
    ring.animate([{ opacity: 1, scale: 0.4 }, { opacity: 0, scale: 1.4 }], { duration: 500, easing: "ease-out" });
  }
}, [x, y, press]);
let mouse = { x: W / 2, y: H / 2 };
async function moveTo(page, x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
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
// Captions as a pill near the top: Pinpoint's toasts and done card sit at the bottom.
const say = (page, text, tone) => caption(page, text, tone, true);
const tap = async (page, sel, ms) => { const p = await shadowPoint(page, sel); await clickAt(page, p.x, p.y, ms); };

// ---------- the agent's side, over HTTP ----------
const api = (p, body) => fetch(bridge.base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
async function until(fn, what, timeout = 10000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error("timed out waiting for " + what); await sleep(100); }
}

// A card of ours showing what the agent was handed. Every field comes from the bridge's copy of the
// note; it is labelled as the agent's view, not styled as Pinpoint's UI.
const showReceived = (page, a) => page.evaluate((a) => {
  let el = document.getElementById("__demo_agent");
  if (!a) return el?.remove();
  el = document.createElement("div");
  el.id = "__demo_agent";
  el.style.cssText = "position:fixed;left:24px;bottom:24px;z-index:2147483646;width:470px;padding:14px 16px;border-radius:12px;pointer-events:none;" +
    "background:#0d0f12;color:#d8dce2;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 18px 50px rgba(0,0,0,.35);border:1px solid #2a2f37";
  const row = (k, v) => `<div><span style="color:#5cc8ff">${k}</span> ${v}</div>`;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  el.innerHTML = `<div style="color:#8a929e;margin-bottom:6px">your agent ← get_pending_annotations</div>` +
    row("comment ", `<span style="color:#c6f432">"${esc(a.comment)}"</span>`) +
    row("selector", esc(a.selector)) +
    row("styles  ", esc(a.styles)) +
    row("text    ", esc(a.text)) +
    row("crop    ", esc(a.crop));
  document.documentElement.appendChild(el);
}, a);

async function main() {
  const site = await serveDemo(SITE);
  bridge = await startBridge(PORT, HOME, { PINPOINT_AFTER_DELAY: "1500" });
  const ctx = await launch({
    port: PORT, token: bridge.token,
    viewport: { width: W, height: H }, deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: { width: W, height: H } },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  born = Date.now();
  await page.goto(`http://localhost:${SITE}/`);
  await waitShadow(page, () => !!__pinpointShadow.querySelector(".dock"));
  await page.mouse.move(mouse.x, mouse.y);
  await cursorAt(page, mouse.x, mouse.y);
  await sleep(1200); // the bar settles, the "connected" toast goes
  await waitShadow(page, () => __pinpointShadow.querySelector(".toast").style.display === "none", null, { timeout: 8000 }).catch(() => {});
  const start = (Date.now() - born) / 1000;

  const target = page.locator(".hero .cta .btn.primary");
  await say(page, "Your dev site, running locally. Something on it should change.");
  await sleep(2200);

  // --- 1. pick ---
  await say(page, "⌥⇧A — then click the thing you mean.");
  await sleep(600);
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  const box = await target.boundingBox();
  await moveTo(page, box.x - 90, box.y - 70, 700);
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2, 800);
  await sleep(700);
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, 100);
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");

  // --- 2. say what should change ---
  await say(page, "Say what should change, in your own words.");
  await waitShadow(page, () => __pinpointShadow.activeElement?.tagName === "TEXTAREA", null, { timeout: 4000 });
  const comment = "Make this stand out more, it's the main action";
  await page.keyboard.type(comment, { delay: 42 });
  await sleep(600);
  await tap(page, ".pop .send", 600);
  await waitShadow(page, () => /Sent/.test(__pinpointShadow.querySelector(".pop .status").textContent));
  await sleep(700);
  await page.keyboard.press("Escape");
  await sleep(200);
  for (let i = 0; i < 5 && await page.evaluate(() => document.documentElement.classList.contains("pinpoint-picking")); i++) {
    await page.keyboard.press("Escape"); await sleep(250);
  }
  await moveTo(page, 900, 470, 600);

  // --- 3. what the agent gets ---
  const [a] = await until(async () => {
    const l = (await api("/annotations?status=pending&images=1")).annotations;
    return l.length && l[0].screenshot ? l : null;
  }, "the note and its crop");
  const st = a.element.styles || {};
  await showReceived(page, {
    comment: a.comment,
    selector: a.element.selector,
    styles: ["background-color", "font-size", "padding"].filter((k) => st[k]).map((k) => `${k}: ${st[k]}`).join("; ") || "computed styles",
    text: JSON.stringify(a.element.text || ""),
    crop: `${a.screenshot.width}×${a.screenshot.height} png`,
  });
  await say(page, "Your agent gets the element, not a guess: selector, styles, component, source hint, a crop.");
  await sleep(4200);
  await showReceived(page, null);

  // --- 4. the agent asks back ---
  await api(`/annotations/${a.id}/reply`, { text: "Bigger, or a stronger colour, or both?", by: "claude-code" });
  await say(page, "It can ask before it guesses.");
  await waitShadow(page, () => /asks/.test(__pinpointShadow.querySelector(".toast").textContent) && __pinpointShadow.querySelector(".toast").style.display !== "none", null, { timeout: 8000 });
  await sleep(1400);
  await tap(page, ".toast", 700);
  await waitShadow(page, () => __pinpointShadow.querySelector(".panel .item.waiting form textarea"));
  await sleep(500);
  await inShadow(page, () => __pinpointShadow.querySelector(".panel .item.waiting form textarea").focus());
  await say(page, "You answer right there, on the page.");
  await page.keyboard.type("Both. Bigger, with a lift so it reads as the CTA", { delay: 38 });
  await sleep(500);
  await tap(page, ".panel .item.waiting form .go", 600);
  await until(async () => (await api(`/annotations/${a.id}`)).annotation.status === "pending", "the answer");
  await sleep(600);
  await tap(page, ".panel h2 .close", 600);
  await moveTo(page, 940, 520, 500);

  // --- 5. the agent edits and replies ---
  await say(page, "The agent edits your code; the dev server reloads…");
  await sleep(1600);
  await page.evaluate(() => {
    const b = document.querySelector(".hero .cta .btn.primary");
    b.style.cssText = "font-size:20px;padding:18px 36px;box-shadow:0 12px 28px rgba(15,118,110,.45),0 0 0 4px #ccfbf1";
  });
  await sleep(500);
  await api(`/annotations/${a.id}/resolve`, { note: "Hero CTA is 20px with more padding, a lifted shadow and a soft ring (.hero .cta .btn.primary)", by: "claude-code" });
  await waitShadow(page, () => __pinpointShadow.querySelector(".toast .ok")?.offsetParent, null, { timeout: 8000 });
  await say(page, "…and tells you what it did. Accept, or Not quite to send it back.");
  await sleep(1800);
  // The card holds while the pointer is on it.
  const ok = await shadowPoint(page, ".toast .ok");
  await moveTo(page, ok.x, ok.y, 800);
  await sleep(1600);
  const after = await until(async () => (await api(`/annotations/${a.id}`)).annotation.after, "the after crop", 12000);
  console.log("  · after:", JSON.stringify({ ...after, screenshot: after.screenshot && { w: after.screenshot.width, h: after.screenshot.height } }));
  await clickAt(page, ok.x, ok.y, 100);
  await until(async () => (await api(`/annotations/${a.id}`)).annotation.acceptedAt, "the accept");
  await sleep(600);

  // --- 6. before / after ---
  await inShadow(page, () => __pinpointShadow.querySelector(".dock").classList.remove("mini"));
  await tap(page, ".dock .count", 700);
  await waitShadow(page, () => [...__pinpointShadow.querySelectorAll(".panel .item.done .ba img")].filter((i) => /^data:image\/png;base64,./.test(i.src)).length === 2, null, { timeout: 10000 }).catch(async (e) => {
    console.error(await inShadow(page, () => ({ panel: __pinpointShadow.querySelector(".panel").style.display, list: __pinpointShadow.querySelector(".panel .list").innerHTML.slice(0, 1500), dock: __pinpointShadow.querySelector(".dock").className })));
    throw e;
  });
  await say(page, "Before and after, kept with the note.", "good");
  const ba = await shadowPoint(page, ".panel .item.done .ba");
  await moveTo(page, ba.x - 40, ba.y + 70, 700);
  await sleep(2000);
  // The same two crops, large: the panel's thumbnails are small in a video.
  const full = (await api(`/annotations/${a.id}`)).annotation;
  await page.evaluate(([b, af]) => {
    const el = document.createElement("div");
    el.id = "__demo_ba";
    el.style.cssText = "position:fixed;left:80px;top:470px;z-index:2147483646;display:flex;gap:18px;padding:18px;border-radius:14px;pointer-events:none;" +
      "background:#0d0f12;box-shadow:0 18px 50px rgba(0,0,0,.35);font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8a929e";
    // At the same scale, so the change in size shows.
    for (const [label, { base64: src, height: h }] of [["before", b], ["after", af]]) {
      const f = document.createElement("figure");
      f.style.cssText = "margin:0;display:grid;gap:8px;align-content:end";
      f.innerHTML = `<img style="height:${Math.round(h * 1.6)}px;border-radius:8px;background:#fff;align-self:end" src="data:image/png;base64,${src}"><figcaption>${label}</figcaption>`;
      f.querySelector("figcaption").style.color = label === "after" ? "#c6f432" : "#8a929e";
      el.appendChild(f);
    }
    document.documentElement.appendChild(el);
  }, [full.screenshot, full.after.screenshot]);
  await cursorAt(page, mouse.x, mouse.y);
  posterAt = (Date.now() - born) / 1000 + 0.5;
  await sleep(3400);
  await say(page, "Pinpoint — point at it, say it, your agent gets it. Runs locally.");
  await sleep(2600);

  const video = page.video();
  await ctx.close();
  bridge.proc.kill();
  site.close();
  encode(await video.path(), start);
}

function encode(raw, start) {
  const mp4 = path.join(REPO, "docs", "demo.mp4"), gif = path.join(REPO, "docs", "demo.gif");
  const pal = path.join(RAW, "palette.png");
  const ss = ["-ss", start.toFixed(2)];
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-c:v", "libx264", "-preset", "slow", "-crf", "22",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  const vf = "fps=10,scale=760:-1:flags=lanczos";
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-vf", `${vf},palettegen=max_colors=96:stats_mode=diff`, pal]);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...ss, "-i", raw, "-i", pal,
    "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
  const jpg = path.join(REPO, "docs", "demo.jpg");
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", raw, "-frames:v", "1", "-q:v", "4", jpg]);
  for (const f of [mp4, gif, jpg]) console.log(`▸ ${f}  (${(fs.statSync(f).size / 1e6).toFixed(1)} MB)`);
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(String(e.stack || e.message || e));
  bridge?.proc.kill();
  process.exit(1);
});
