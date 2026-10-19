// Render every logo asset from tools/logo/mark.svg. Run via tools/make-icons.sh.
// Writes: extension icons, the bar's two marks (inlined into content.js), and docs/logo/
// (mark PNGs in every common size, favicons, wordmarks, social preview, store tiles).
import { chromium } from "../../test/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(REPO, "docs/logo");
fs.mkdirSync(OUT, { recursive: true });

const INK = "#121212", LIME = "#c6f432", PAPER = "#f6f6f2";
const master = fs.readFileSync(path.join(REPO, "tools/logo/mark.svg"), "utf8");
const inner = master.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
// The armed bar is lime, so its mark is the same pin inverted: ink body, lime dot.
const inverted = inner.replace(/#c6f432/g, "TMP").replace(/#121212/g, LIME).replace(/TMP/g, INK).replace(`stroke="${LIME}"`, `stroke="${INK}"`);
const svg = (body, pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-3 - pad} ${-1 - pad} ${30 + 2 * pad} ${30 + 2 * pad}">${body}</svg>`;
const wordmark = (fg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 196 40"><g transform="translate(2 5) scale(1)">${inner}</g>` +
  `<text x="40" y="28.5" font-family="'Inter','SF Pro Display','Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="25" letter-spacing="-0.4" fill="${fg}">Pinpoint</text></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(html, w, h, file) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  if (file) fs.writeFileSync(file, buf);
  return buf;
}
const img = (s, w, h) => `<img src="data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}" width="${w}" height="${h}" style="display:block">`;

// docs/logo: the mark in every common size, plus SVGs.
fs.writeFileSync(path.join(OUT, "pinpoint-mark.svg"), svg(inner) + "\n");
fs.writeFileSync(path.join(OUT, "pinpoint-mark-inverted.svg"), svg(inverted) + "\n");
fs.writeFileSync(path.join(OUT, "pinpoint-wordmark-light.svg"), wordmark(INK) + "\n");
fs.writeFileSync(path.join(OUT, "pinpoint-wordmark-dark.svg"), wordmark("#ffffff") + "\n");
for (const s of [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]) await shot(img(svg(inner), s, s), s, s, path.join(OUT, `pinpoint-mark-${s}.png`));
await shot(img(wordmark(INK), 980, 200), 980, 200, path.join(OUT, "pinpoint-wordmark-light.png"));
await shot(img(wordmark("#ffffff"), 980, 200), 980, 200, path.join(OUT, "pinpoint-wordmark-dark.png"));
// App-icon style: the pin on an ink rounded square (Safari app, avatars, store tiles).
const tile = (s) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.225}px;background:${INK};display:grid;place-items:center">${img(svg(inner), s * 0.66, s * 0.66)}</div>`;
for (const s of [128, 512, 1024]) await shot(tile(s), s, s, path.join(OUT, `pinpoint-app-icon-${s}.png`));
// Social preview (GitHub/OG 1280×640) and Chrome Web Store promo tiles.
const banner = (w, h, tag) => `<div style="width:${w}px;height:${h}px;background:${INK};display:flex;flex-direction:column;justify-content:center;padding:0 ${w * 0.08}px;box-sizing:border-box;font-family:Inter,'Helvetica Neue',Arial,sans-serif">` +
  `${img(wordmark("#ffffff"), h * 0.9, h * 0.18)}<div style="color:${LIME};font-size:${h * 0.065}px;font-weight:600;margin-top:${h * 0.05}px;letter-spacing:-.01em">${tag}</div></div>`;
const tag = "Point at your running app. Say what should change.";
await shot(banner(1280, 640, tag), 1280, 640, path.join(OUT, "pinpoint-social-preview-1280x640.png"));
await shot(banner(1400, 560, tag), 1400, 560, path.join(OUT, "pinpoint-cws-marquee-1400x560.png"));
await shot(banner(440, 280, "Annotate UI for your coding agent"), 440, 280, path.join(OUT, "pinpoint-cws-promo-440x280.png"));

// Extension icons.
for (const s of [16, 32, 48, 128]) await shot(img(svg(inner), s, s), s, s, path.join(REPO, `extension/icon${s}.png`));

// The bar's marks: 40px so they stay sharp at their 16px box on a 2x screen.
const uri = async (body) => "data:image/png;base64," + (await shot(img(svg(body), 40, 40), 40, 40)).toString("base64");
const content = path.join(REPO, "extension/content.js");
let text = fs.readFileSync(content, "utf8");
const set = (name, value) => {
  const re = new RegExp(`(--${name}: url\\(")[^"]*("\\))`);
  if (!re.test(text)) throw new Error(`--${name} not found in content.js`);
  text = text.replace(re, (_, a, b) => a + value + b);
};
set("mark-src", await uri(inner));
set("mark-armed", await uri(inverted));
fs.writeFileSync(content, text);
await browser.close();

// favicon.ico (32px) for anything that still asks for one.
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(OUT, "pinpoint-mark-32.png"), path.join(OUT, "favicon.ico")]);
console.log(`logos written to ${path.relative(REPO, OUT)}/ and extension/`);
