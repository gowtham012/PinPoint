// Bridge tests for before/after on resolve. Run: node --test ui-after.test.mjs
// In-process daemons on OS-assigned ports; a small stand-in for the extension answers the rechecks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-after-"));
process.env.PINPOINT_HOME = HOME; // read by store.js at import time
const { startDaemon } = await import("../bridge/daemon.js");
const { bridgeToken } = await import("../bridge/store.js");

const shot = (s) => ({ base64: Buffer.from(s).toString("base64"), width: 20, height: 10 });
let d, BASE, EXT, stopExt;
// The extension: long-polls /events and answers every recheck with a fresh crop, like background.js.
let asked = 0;
const gone = new Set(); // ids whose element the page no longer has
function fakeExtension(base) {
  let on = true;
  const run = (async () => {
    let since = 0;
    while (on) {
      const r = await fetch(`${base}/events?since=${since}&timeout=500`, { headers: EXT }).then((x) => x.json()).catch(() => null);
      if (!r) { await new Promise((res) => setTimeout(res, 50)); continue; }
      since = r.version;
      for (const q of r.rechecks || []) {
        asked++;
        const body = gone.has(q.id) ? { status: "ok", element: null }
          : { status: "ok", element: { tag: "h1", text: "new" }, selectorStillMatches: true, screenshot: shot("after-" + q.id) };
        await fetch(`${base}/rechecks/${q.reqId}`, { method: "POST", headers: { ...EXT, "content-type": "application/json" }, body: JSON.stringify(body) });
      }
    }
  })();
  return async () => { on = false; await run; };
}
before(async () => {
  d = await startDaemon({ port: 0, quiet: true, afterDelay: 150 });
  BASE = `http://127.0.0.1:${d.server.address().port}`;
  EXT = { origin: "chrome-extension://pinpoint", "x-pinpoint-token": bridgeToken() };
  stopExt = fakeExtension(BASE);
});
after(async () => {
  await stopExt();
  d.server.closeAllConnections?.(); await d.close();
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 });
});

function sample(over = {}) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    comment: "bigger headline",
    page: { url: "http://localhost:3000/page", title: "T", viewport: { width: 1200, height: 800, dpr: 1 }, scroll: { x: 0, y: 0 } },
    element: { tag: "h1", selector: "h1", domPath: "body > h1", text: "old", outerHTML: "<h1>old</h1>", attributes: {}, rect: { x: 0, y: 0, width: 100, height: 40 }, styles: {} },
    source: { framework: null, components: [], file: null, attributes: {} },
    screenshot: shot("before"),
    ...over,
  };
}
const post = (p, body, headers = {}) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const full = async (id) => (await (await fetch(`${BASE}/annotations/${id}`)).json()).annotation;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(50); }
}

test("a resolve is followed by an after crop, kept next to the before one", async () => {
  const { id } = await post("/annotations", sample());
  await post(`/annotations/${id}/resolve`, { note: "48px now" });
  const a = await until(async () => (await full(id)).after);
  assert.ok(a, "after stored");
  assert.equal(a.screenshot.base64, shot("after-" + id).base64);
  assert.equal((await full(id)).screenshot.base64, shot("before").base64, "before untouched");
  assert.ok((await full(id)).element.recheckedAt, "the recheck is recorded");
  // the list carries its size, never its pixels
  const listed = (await (await fetch(`${BASE}/annotations?status=resolved`)).json()).annotations.find((x) => x.id === id);
  assert.equal(listed.after.screenshot.base64, undefined);
  assert.equal(listed.after.screenshot.width, 20);
});

test("reopened before the delay is up: no after crop", async () => {
  const { id } = await post("/annotations", sample());
  await post(`/annotations/${id}/resolve`, { note: "done" });
  await post(`/annotations/${id}/answer`, { text: "not quite" });
  await sleep(600);
  assert.equal((await full(id)).after, undefined);
});

test("a page that is not http(s) or file is never looked at", async () => {
  const n = asked;
  const { id } = await post("/annotations", sample({ page: { url: "ios-simulator://iPhone/app", title: "", viewport: { width: 1, height: 1, dpr: 1 }, scroll: { x: 0, y: 0 } } }));
  await post(`/annotations/${id}/resolve`, { note: "done" });
  await sleep(600);
  assert.equal(asked, n, "no recheck was asked for");
  assert.equal((await full(id)).after, undefined);
});

