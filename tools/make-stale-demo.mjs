// Records docs/stale-demo.gif: the difference between a pin that re-finds its element after the
// page rebuilds it, and a pin whose element is genuinely not there any more.
//
//   node tools/make-stale-demo.mjs        (needs test/node_modules — cd test && npm install)
//   PINPOINT_DEMO_PORT / PINPOINT_DEMO_SITE move its bridge (7402) and the demo site (8124).
//
// It drives the real extension against demo/index.html, whose tab panel replaces its whole body
// with innerHTML on every switch. Two notes are left on two different tabs, so whichever tab is
// open, one pin has re-found its element and the other has admitted it is not on this view — the
// contrast the recording is for. The last beat asks the bridge to re-check both, and shows the
// verdicts an agent would get.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO, sleep, serveDemo, startBridge, launch, inShadow, waitShadow, caption } from "./demo-kit.mjs";

const PORT = Number(process.env.PINPOINT_DEMO_PORT) || 7402, SITE = Number(process.env.PINPOINT_DEMO_SITE) || 8124;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-demo-"));
const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), "pp-frames-"));
const FPS = 8;
let n = 0, last = null, bridge = null;

// ---------- recording ----------
async function cap(page) {
  await toastGone(page);
  const file = path.join(FRAMES, String(n++).padStart(4, "0") + ".png");
  await page.screenshot({ path: file });
  last = file;
}
function hold(seconds) {
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    fs.copyFileSync(last, path.join(FRAMES, String(n++).padStart(4, "0") + ".png"));
  }
}

