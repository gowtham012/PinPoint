// Firefox: the native host manifest and the AMO package. Pure node, no browser.
// Run: node --test ship-firefox.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installNativeHost, detectBrowsers, HOST_NAME, FIREFOX_ID } from "../bridge/native-host.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
// The wrapper is a #!/bin/sh script and native messaging installs are macOS/Linux only.
const posix = { skip: process.platform === "win32" && "native messaging install is macOS/Linux only" };

test("Firefox on macOS gets its own manifest with allowed_extensions, merged and uninstalled", posix, () => {
  const root = tmp("pp-ff-mac-");
  fs.mkdirSync(path.join(root, "Firefox"), { recursive: true });
  const file = path.join(root, "Mozilla", "NativeMessagingHosts", `${HOST_NAME}.json`);
  // Another add-on already registered under the same host name must survive us.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ allowed_extensions: ["other@example.com"] }));
  const opts = { root, platform: "darwin", wrapperPath: path.join(root, "pinpoint-host.sh") };

  const r = installNativeHost(opts);
  assert.deepEqual(r.browsers, ["Firefox"], "Firefox alone is enough — no Chromium needed");
  assert.deepEqual(r.files, [file]);
  const m = read(file);
  assert.equal(m.name, HOST_NAME);
  assert.equal(m.type, "stdio");
  assert.equal(m.path, opts.wrapperPath);
  assert.deepEqual(m.allowed_extensions, ["other@example.com", FIREFOX_ID].sort());
  assert.equal(m.allowed_origins, undefined, "Firefox reads allowed_extensions, not chrome-extension origins");

  installNativeHost(opts);
  assert.equal(read(file).allowed_extensions.length, 2, "re-running does not duplicate the id");

  const gone = installNativeHost({ ...opts, uninstall: true });
  assert.ok(gone.removed.includes(file));
  assert.ok(!fs.existsSync(path.join(root, "Mozilla", "Firefox")), "never creates a browser directory");
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
});

test("Firefox on Linux: ~/.mozilla/firefox → ~/.mozilla/native-messaging-hosts, next to Chrome", posix, () => {
  const root = tmp("pp-ff-linux-");
  fs.mkdirSync(path.join(root, ".mozilla", "firefox"), { recursive: true });
  fs.mkdirSync(path.join(root, ".config", "google-chrome"), { recursive: true });
  const r = installNativeHost({ root, platform: "linux", wrapperPath: path.join(root, "pinpoint-host.sh") });
  assert.deepEqual(r.browsers.sort(), ["Chrome", "Firefox"]);
  const ff = path.join(root, ".mozilla", "native-messaging-hosts", `${HOST_NAME}.json`);
  assert.deepEqual(read(ff).allowed_extensions, [FIREFOX_ID]);
  const chrome = path.join(root, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
  assert.ok(read(chrome).allowed_origins.length >= 2);
  assert.equal(read(chrome).allowed_extensions, undefined);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
});

test("detectBrowsers stays Chromium-only: setup's Load unpacked steps do not apply to Firefox", () => {
  const root = tmp("pp-ff-detect-");
  fs.mkdirSync(path.join(root, "Firefox"), { recursive: true });
  assert.deepEqual(detectBrowsers({ platform: "darwin", root }), []);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
});

const zipOk = { skip: process.platform === "win32" && "bash + zip scripts" };

test("make-firefox-zip.sh builds an AMO package from the same extension/", zipOk, () => {
  const out = tmp("pp-ff-zip-");
  const zip = path.join(out, "ff.zip");
  execFileSync("bash", [path.resolve(here, "../tools/make-firefox-zip.sh"), zip], { stdio: "pipe" });
  const m = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
  const src = read(path.resolve(here, "../extension/manifest.json"));
  assert.equal(m.version, src.version);
  assert.ok(m.name.length <= 45, "AMO refuses a longer name");
  assert.equal(m.key, undefined, "AMO assigns ids from the gecko id, not a key");
  assert.deepEqual(m.background, { scripts: ["background.js"] }, "Firefox has no MV3 service workers");
  const g = m.browser_specific_settings.gecko;
  assert.equal(g.id, FIREFOX_ID);
  assert.equal(g.strict_min_version, "140.0");
  assert.ok(Array.isArray(g.data_collection_permissions.required) && g.data_collection_permissions.required.length);
  const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(files.includes("background.js") && files.includes("popup.html"));
  assert.ok(!files.some((f) => f.endsWith(".DS_Store")));
  fs.rmSync(out, { recursive: true, force: true, maxRetries: 10 });
});

test("make-cws-zip.sh still builds the Chrome/Edge package with the key stripped", zipOk, () => {
  const out = tmp("pp-cws-zip-");
  const zip = path.join(out, "cws.zip");
  execFileSync("bash", [path.resolve(here, "../tools/make-cws-zip.sh"), zip], { stdio: "pipe" });
  const m = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
  assert.equal(m.key, undefined);
  assert.equal(m.background.service_worker, "background.js");
  assert.equal(m.browser_specific_settings, undefined);
  fs.rmSync(out, { recursive: true, force: true, maxRetries: 10 });
});