test("asking for an after crop: only a done note, only the extension with its token", async () => {
  const { id } = await post("/annotations", sample());
  assert.equal((await post(`/annotations/${id}/after`, {}, EXT)).ok, false, "a pending note has no after");
  await post(`/annotations/${id}/resolve`, { note: "done" });
  const r = await fetch(`${BASE}/annotations/${id}/after`, { method: "POST", headers: { origin: "chrome-extension://someoneelse" } });
  assert.equal(r.status, 401);
});

test("re-checking from the agent records when it was done", async () => {
  const { id } = await post("/annotations", sample());
  const r = await post(`/annotations/${id}/recheck?timeout=3000`);
  assert.equal(r.result.status, "ok");
  assert.ok((await full(id)).element.recheckedAt);
});

test("after crops are kept for the newest twenty done notes only", async () => {
  await fetch(BASE + "/annotations", { method: "DELETE" });
  const ids = [];
  for (let i = 0; i < 22; i++) {
    const { id } = await post("/annotations", sample());
    await post(`/annotations/${id}/resolve`, { note: "done " + i });
    assert.ok(await until(async () => (await full(id)).after), `after for ${i}`);
    ids.push(id);
  }
  const all = await Promise.all(ids.map(full));
  assert.equal(all.filter((a) => a.after?.screenshot).length, 20);
  assert.equal(all[0].after.screenshot, undefined, "the oldest lost its pixels");
  assert.ok(all[0].after.at, "but keeps the record, so the panel does not ask again");
  assert.ok(all[21].after.screenshot);
});

test("no extension seen: a resolve asks the browser nothing; the panel opening asks later", async () => {
  const quiet = await startDaemon({ port: 0, quiet: true, afterDelay: 50 });
  const Q = `http://127.0.0.1:${quiet.server.address().port}`;
  let stop = null;
  try {
    const { id } = await fetch(Q + "/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample()) }).then((r) => r.json());
    await fetch(`${Q}/annotations/${id}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "done" }) });
    await sleep(300);
    assert.deepEqual((await fetch(`${Q}/events?since=0&timeout=1`).then((r) => r.json())).rechecks, []);
    // the browser comes back and the panel shows this done note, which has no after yet
    stop = fakeExtension(Q);
    const r = await fetch(`${Q}/annotations/${id}/after`, { method: "POST", headers: EXT }).then((x) => x.json());
    assert.equal(r.ok, true);
    const a = await until(async () => (await (await fetch(`${Q}/annotations/${id}`)).json()).annotation.after);
    assert.equal(a?.screenshot?.base64, shot("after-" + id).base64);
  } finally { await stop?.(); quiet.server.closeAllConnections?.(); await quiet.close(); }
});

// The panel asks too, as soon as the done card shows — usually well inside the dev server's rebuild.
test("the panel asking for an after: it waits out the rebuild delay, and a note done long ago is left alone", async () => {
  const q = await startDaemon({ port: 0, quiet: true, afterDelay: 600, afterWindow: 1500 });
  const Q = `http://127.0.0.1:${q.server.address().port}`;
  const make = async () => (await fetch(Q + "/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample()) }).then((r) => r.json())).id;
  const resolve = (id) => fetch(`${Q}/annotations/${id}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const ask = async (id) => (await fetch(`${Q}/annotations/${id}/after`, { method: "POST", headers: EXT }).then((x) => x.json())).ok;
  const get = async (id) => (await (await fetch(`${Q}/annotations/${id}`)).json()).annotation;
  let stop = null;
  try {
    // resolved while no browser was around, so only the panel's request can bring the after
    const fresh = await make(), old = await make();
    await resolve(old);
    await sleep(1600);
    await resolve(fresh);
    stop = fakeExtension(Q);
    await sleep(100);
    const n = asked;
    assert.equal(await ask(fresh), true);
    await sleep(200);
    assert.equal(asked, n, "not looked at before the delay is up");
    assert.ok(await until(async () => (await get(fresh)).after?.screenshot), "looked at once it is");
    assert.equal(await ask(old), false, "resolved too long ago: today's page is not its after");
    await sleep(700);
    assert.equal((await get(old)).after, undefined);
  } finally { await stop?.(); q.server.closeAllConnections?.(); await q.close(); }
});

test("an element that is gone is recorded as such, so the panel stops asking for it", async () => {
  const { id } = await post("/annotations", sample());
  gone.add(id);
  await post(`/annotations/${id}/resolve`, { note: "removed it" });
  const a = await until(async () => (await full(id)).after);
  assert.equal(a?.missing, true);
  assert.ok(!a.screenshot);
  const n = asked;
  assert.equal((await post(`/annotations/${id}/after`, {}, EXT)).ok, false);
  await sleep(300);
  assert.equal(asked, n);
});
