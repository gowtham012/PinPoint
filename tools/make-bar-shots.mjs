// Recapture the README's three screenshots of the on-page bar (docs/images/bar-*.png) from the
// real extension: idle, settled to its mark, and picking. Run after a change to the bar or the logo.
//   node tools/make-bar-shots.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO, serveDemo, startBridge, launch, inShadow, waitShadow, sleep } from "./demo-kit.mjs";

const PORT = 7960, SITE = 8960;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-bar-"));
const site = await serveDemo(SITE);
const bridge = await startBridge(PORT, HOME);
const ctx = await launch({ port: PORT, token: bridge.token, deviceScaleFactor: 2, viewport: { width: 1100, height: 700 } });
try {
  const page = await ctx.newPage();
  // A blank local page, so nothing of a site shows around the bar.
  await page.route("**/blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>blank</title><body style='background:#fff'>" }));
  await page.goto(`http://localhost:${SITE}/blank`);
  await waitShadow(page, () => __pinpointShadow.querySelector(".dock").style.display === "flex");
  // The dock is in a closed shadow root, so crop by its rectangle plus a margin for the shadow.
  const snap = async (name) => {
    await sleep(400);   // let width transitions finish
    const r = await inShadow(page, () => { const b = __pinpointShadow.querySelector(".dock").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
    const m = 10;
    await page.screenshot({ path: path.join(REPO, "docs/images", name), clip: { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m } });
    console.log("wrote docs/images/" + name);
  };
  await page.mouse.move(500, 400);
  await snap("bar-idle.png");
  await waitShadow(page, () => __pinpointShadow.querySelector(".dock").classList.contains("mini"), null, { timeout: 20000 });
  await snap("bar-mini.png");
  await page.keyboard.press("Alt+Shift+A");
  await waitShadow(page, () => __pinpointShadow.querySelector(".dock").classList.contains("armed"));
  await snap("bar-armed.png");
} finally {
  await ctx.close();
  bridge.proc.kill();
  site.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
