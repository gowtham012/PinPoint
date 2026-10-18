// Bridge tests for the UI lane: Accept / Not quite, and page context in the markdown. Run:
// node --test ui-bridge.test.mjs. The daemon runs in-process on an OS-assigned port, so this file
// never collides with another suite or another checkout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pp-ui-"));
process.env.PINPOINT_HOME = HOME; // read by store.js at import time
const { startDaemon } = await import("../bridge/daemon.js");
const { toMarkdown } = await import("../bridge/store.js");

let d, BASE;
before(async () => {
  d = await startDaemon({ port: 0, quiet: true });
  BASE = `http://127.0.0.1:${d.server.address().port}`;
});
after(async () => { d.server.closeAllConnections?.(); await d.close(); fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10 }); });

function sample(over = {}) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    comment: "make it purple",
    page: { url: "http://localhost:3000/page", title: "T", viewport: { width: 1200, height: 800, dpr: 2 }, scroll: { x: 0, y: 0 } },
    element: { tag: "button", selector: "#cta", domPath: "body > button#cta", text: "Buy", outerHTML: "<button id=cta>Buy</button>", attributes: {}, rect: { x: 1, y: 2, width: 100, height: 40 }, styles: {} },
    source: { framework: null, components: [], file: null, attributes: {} },
    ...over,
  };
}
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const get = async (id) => (await (await fetch(`${BASE}/annotations/${id}`)).json()).annotation;

test("accept only lands on a resolved note; reopening or re-resolving clears it", async () => {
  const { id } = await post("/annotations", sample());
  assert.equal((await post(`/annotations/${id}/accept`)).ok, false, "a pending note cannot be accepted");
  assert.equal((await get(id)).acceptedAt, undefined);

  await post(`/annotations/${id}/resolve`, { note: "done", by: "claude-code" });
  assert.equal((await post(`/annotations/${id}/accept`)).ok, true);
  assert.ok((await get(id)).acceptedAt, "accepted");

  await post(`/annotations/${id}/answer`, { text: "not quite" });
  let a = await get(id);
  assert.equal(a.status, "pending");
  assert.equal(a.acceptedAt, undefined, "Not quite takes the acceptance back");

  await post(`/annotations/${id}/resolve`, { note: "again" });
  await post(`/annotations/${id}/accept`);
  await post(`/annotations/${id}/resolve`, { note: "and again" });
  a = await get(id);
  assert.equal(a.acceptedAt, undefined, "a fresh resolve is a fresh answer, not yet accepted");

  assert.equal((await post(`/annotations/nope/accept`)).ok, false);
});

test("accept is refused to an extension origin without the token", async () => {
  const { id } = await post("/annotations", sample());
  await post(`/annotations/${id}/resolve`, { note: "done" });
  const r = await fetch(`${BASE}/annotations/${id}/accept`, { method: "POST", headers: { origin: "chrome-extension://someoneelse" } });
  assert.equal(r.status, 401);
  assert.equal((await get(id)).acceptedAt, undefined);
});
