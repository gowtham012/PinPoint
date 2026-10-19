// Five 1280×800 store screenshots (Chrome Web Store, Edge, AMO) of the real extension on
// demo/index.html, one per step of a note: pick, say it, what the agent gets, it asks back, done.
//   node tools/make-store-shots.mjs      → docs/store/screenshot-1-pick.png … screenshot-5-done.png
// The agent is played through the bridge's HTTP API, as in tools/make-demo-video.mjs. The headline
// band at the top and the "what your agent gets" card are ours and look it; the rest is Pinpoint.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO, sleep, serveDemo, startBridge, launch, inShadow, waitShadow, shadowPoint } from "./demo-kit.mjs";

const PORT = 7970, SITE = 8970, W = 1280, H = 800;
const OUT = path.join(REPO, "docs/store");
fs.mkdirSync(OUT, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-store-"));
let bridge;

const api = (p, body) => fetch(bridge.base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
async function until(fn, what, timeout = 12000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error("timed out waiting for " + what); await sleep(100); }
}

// Our headline band, at the top (or the bottom, where Pinpoint's panel needs the top) so it never
// covers Pinpoint's UI.
const headline = (page, title, sub, bottom = false) => page.evaluate(([title, sub, bottom]) => {
  document.getElementById("__store_head")?.remove();
  const el = document.createElement("div");
  el.id = "__store_head";
  el.style.cssText = `position:fixed;left:0;right:0;${bottom ? "bottom" : "top"}:0;height:84px;` + "z-index:2147483646;background:#121212;display:flex;align-items:center;gap:18px;padding:0 40px;" +
    "font-family:Inter,'Helvetica Neue',Arial,sans-serif;pointer-events:none;box-shadow:0 1px 0 #2a2a2a";
  el.innerHTML = `<svg width="30" height="30" viewBox="-3 -1 30 30"><path d="M12 27.56 L4.22 19.78 A11 11 0 1 1 19.78 19.78 Z" fill="#c6f432" stroke="#121212" stroke-width="1.5"/><circle cx="12" cy="12" r="3.6" fill="#121212"/></svg>` +
    `<div><div style="color:#fff;font-size:25px;font-weight:700;letter-spacing:-.01em">${title}</div><div style="color:#c6f432;font-size:15px;margin-top:2px">${sub}</div></div>`;
  document.documentElement.appendChild(el);
  document.body.style.paddingTop = bottom ? "" : "84px";
}, [title, sub, bottom]);

const shot = async (page, n, name) => {
  await sleep(500);
  const f = path.join(OUT, `screenshot-${n}-${name}.png`);
  await page.screenshot({ path: f });
  console.log("wrote " + path.relative(REPO, f));
};

async function main() {
  const site = await serveDemo(SITE);
  bridge = await startBridge(PORT, HOME, { PINPOINT_AFTER_DELAY: "1200" });
  const ctx = await launch({ port: PORT, token: bridge.token, viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`http://localhost:${SITE}/`);
  await waitShadow(page, () => !!__pinpointShadow.querySelector(".dock"));
  await waitShadow(page, () => __pinpointShadow.querySelector(".toast").style.display === "none", null, { timeout: 8000 }).catch(() => {});
  const target = page.locator(".hero .cta .btn.primary");

  // 1. pick
  await headline(page, "Point at the thing you mean", "Press ⌥⇧A on your local dev site and hover — Pinpoint names exactly what you'll pick");
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await sleep(900);
  await shot(page, 1, "pick");

  // 2. say it
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");
  await waitShadow(page, () => __pinpointShadow.activeElement?.tagName === "TEXTAREA", null, { timeout: 4000 });
  await page.keyboard.type("Make this stand out more — it's the main action on the page", { delay: 8 });
  await headline(page, "Say what should change, in your own words", "How it looks or what it does — the element is where your agent starts, not the limit");
  await shot(page, 2, "say-it");

  // 3. what the agent gets
  await inShadow(page, () => __pinpointShadow.querySelector(".pop .send").click()).catch(() => {});
  const p = await shadowPoint(page, ".pop .send").catch(() => null);
  if (p) await page.mouse.click(p.x, p.y);
  const [a] = await until(async () => {
    const l = (await api("/annotations?status=pending&images=1")).annotations;
    return l.length && l[0].screenshot ? l : null;
  }, "the note and its crop");
  for (let i = 0; i < 5 && await page.evaluate(() => document.documentElement.classList.contains("pinpoint-picking")); i++) { await page.keyboard.press("Escape"); await sleep(250); }
  await page.mouse.move(1000, 700);
  const st = a.element.styles || {};
  await page.evaluate((a) => {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const row = (k, v) => `<div><span style="color:#5cc8ff">${k}</span> ${esc(v)}</div>`;
    const el = document.createElement("div");
    el.id = "__store_agent";
    el.style.cssText = "position:fixed;right:40px;bottom:40px;z-index:2147483646;width:560px;padding:18px 20px;border-radius:14px;pointer-events:none;" +
      "background:#0d0f12;color:#d8dce2;font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 22px 60px rgba(0,0,0,.4);border:1px solid #2a2f37";
    el.innerHTML = `<div style="color:#8a929e;margin-bottom:8px">Claude Code ← get_pending_annotations</div>` +
      `<div><span style="color:#5cc8ff">comment </span> <span style="color:#c6f432">"${esc(a.comment)}"</span></div>` +
      row("selector", a.selector) + row("styles  ", a.styles) + row("source  ", a.source) + row("crop    ", a.crop);
    document.documentElement.appendChild(el);
  }, {
    comment: a.comment,
    selector: a.element.selector,
    styles: ["background-color", "font-size", "padding"].filter((k) => st[k]).map((k) => `${k}: ${st[k]}`).join("; ") || "computed styles",
    source: a.source?.file ? `${a.source.file}${a.source.line ? ":" + a.source.line : ""}` : (a.source?.components || []).join(" › ") || "plain HTML here (React/Vue add the component chain + file:line)",
    crop: `${a.screenshot.width}×${a.screenshot.height} png of just the element`,
  });
  await headline(page, "Your agent gets the element, not a guess", "Selector, computed styles, component chain, source-file hint and a crop — over MCP or hooks");
  await shot(page, 3, "agent-gets");
  await page.evaluate(() => document.getElementById("__store_agent")?.remove());

  // 4. it asks back
  await api(`/annotations/${a.id}/reply`, { text: "Bigger, or a stronger colour, or both?", by: "claude-code" });
  await waitShadow(page, () => /asks/.test(__pinpointShadow.querySelector(".toast").textContent) && __pinpointShadow.querySelector(".toast").style.display !== "none", null, { timeout: 8000 });
  const t = await shadowPoint(page, ".toast");
  await page.mouse.click(t.x, t.y);
  await waitShadow(page, () => __pinpointShadow.querySelector(".panel .item.waiting form textarea"));
  await inShadow(page, () => __pinpointShadow.querySelector(".panel .item.waiting form textarea").focus());
  await page.keyboard.type("Both — bigger, with a lift so it reads as the main button", { delay: 8 });
  await page.mouse.move(700, 600);
  await headline(page, "It asks before it guesses", "Answer right on the page; the note goes back to your agent with the whole conversation", true);
  await shot(page, 4, "asks-back");
  const go = await shadowPoint(page, ".panel .item.waiting form .go");
  await page.mouse.click(go.x, go.y);
  await until(async () => (await api(`/annotations/${a.id}`)).annotation.status === "pending", "the answer");
  const close = await shadowPoint(page, ".panel h2 .close");
  await page.mouse.click(close.x, close.y);

  // 5. done: the change, the reply, Accept / Not quite, before and after
  await page.evaluate(() => {
    document.querySelector(".hero .cta .btn.primary").style.cssText = "font-size:20px;padding:18px 36px;box-shadow:0 12px 28px rgba(15,118,110,.45),0 0 0 4px #ccfbf1";
  });
  await sleep(400);
  await api(`/annotations/${a.id}/resolve`, { note: "Hero CTA is 20px with more padding, a lifted shadow and a soft ring (.hero .cta .btn.primary)", by: "claude-code" });
  await until(async () => (await api(`/annotations/${a.id}`)).annotation.after, "the after crop");
  await waitShadow(page, () => __pinpointShadow.querySelector(".toast .ok")?.offsetParent, null, { timeout: 8000 });
  const ok = await shadowPoint(page, ".toast .ok");
  await page.mouse.move(ok.x, ok.y);   // the done card holds while the pointer is on it
  const full = (await api(`/annotations/${a.id}`)).annotation;
  await page.evaluate(([b, af]) => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:40px;top:470px;z-index:2147483646;display:flex;gap:18px;padding:18px;border-radius:14px;pointer-events:none;" +
      "background:#0d0f12;box-shadow:0 18px 50px rgba(0,0,0,.35);font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8a929e";
    for (const [label, s] of [["before", b], ["after", af]]) {
      const f = document.createElement("figure");
      f.style.cssText = "margin:0;display:grid;gap:8px;align-content:end";
      f.innerHTML = `<img style="height:${Math.round(s.height * 1.4)}px;border-radius:8px;background:#fff" src="data:image/png;base64,${s.base64}"><figcaption>${label}</figcaption>`;
      f.querySelector("figcaption").style.color = label === "after" ? "#c6f432" : "#8a929e";
      el.appendChild(f);
    }
    document.documentElement.appendChild(el);
  }, [full.screenshot, full.after.screenshot]);
  await headline(page, "See what changed, then Accept — or send it back", "Your agent's own note on what it did, with before and after crops kept on the note");
  await shot(page, 5, "done");

  await ctx.close();
  bridge.proc.kill();
  site.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}

main().catch((e) => { console.error(String(e.stack || e)); bridge?.proc.kill(); process.exit(1); });
