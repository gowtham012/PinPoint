// tools/edge-publish.sh against a stand-in for the Edge Add-ons API v1.1. Pure node, no browser.
// Run: node --test ship-edge.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../tools/edge-publish.sh");
const PORT = (Number(process.env.PINPOINT_TEST_PORT) || 7399) + 6;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pp-edge-"));
const ZIP = path.join(TMP, "x.zip");
fs.writeFileSync(ZIP, "PK fake zip");
const skip = { skip: process.platform === "win32" && "bash + curl + jq script; the release job runs on ubuntu" };

// What the fake API answers, per scenario; `seen` records every request for the assertions.
let plan, seen;
const server = http.createServer((req, res) => {
  let body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", () => {
    body = Buffer.concat(body);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.headers.authorization !== "ApiKey KEY" || req.headers["x-clientid"] !== "CLIENT") {
      res.writeHead(401); return res.end("{}");
    }
    const base = "/v1/products/PROD/submissions";
    if (req.method === "POST" && req.url === base + "/draft/package") {
      res.writeHead(202, { location: "up-1" }); return res.end();
    }
    if (req.method === "GET" && req.url === base + "/draft/package/operations/up-1") {
      const s = plan.upload.shift() || plan.uploadFinal;
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(s));
    }
    if (req.method === "POST" && req.url === base) {
      // Some deployments answer with a full URL in Location; the script must take the last segment.
      res.writeHead(202, { location: `https://api.example${base}/operations/pub-1` }); return res.end();
    }
    if (req.method === "GET" && req.url === base + "/operations/pub-1") {
      const s = plan.publish.shift() || plan.publishFinal;
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(s));
    }
    res.writeHead(404); res.end();
  });
});
before(() => new Promise((r) => server.listen(PORT, "127.0.0.1", r)));
after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10 }); });

const ok = (message = "ok") => ({ status: "Succeeded", message, errorCode: "", errors: null });
const failed = (errorCode, message = errorCode) => ({ status: "Failed", message, errorCode, errors: null });
const busy = { status: "InProgress", message: null, errorCode: null, errors: null };

function run(env = {}) {
  seen = [];
  return new Promise((res) => {
    const p = spawn("bash", [SCRIPT, ZIP], {
      env: { ...process.env, EDGE_PRODUCT_ID: "PROD", EDGE_CLIENT_ID: "CLIENT", EDGE_API_KEY: "KEY",
        EDGE_API_BASE: `http://127.0.0.1:${PORT}`, EDGE_POLL_SECONDS: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.once("exit", (code) => res({ code, out }));
  });
}

test("edge: upload, poll, submit, poll — and the zip and notes are what was sent", skip, async () => {
  plan = { upload: [busy, busy], uploadFinal: ok(), publish: [busy], publishFinal: ok("Successfully created submission") };
  const r = await run();
  assert.equal(r.code, 0, r.out);
  const up = seen.find((s) => s.method === "POST" && s.url.endsWith("/draft/package"));
  assert.equal(up.headers["content-type"], "application/zip");
  assert.equal(up.body.toString(), "PK fake zip");
  const pub = seen.find((s) => s.method === "POST" && s.url.endsWith("/submissions"));
  assert.ok(JSON.parse(pub.body.toString()).notes, "certification notes go with the submission");
  assert.equal(seen.filter((s) => s.url.includes("/operations/up-1")).length, 3, "polled until it left InProgress");
  assert.ok(seen.some((s) => s.url.endsWith("/operations/pub-1")), "operation id taken from a full-URL Location");
  assert.match(r.out, /Successfully created submission/);
});

test("edge: a submission already in review, or nothing new, is a notice, not a failure", skip, async () => {
  for (const code of ["InProgressSubmission", "NoModulesUpdated"]) {
    plan = { upload: [], uploadFinal: ok(), publish: [], publishFinal: failed(code) };
    const r = await run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`::notice::.*${code}`));
  }
});

test("edge: a failed upload or submission fails the job and prints why", skip, async () => {
  plan = { upload: [], uploadFinal: failed("PackageValidationError", "manifest is bad"), publish: [], publishFinal: ok() };
  let r = await run();
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::.*manifest is bad/);
  assert.ok(!seen.some((s) => s.method === "POST" && s.url.endsWith("/submissions")), "never submits a failed upload");

  plan = { upload: [], uploadFinal: ok(), publish: [], publishFinal: failed("SubmissionValidationError") };
  r = await run();
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::.*SubmissionValidationError/);
});

test("edge: a refused key says it expires and where to make a new one", skip, async () => {
  plan = { upload: [], uploadFinal: ok(), publish: [], publishFinal: ok() };
  const r = await run({ EDGE_API_KEY: "OLD" });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::.*401.*72 days.*EDGE_API_KEY/s);
  assert.doesNotMatch(r.out, /OLD/, "the key itself is never printed");
});

test("edge: missing secrets skip cleanly", skip, async () => {
  const r = await run({ EDGE_API_KEY: "" });
  assert.equal(r.code, 0);
  assert.match(r.out, /::notice::.*not set/);
  assert.equal(seen.length, 0, "nothing is sent");
});
