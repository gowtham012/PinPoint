// Android emulator picking, the twin of ios.js: no DOM, so the element comes from the view tree
// `uiautomator dump` writes, and the screenshot from `screencap`. Both through plain adb — no
// driver to install, nothing kept running. The page at /android is the same one /ios serves.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseBounds, describe, pngSize, attrEsc } from "./ios.js";

const run = promisify(execFile);
const EXE = process.platform === "win32" ? "adb.exe" : "adb";

// Android Studio never puts adb on PATH, so the SDK is looked for where it installs it.
export function findAdb(env = process.env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const sdks = [
    env.ANDROID_HOME, env.ANDROID_SDK_ROOT,
    path.join(home, "Library/Android/sdk"), path.join(home, "Android/Sdk"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Android/Sdk"),
  ].filter(Boolean).map((d) => path.join(d, "platform-tools"));
  const dirs = [...sdks, ...String(env.PATH || "").split(path.delimiter).filter(Boolean)];
  return dirs.map((d) => path.join(d, EXE)).find((f) => fs.existsSync(f)) || null;
}

// What `setup` says before pointing anyone at /android.
export function androidReadiness() {
  return findAdb() ? [] : ["adb, from the Android SDK — install Android Studio, or set ANDROID_HOME to your SDK"];
}

// `adb devices` → the one device to read. Emulators only, unless ANDROID_SERIAL (adb's own variable)
// names one: a phone on the desk is somebody's real device and is never picked silently.
export function pickDevice(listing, serial = "") {
  const ready = String(listing).split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter(([s, state]) => s && state === "device").map(([s]) => s);
  const dev = (s) => ({ serial: s, emulator: s.startsWith("emulator-") });
  if (serial) {
    if (!ready.includes(serial)) throw new Error(`${serial} is not attached (ANDROID_SERIAL) — adb devices lists: ${ready.join(", ") || "nothing"}`);
    return dev(serial);
  }
  const emus = ready.filter((s) => s.startsWith("emulator-"));
  if (emus.length === 1) return dev(emus[0]);
  if (emus.length > 1) throw new Error(`more than one emulator is running (${emus.join(", ")}) — set ANDROID_SERIAL to the one to read and restart the bridge`);
  if (ready.length) throw new Error(`no emulator is running, only ${ready.join(", ")} — to read a physical device, set ANDROID_SERIAL to it and restart the bridge`);
  throw new Error("no Android emulator is running — start one from Android Studio's Device Manager, then open your app");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unescapeXml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== "#") return ENTITIES[e] ?? m;
  const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; // labels come from the app: never throw on one
});

// uiautomator's XML, flattened like ios.js's tree: every node with a size, carrying its ancestry.
// Not a general XML parser — the dump is one flat vocabulary of <node .../> with quoted attributes.
export function parseHierarchy(xml) {
  const out = [], trails = [[]];
  const tags = /<node\b((?:[^>"]|"[^"]*")*?)(\/?)>|<\/node>/g;
  for (let m; (m = tags.exec(xml));) {
    if (!m[0].startsWith("<node")) { if (trails.length > 1) trails.pop(); continue; }
    const a = {};
    for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = unescapeXml(v);
    const n = {
      id: (a["resource-id"] || "").replace(/^.*:id\//, ""),
      label: a["content-desc"] || "",
      text: a.text || "",
      class: a.class || "",
      bounds: parseBounds(a.bounds),
    };
    const trail = trails.at(-1);
    const here = n.id || n.label || n.text ? [...trail, describe(n)] : trail;
    if (n.bounds && n.bounds.width > 0 && n.bounds.height > 0) out.push({ ...n, path: here.join(" > ") || "screen" });
    if (!m[2]) trails.push(here);
  }
  return out;
}

const pageUrl = (device) => `${device.emulator ? "android-emulator" : "android-device"}://${device.name}`;

export async function snapshot(serial = process.env.ANDROID_SERIAL) {
  const adb = findAdb() || EXE;
  let device;
  const sh = (args, opts = {}) => run(adb, ["-s", device.serial, ...args], { maxBuffer: 64 << 20, timeout: 30000, ...opts });
  try {
    device = pickDevice((await run(adb, ["devices"], { timeout: 15000 })).stdout, serial);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("adb not found — install the Android SDK (Android Studio), or set ANDROID_HOME");
    throw e;
  }
  device.name = (await sh(device.emulator ? ["emu", "avd", "name"] : ["shell", "getprop", "ro.product.model"]).catch(() => ({ stdout: "" }))).stdout.split(/\r?\n/)[0].trim() || device.serial;

  // A file per call, so two picker tabs never read each other's dump.
  const file = `/sdcard/pp-${Math.random().toString(36).slice(2, 10)}.xml`;
  const dump = async () => {
    // A screen still animating has no idle state and uiautomator writes nothing; wait and retry.
    for (let i = 0; i < 4; i++) {
      await sh(["shell", "uiautomator", "dump", file]).catch(() => {});
      const xml = (await sh(["exec-out", "cat", file]).catch(() => ({ stdout: "" }))).stdout;
      if (xml.includes("<hierarchy")) return xml;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("uiautomator could not read the screen — is it still animating? Try Refresh");
  };
  // One after the other: the picture must be of the settled screen the dump finally read, and the
  // rm must come after the last dump that could write the file.
  let xml, png;
  try {
    xml = await dump();
    ({ stdout: png } = await sh(["exec-out", "screencap", "-p"], { encoding: "buffer" }));
  } finally {
    await sh(["shell", "rm", "-f", file]).catch(() => {});
  }
  const nodes = parseHierarchy(xml);
  if (!nodes.length) throw new Error("uiautomator returned an empty screen — is an app open in the emulator?");
  // uiautomator's bounds are in pixels, the screenshot's own unit, so the image is the viewport.
  const viewport = { ...pngSize(png), dpr: 1 };
  return { device, url: pageUrl(device), viewport, nodes, png: png.toString("base64") };
}

// A picked node as an annotation in the browser's shape, so every consumer downstream just works.
export function toAnnotation({ node, comment, device, viewport, id }) {
  const attrs = { "resource-id": node.id, "content-desc": node.label, text: node.text, class: node.class };
  const present = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v));
  // The values are the app's own strings: one line, quotes escaped, so the selector stays a selector.
  const q = (v) => String(v).replace(/\s+/g, " ").replace(/["\\]/g, "\\$&");
  const selector = node.id ? `[resource-id="${q(node.id)}"]` : node.label ? `[content-desc="${q(node.label)}"]` : node.text ? `[text="${q(node.text)}"]` : node.class || "view";
  const kind = device.emulator ? "Android emulator" : "Android device";
  return {
    id,
    comment,
    page: { url: pageUrl(device), title: `${kind} — ${device.name}`, viewport, scroll: { x: 0, y: 0 } },
    element: {
      tag: String(node.class || "view").split(".").pop(),
      selector,
      domPath: node.path,
      text: node.text || node.label || "",
      outerHTML: `<node ${Object.entries(present).map(([k, v]) => `${k}="${attrEsc(v)}"`).join(" ")} />`,
      attributes: present,
      rect: node.bounds,
      styles: {},
    },
    // No source map in a view tree: the resource-id (R.id.…, a Compose testTag) is what to grep.
    source: { framework: "android-native", components: [], file: null, line: null, attributes: node.id ? { "resource-id": node.id } : {} },
  };
}