async function main() {
  const site = await serveDemo(SITE);
  bridge = await startBridge(PORT, HOME);
  const ctx = await launch({ port: PORT, token: bridge.token, viewport: { width: 1100, height: 720 } });

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${SITE}/`);
  await waitShadow(page, () => !!__pinpointShadow.querySelector(".dock"));
  await page.evaluate(() => document.querySelector(".tabs")?.scrollIntoView({ block: "center" }));
  await sleep(600);

  await toastGone(page);
  await caption(page, "A pin is anchored to an element — not to a position on the page.");
  await cap(page); hold(2.2);

  // --- note 1, on the Route tab ---
  await mark(page, page.locator("#panelBody .row .v").first(), "spell out the terminal name", "Note 1 on the Route tab.");
  await caption(page, "Note 1 sits on a row inside a panel that rebuilds itself on every tab switch.");
  await cap(page); hold(2);

  // --- switch: the panel is replaced wholesale ---
  await caption(page, "Switching tabs replaces the whole panel with new nodes…");
  await cap(page); hold(1.2);
  await page.evaluate(() => document.querySelector(".tabs").scrollIntoView({ block: "center" }));
  await sleep(400);
  await page.locator('.tab[data-tab="costs"]').click();
  await panelShows(page, "Freight");
  await pinState(page, 1, "gone");
  await sleep(300);
  await cap(page);
  await toastGone(page);
  await caption(page, "…so note 1 has nothing to sit on here. It hides rather than pick a stranger.", "bad");
  await cap(page); hold(2.4);

  // --- note 2, on the Costs tab ---
  await panelShows(page, "Total landed");
  await mark(page, page.locator("#panelBody .row .v").last(), "show the currency next to this", "Note 2 on the Costs tab.");
  await caption(page, "Note 2 is left here, on the Costs tab.");
  await cap(page); hold(1.6);
  await notes(page, true);
  console.log(`  · frame ${n}: the list on Costs`);
  await caption(page, "The list says which is which: note 2 on its element, note 1 not on this view.", "bad");
  await cap(page); hold(3);
  await notes(page, false);

  // --- back: note 1 recovers on a node that did not exist a moment ago ---
  await caption(page, "Back to Route. This panel was rebuilt from scratch — every node is new.");
  await cap(page); hold(1.6);
  await page.evaluate(() => document.querySelector(".tabs").scrollIntoView({ block: "center" }));
  await sleep(400);
  await page.locator('.tab[data-tab="route"]').click();
  await panelShows(page, "Rotterdam");
  await pinState(page, 1, "found");
  await pinState(page, 2, "gone");
  await sleep(300);
  await cap(page);
  await toastGone(page);
  await caption(page, "Note 1 found its element again by identity, not by position.", "good");
  await cap(page); hold(2.4);
  await notes(page, true);
  console.log(`  · frame ${n}: the notes list, back on Route`);
  await caption(page, "Same list, the other way round now: note 2 is the one that is not here.", "good");
  await cap(page); hold(2.8);
  await notes(page, false);

  // --- the agent's side ---
  const { annotations } = await (await fetch(BASE + "/annotations?status=pending")).json();
  const [one, two] = annotations;
  const verdict = async (a) => {
    const r = await (await fetch(`${BASE}/annotations/${a.id}/recheck?timeout=8000`, { method: "POST" })).json();
    return r.result?.element ? (r.result.selectorStillMatches === false ? "moved" : "still there") : "gone";
  };
  const v1 = await verdict(one), v2 = await verdict(two);
  await caption(page, `An agent asking right now: note 1 → ${v1}.  note 2 → ${v2}.`);
  await cap(page); hold(3.4);
  await caption(page, "recheck_annotation returns that verdict with a fresh crop, before anything is edited.");
  await cap(page); hold(3);

  await ctx.close();
  bridge.proc.kill();
  site.close();
  encode();
}

async function mark(page, locator, comment, caption1) {
  await caption(page, caption1);
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(() => document.documentElement.classList.contains("pinpoint-picking"));
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await cap(page);
  await locator.click();
  await waitShadow(page, () => __pinpointShadow.querySelector(".pop").style.display === "block");
  await cap(page);
  // Typed in chunks so the recording shows it being written, not appearing.
  for (const part of chunks(comment)) {
    await inShadow(page, (c) => { const t = __pinpointShadow.querySelector("textarea"); t.value += c; t.focus(); }, part);
    await cap(page);
  }
  hold(0.6);
  await inShadow(page, () => __pinpointShadow.querySelector(".send").click());
  await waitShadow(page, () => /Sent/.test(__pinpointShadow.querySelector(".pop .status").textContent));
  await stopPicking(page);
  await sleep(900); // let the crop finish and the popover close
  await cap(page);
  const { annotations } = await (await fetch(BASE + "/annotations?status=pending")).json();
  console.log(`  · marked "${comment}" → ${annotations.length} note(s) in the bridge`);
}

// Escape while the caret is in the comment box only closes the popover. Click the page first,
// then press it, then check — a recording made while the picker is still armed films the picker
// eating every click.
const toastGone = (page) => waitShadow(page, () => __pinpointShadow.querySelector(".toast").style.display === "none",
  null, { timeout: 6000 }).catch(() => {});

// The notes list is where the two states are stated in words — one note on its element, one
// admitting it is not on this view. That is the whole point of the recording, so show it.
async function notes(page, open) {
  await inShadow(page, (open) => {
    const r = __pinpointShadow;
    const isOpen = r.querySelector(".panel").style.display === "flex";
    if (isOpen !== open) r.querySelector(".dock .count").click();
  }, open);
  await sleep(450);
}

async function stopPicking(page) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("Escape");
    await sleep(250);
    const picking = await page.evaluate(() => document.documentElement.classList.contains("pinpoint-picking"));
    if (!picking) return;
  }
  throw new Error("could not leave picking mode — the recording would be nonsense");
}

// The states this demo exists to show, waited for rather than hoped for.
const panelShows = (page, text) => page.waitForFunction((t) => document.getElementById("panelBody").textContent.includes(t), text, { timeout: 5000 });
const pinDump = (page) => inShadow(page, () => [...__pinpointShadow.querySelectorAll(".pin")]
  .map((p) => ({ n: p.textContent, orphan: p.dataset.orphan === "1", display: p.style.display })));
const pinState = async (page, n, want) => pinStateWait(page, n, want).catch(async (e) => {
  console.error("  pins were:", JSON.stringify(await pinDump(page)));
  throw e;
});
const pinStateWait = (page, n, want) => waitShadow(page, ([n, want]) => {
  const pin = [...__pinpointShadow.querySelectorAll(".pin")].find((p) => p.textContent === String(n));
  if (!pin) return false;
  return want === "gone" ? pin.dataset.orphan === "1" : pin.dataset.orphan !== "1";
}, [n, want], { timeout: 8000 });

const chunks = (s) => s.match(/.{1,12}/g) || [s];

function encode() {
  const out = path.join(REPO, "docs", "stale-demo.gif");
  const pal = path.join(FRAMES, "palette.png");
  const input = ["-framerate", String(FPS), "-i", path.join(FRAMES, "%04d.png")];
  execFileSync("ffmpeg", ["-v", "error", "-y", ...input, "-vf", "scale=900:-1:flags=lanczos,palettegen=max_colors=128", pal]);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...input, "-i", pal,
    "-lavfi", "scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3", out]);
  console.log(`▸ ${out}  (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${n} frames)`);
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
}
main().catch(async (e) => {
  console.error(String(e.message || e));
  bridge?.proc.kill();
  process.exit(1);
});
