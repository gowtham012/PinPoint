// Pinpoint bridge daemon: receives annotations from the browser extension over localhost HTTP,
// persists them, exposes them to agents over MCP (Streamable HTTP at /mcp), pushes change events
// back to the extension so pins stay in sync, and optionally mirrors into a project's .pinpoint/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp.js";
import { snapshot as iosSnapshot, toAnnotation as iosAnnotation } from "./ios.js";
import { DEFAULT_PORT, DATA_FILE, load, save, pending, pendingMarkdown, summaryLine, findAnnotation, pageKeyOf, bridgeToken } from "./store.js";

const MAX_RESOLVED = Number(process.env.PINPOINT_MAX_RESOLVED) || 200;
// After crops are the heavy part of a done note; only the newest ones keep their pixels.
const AFTER_KEEP = 20;
// Our own launch command, so the extension can tell you how to start us and the native host can
// find us. process.argv[1] is wrong under the `bin` shim; this is the file that is actually here.
const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");

// What a restart runs: always `cli.js start` with this daemon's own options. Re-running process.argv
// was wrong whenever the daemon was not started by `start` — `cli.js setup` starts one in-process,
// so a restart re-ran the whole setup wizard instead of coming back.
export function restartArgs({ port, project = null, quiet = false, print = false }) {
  const a = [CLI_PATH, "start", "--port", String(port)];
  if (project) a.push("--project", project);
  if (quiet) a.push("--quiet");
  if (print) a.push("--print");
  return a;
}

// `restartable` is off by default on purpose: POST /restart re-execs the process and exits it, and
// a daemon embedded in someone else's process (the test suite) must never do that to its host.
// Every image an annotation carries, as its size only.
const size = (x) => (x ? { width: x.width, height: x.height } : null);
function withoutPixels(a) {
  const out = { ...a, screenshot: size(a.screenshot) };
  if (Array.isArray(a.steps)) out.steps = a.steps.map((st) => ({ ...st, screenshot: size(st.screenshot) }));
  if (a.after) out.after = { ...a.after, screenshot: size(a.after.screenshot) };
  return out;
}

// `afterDelay`: how long after a resolve to look at the element again (the dev server needs a moment
// to rebuild). 0 turns it off.
export function startDaemon({ port = DEFAULT_PORT, project = process.env.PINPOINT_PROJECT || null, print = false, quiet = false, restartable = false,
                              afterDelay = Number(process.env.PINPOINT_AFTER_DELAY ?? 3000) } = {}) {
  let db = load();
  const token = bridgeToken();
  const events = new EventEmitter();
  events.setMaxListeners(1000);
  const log = (...a) => !quiet && console.error("[pinpoint]", ...a);

  // Monotonic version: the extension long-polls /events?since=<version> and re-syncs its pins
  // whenever this moves, so resolving from an agent clears pins without a page reload.
  let version = 1;
  // Live presence: what each coding agent is doing right now, so the browser can show it. Keyed by
  // agent name, because "agent to agent" means Claude Code and Cursor can both be connected and the
  // single slot this used to be blended them into one confusing label.
  const agents = new Map();
  let agent = null;
  function bump() {
    version++;
    events.emit("version", version);
  }

  function persist() {
    save(db);
    if (project) mirrorToProject();
    bump();
  }

  function mirrorToProject() {
    try {
      const dir = path.join(project, ".pinpoint");
      fs.mkdirSync(dir, { recursive: true });
      // Keep the mirror out of git without making the user edit .gitignore.
      const ignore = path.join(dir, ".gitignore");
      if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
      fs.writeFileSync(path.join(dir, "pending.md"), pendingMarkdown(db, { channel: "file", cliPath: CLI_PATH, port }));
      const stripped = pending(db).map((a) => ({
        ...withoutPixels(a),
        screenshot: a.screenshot ? { width: a.screenshot.width, height: a.screenshot.height, note: "not included in this file; read it over MCP (get_annotation) or from the bridge" } : null,
      }));
      fs.writeFileSync(path.join(dir, "pending.json"), JSON.stringify(stripped, null, 2));
    } catch (e) {
      log("could not mirror to project:", e.message);
    }
  }

  const find = (id) => findAnnotation(db, id);

  // One new annotation goes to exactly one waiter. `events.once("added")` woke every blocked
  // wait_for_annotation with the SAME note, so two agents did the same work and the second
  // resolve silently overwrote the first one's reply.
  const taken = new Set();
  // Outstanding "is this element still there?" questions, keyed by request id. Bounded by their
  // own deadlines: a question nobody answers expires rather than accumulating.
  const rechecks = new Map();
  const afterBusy = new Set();
  // Only a page the browser can show, and only while the extension is around to look at it.
  const canLook = (a) => /^(https?|file):/i.test(pageKeyOf(a)) && !!extensionSeenAt && Date.now() - Date.parse(extensionSeenAt) < 120000;

  const api = {
    async db() { return db; },
    async add(a) {
      // Numbers are per page: your notes on a page read 1, 2, 3 whatever you marked elsewhere.
      // A single global counter meant the first note on a new site could be #14, which says
      // nothing to the person looking at it. Ids stay globally unique and are what agents use.
      const page = pageKeyOf(a);
      a.number = 1 + db.annotations.reduce((m, x) => (pageKeyOf(x) === page ? Math.max(m, x.number || 0) : m), 0);
      // A draft is marked but not handed over: no agent sees it until the developer sends it.
      a.status = a.status === "draft" ? "draft" : "pending";
      a.receivedAt = new Date().toISOString();
      // A recorded flow: the extension caps it at ten, and so does the store.
      if (Array.isArray(a.steps)) a.steps = a.steps.slice(0, 10).filter((x) => x && typeof x === "object");
      else delete a.steps;
      db.annotations.push(a);
      // Keep the store bounded: only the most recent resolved annotations are kept.
      const resolved = db.annotations.filter((x) => x.status === "resolved");
      if (resolved.length > MAX_RESOLVED) {
        const drop = new Set(resolved.slice(0, resolved.length - MAX_RESOLVED).map((x) => x.id));
        db.annotations = db.annotations.filter((x) => !drop.has(x.id));
      }
      persist();
      if (a.status === "pending") events.emit("added", a);
      log(a.status === "draft" ? "draft:" : "new:", summaryLine(a));
      if (print) process.stdout.write(pendingMarkdown({ annotations: [a] }) + "\n");
      return a;
    },
    // The extension posts the comment first and attaches the crop a moment later, so navigating
    // away mid-capture can never lose an annotation.
    async attachScreenshot(id, screenshot) {
      const a = find(id);
      if (!a) return false;
      if (screenshot.skipped) a.screenshotSkipped = screenshot.skipped;
      else { a.screenshot = screenshot; delete a.screenshotSkipped; }
      persist();
      events.emit("screenshot", a);
      return true;
    },
    // Returns "already" rather than true when someone else got there first, so the second agent is
    // told instead of quietly replacing the first one's reply.
    async resolve(id, note, by) {
      const a = find(id);
      if (!a) return false;
      const first = a.status === "resolved" ? a.resolvedBy || "another agent" : null;
      a.status = "resolved";
      a.resolvedAt = new Date().toISOString();
      delete a.acceptedAt; // a new answer has not been accepted yet
      if (note) a.resolution = note;
      if (by) a.resolvedBy = by;
      delete a.after; // a new answer gets its own after
      persist();
      log(`resolved: #${a.number} ${a.comment}${note ? "  — " + note : ""}`);
      // unref: a pending look must never keep a process (the CLI, a test) alive.
      if (afterDelay > 0 && canLook(a)) setTimeout(() => api.captureAfter(a.id).catch(() => {}), afterDelay).unref?.();
      return first ? "already" : true;
    },
    // The agent asks instead of resolving — the request is ambiguous, or it needs a decision. The
    // note then waits on the developer, and leaves every agent's pending list until they answer.
    async reply(id, text, by) {
      const a = find(id);
      if (!a || a.status === "resolved" || a.status === "draft" || !text) return false;
      (a.thread ||= []).push({ by: "agent", name: by || null, text: String(text), at: new Date().toISOString() });
      a.status = "waiting";
      persist();
      log(`asked: #${a.number} ${text}`);
      return true;
    },
    // The developer answers the agent, adds to a note, or comes back to a finished one ("not quite").
    // Either way the note is theirs to hand over again: pending, with the whole conversation on it,
    // delivered to the hook and to wait_for_annotation exactly like a new note.
    async answer(id, text) {
      const a = find(id);
      if (!a || a.status === "draft" || !text) return false;
      a.thread ||= [];
      if (a.status === "resolved") {
        a.thread.push({ by: "agent", name: a.resolvedBy || null, text: a.resolution || "marked it done", at: a.resolvedAt || null, kind: "resolution" });
        delete a.resolution; delete a.resolvedAt; delete a.resolvedBy;
      }
      delete a.acceptedAt;
      a.thread.push({ by: "you", text: String(text), at: new Date().toISOString() });
      a.status = "pending";
      delete a.notifiedAt;
      taken.delete(a.id);
      persist();
      events.emit("added", a);
      log(`answered: #${a.number} ${text}`);
      return true;
    },
    // The developer looked at the finished change and is happy with it. Only a resolved note can be
    // accepted; reopening it or resolving it again clears the mark.
    async accept(id) {
      const a = find(id);
      if (!a || a.status !== "resolved") return false;
      a.acceptedAt = new Date().toISOString();
      persist();
      log(`accepted: #${a.number} ${a.comment}`);
      return true;
    },
    // Drafts go out together, when the developer says so — for one page, or everywhere.
    async sendDrafts(url) {
      const ds = db.annotations.filter((x) => x.status === "draft" && (!url || pageKeyOf(x) === url));
      for (const d of ds) d.status = "pending";
      if (ds.length) persist();
      for (const d of ds) events.emit("added", d);
      if (ds.length) log(`sent ${ds.length} draft${ds.length === 1 ? "" : "s"}`);
      return ds.length;
    },
    async remove(id) {
      const before = db.annotations.length;
      // Delete exactly the one resolved, by id. Filtering on the number would have removed that
      // number from every page at once now that numbering is per page.
      const gone = findAnnotation(db, id);
      if (gone) { db.annotations = db.annotations.filter((x) => x.id !== gone.id); taken.delete(gone.id); }
      persist();
      if (gone) log(`removed: #${gone.number} ${gone.comment}`);
      return db.annotations.length < before;
    },
    async clear() {
      const n = db.annotations.length;
      db = { nextNumber: 1, annotations: [] };
      taken.clear();
      persist();
      log(`cleared ${n} annotation${n === 1 ? "" : "s"}`);
    },
    // `signal` aborts when the caller has gone (an agent that hung up). Without it a dead waiter
    // stayed registered and claimed the next note for nobody — that note never reached anyone.
    waitForNext(timeoutMs, signal) {
      return new Promise((resolve) => {
        const finish = (v) => {
          clearTimeout(t);
          events.off("added", on);
          signal?.removeEventListener?.("abort", abort);
          resolve(v);
        };
        const t = setTimeout(() => finish(null), timeoutMs);
        const abort = () => finish(null);
        // Listeners run in registration order, so the first waiter claims the note and every other
        // one stays blocked for the NEXT one. A null payload (a restart) releases everybody.
        const on = (a) => {
          if (a) {
            if (taken.has(a.id)) return;
            if (taken.size > 500) taken.clear(); // ponytail: ids only matter while a waiter is live
            taken.add(a.id);
          }
          finish(a);
        };
        if (signal?.aborted) return finish(null);
        signal?.addEventListener?.("abort", abort, { once: true });
        events.on("added", on);
      });
    },
    // A claim whose caller vanished before it could be told: hand the note to the next waiter.
    release(a) {
      taken.delete(a.id);
      events.emit("added", a);
    },
    // Give a just-arrived annotation a moment for its screenshot to land before handing it to an agent.
    waitForScreenshot(id, timeoutMs = 2500) {
      const a = find(id);
      if (!a || a.screenshot || a.screenshotSkipped) return Promise.resolve(a);
      return new Promise((resolve) => {
        const t = setTimeout(() => { events.off("screenshot", on); resolve(find(id)); }, timeoutMs);
        const on = (x) => {
          if (x.id !== a.id) return;
          clearTimeout(t);
          events.off("screenshot", on);
          resolve(x);
        };
        events.on("screenshot", on);
      });
    },
    // What the browser last saw of this element. Deliberately `save` and NOT `persist`: persist
    // bumps the version, every tab reloads its pins, positionPin runs again and reports again —
    // an infinite loop. The extension does not need to hear its own report back.
    async setElementState(id, state) {
      const a = find(id);
      if (!a) return false;
      a.element.state = { state: state.state, at: state.at || new Date().toISOString(), url: state.url || null };
      save(db);
      return true;
    },

    // A recheck is a question for the browser: is this element still there, and what does it look
    // like now? It travels out on the /events long-poll the extension already runs, and comes back
    // as a POST. Unanswered requests stay in the payload, so an evicted service worker picks them
    // up on its next poll rather than losing the question.
    requestRecheck(id, timeoutMs) {
      const a = find(id);
      if (!a) return null;
      const reqId = Math.random().toString(36).slice(2, 10);
      const req = { reqId, id: a.id, url: pageKeyOf(a), deadline: Date.now() + timeoutMs, result: null };
      rechecks.set(reqId, req);
      bump(); // releases the extension's poll at once
      return req;
    },
    openRechecks() {
      const now = Date.now();
      for (const [k, r] of rechecks) if (r.result || r.deadline < now) rechecks.delete(k);
      return [...rechecks.values()].filter((r) => !r.result && r.deadline > now).map(({ reqId, id, url }) => ({ reqId, id, url }));
    },
    completeRecheck(reqId, result) {
      const req = rechecks.get(reqId);
      if (!req) return false;
      req.result = result || { status: "no_answer" };
      events.emit("recheck", req);
      return true;
    },
    // Ask, and wait for the answer: what the MCP tool calls in-process, and what the HTTP route
    // (and therefore the stdio server) calls too — one path, so they cannot answer differently.
    async recheck(id, timeoutMs = 10000) {
      const req = api.requestRecheck(id, timeoutMs);
      if (!req) return { status: "not_found" };
      const r = await api.waitForRecheck(req, timeoutMs);
      // Someone looked: resolve_annotation stops warning that the element was never re-checked.
      const a = find(req.id);
      if (a && r?.status === "ok") { a.element.recheckedAt = new Date().toISOString(); save(db); }
      return r;
    },
    // What the element looks like now that the note is done, next to the crop from when it was
    // marked. Kept only if the note is still the same resolved answer when the picture comes back.
    async captureAfter(id) {
      const a = find(id);
      if (!a || a.status !== "resolved" || !canLook(a) || afterBusy.has(a.id)) return false;
      afterBusy.add(a.id);
      try {
        const at = a.resolvedAt;
        const r = await api.recheck(a.id, 10000);
        const now = find(a.id);
        if (!now || now.status !== "resolved" || now.resolvedAt !== at || !r?.screenshot?.base64) return false;
        now.after = { at: new Date().toISOString(), resolvedAt: at, screenshot: r.screenshot };
        const kept = db.annotations.filter((x) => x.status === "resolved" && x.after?.screenshot)
          .sort((x, y) => String(y.after.at).localeCompare(String(x.after.at)));
        // The record stays without its pixels, so the panel does not keep asking for it.
        for (const x of kept.slice(AFTER_KEEP)) delete x.after.screenshot;
        persist();
        return true;
      } finally { afterBusy.delete(a.id); }
    },
    waitForRecheck(req, timeoutMs) {
      if (req.result) return Promise.resolve(req.result);
      return new Promise((resolve) => {
        const done = (r) => { clearTimeout(t); events.off("recheck", on); rechecks.delete(req.reqId); resolve(r); };
        // Timing out is an answer of its own — "nobody looked" — and must never be reported as
        // "nothing changed".
        const t = setTimeout(() => done({ status: "timeout" }), timeoutMs);
        const on = (x) => { if (x.reqId === req.reqId) done(x.result); };
        events.on("recheck", on);
      });
    },

    waitForVersion(since, timeoutMs) {
      // `!==`, not `>`: after a restart our counter is back at 1 while the extension still asks
      // since=57. A client from a previous life is answered at once — with `>` it ate the full
      // 25s timeout on every poll until we climbed past its number, and pins looked frozen.
      if (version !== since) return Promise.resolve(version);
      return new Promise((resolve) => {
        const t = setTimeout(() => { events.off("version", on); resolve(version); }, timeoutMs);
        const on = (v) => { clearTimeout(t); events.off("version", on); resolve(v); };
        events.on("version", on);
      });
    },
    version: () => version,
    // Called by the MCP layer on every tool call, so the developer can see their agent working.
    // `who` is {name, version} from the MCP initialize handshake, when the client sent one.
    touch(action, id, label, who) {
      const name = who?.name || null;
      agent = { at: Date.now(), action, id: id || null, label: label || null, name, agentVersion: who?.version || null };
      agents.set(name || "?", agent);
      bump();
    },
    agent: () => (agent ? { ...agent, secondsAgo: Math.round((Date.now() - agent.at) / 1000) } : null),
    agents: () => [...agents.values()].map((a) => ({ ...a, secondsAgo: Math.round((Date.now() - a.at) / 1000) })),
  };

  // CORS names the one origin that asked (already vetted below) rather than "*".
  const allowOrigin = (res) => res.req?.headers.origin || "*";
  function json(res, code, body) {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": allowOrigin(res), vary: "origin" });
    res.end(JSON.stringify(body));
  }
  function readBody(req, limitBytes = 32 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limitBytes) { reject(new Error("payload too large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null); }
        catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }

  // Set the first time the extension talks to us; read back from /health.
  let extensionSeenAt = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;

    // Only the extension and local tools may talk to us. Web pages (any http/https Origin) are refused
    // so a malicious site can't read your annotations or inject instructions for your coding agent
    // (DNS rebinding can't help either: the Host must be loopback).
    const hostHeader = (req.headers.host || "").replace(/^\[|\]$/g, "").split(":")[0];
    if (!["127.0.0.1", "localhost", "::1"].includes(hostHeader)) return json(res, 403, { error: "loopback only" });
    const origin = req.headers.origin;
    // Only the extension (a *-extension:// origin) and origin-less local CLI tools. A localhost
    // origin is a web page too — the very dev site being annotated — so it is refused like any other.
    // The one exception is our own origin: the /ios picker page is served by this bridge.
    const self = origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    if (origin && !self && !/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) {
      return json(res, 403, { error: "origin not allowed" });
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": allowOrigin(res), vary: "origin",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept, x-pinpoint, x-pinpoint-token",
        "access-control-max-age": "86400",
      });
      return res.end();
    }

    // An extension origin proves only that SOME extension is asking. Ours also carries the token;
    // any other installed extension does not have it. /health stays answerable so the popup can tell
    // "bridge is up, but this browser needs the token" from "bridge is down".
    const fromExtension = !!origin && !self;
    if ((p === "/annotations/wait" || p === "/ios/screen") && req.headers["x-pinpoint"] !== "1") {
      // A plain GET carries no Origin — so <img src="http://127.0.0.1:7331/annotations/wait"> on any
      // website would claim a note, or start Maestro. A custom header needs a preflight we refuse.
      return json(res, 403, { error: "x-pinpoint header required" });
    }
    const tokenOk = !fromExtension || req.headers["x-pinpoint-token"] === token;
    if (!tokenOk && p !== "/health" && p !== "/") return json(res, 401, { error: "this extension has not got the bridge token", code: "token" });
    // Recording when we last heard from the extension is what lets `cli.js setup` say "it is loaded"
    // instead of "now go and load it".
    if (fromExtension && tokenOk) extensionSeenAt = new Date().toISOString();

    try {
      // ---- MCP over Streamable HTTP (stateless: one transport per request) ----
      if (p === "/mcp") {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const mcp = createMcpServer(api); // stateless: fresh server per request
        res.on("close", () => { transport.close(); mcp.close(); });
        await mcp.connect(transport);
        const body = req.method === "POST" ? await readBody(req) : undefined;
        return transport.handleRequest(req, res, body);
      }

      // `service` identifies us so the extension never mistakes another localhost server for the bridge.
      if (p === "/" || p === "/health") {
        // Without the token, say who we are and nothing about the project or the notes.
        if (!tokenOk) return json(res, 200, { service: "pinpoint-bridge", ok: true, version: 1, port, tokenOk: false });
        return json(res, 200, {
          tokenOk: true,
          service: "pinpoint-bridge", ok: true, version: 1, port, project,
          pending: pending(db).length, dataFile: DATA_FILE, storeVersion: version, agent: api.agent(), extensionSeenAt,
          agents: api.agents(), cliPath: CLI_PATH, restartable, pid: process.pid,
        });
      }

      // Long-poll: resolves as soon as anything changes, so pins update without a reload.
      // presence reported by the stdio MCP server, which runs in its own process
      if (p === "/agent" && req.method === "POST") {
        let b = {};
        try { b = (await readBody(req)) || {}; } catch {}
        api.touch(b.action, b.id, b.label, b.who);
        return json(res, 200, { ok: true });
      }

      // Restart in place, so the browser can pick up a new build of the bridge without a terminal.
      if (p === "/restart" && req.method === "POST") {
        if (!restartable) return json(res, 501, { error: "this bridge was not started as its own process" });
        json(res, 200, { ok: true, restarting: true, port });
        setTimeout(restart, 50); // let the response flush before the socket goes
        return;
      }

      // ---- iOS Simulator picker ----
      if (p === "/ios" && req.method === "GET") {
        // Never framed: a page that could embed us could trick a click into sending a note.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" });
        return res.end(fs.readFileSync(path.join(path.dirname(CLI_PATH), "ios.html")));
      }
      if (p === "/ios/screen" && req.method === "GET") {
        try { return json(res, 200, await iosSnapshot()); } catch (e) { return json(res, 502, { error: e.message }); }
      }
      if (p === "/ios/annotations" && req.method === "POST") {
        let b;
        try { b = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message) }); }
        if (!b?.comment || !b.node?.bounds || !b.device?.name) return json(res, 400, { error: "comment, node and device required" });
        const saved = await api.add(iosAnnotation({ ...b, id: Math.random().toString(36).slice(2, 10) }));
        if (b.screenshot?.base64) await api.attachScreenshot(saved.id, b.screenshot);
        return json(res, 201, { ok: true, id: saved.id, number: saved.number });
      }

      if (p === "/events") {
        const since = Number(url.searchParams.get("since") || 0);
        const v = await api.waitForVersion(since, Math.min(Number(url.searchParams.get("timeout") || 25000), 60000));
        return json(res, 200, { version: v, changed: v > since, rechecks: api.openRechecks() });
      }

      if (p === "/annotations" && req.method === "GET") {
        const status = url.searchParams.get("status") || "all";
        const u = url.searchParams.get("url");
        // "open": everything that still has a pin on the page — drafts, pending, and waiting on you.
        const match = status === "all" ? () => true : status === "open" ? (a) => a.status !== "resolved" : (a) => a.status === status;
        const items = db.annotations.filter((a) => match(a) && (!u || a.page.url.split("#")[0] === u));
        const withImages = url.searchParams.get("images") === "1";
        // Keep the size, drop the pixels: text consumers (the hook, the popup) still say "a 340×120
        // screenshot is stored" without pulling megabytes of base64 on every prompt.
        return json(res, 200, { version, agent: api.agent(), annotations: withImages ? items : items.map((a) => ({ ...withoutPixels(a), hasScreenshot: !!a.screenshot })) });
      }

      if (p === "/annotations" && req.method === "POST") {
        let a;
        try { a = await readBody(req); } catch (e) { return json(res, 400, { error: e.message === "payload too large" ? "payload too large" : "invalid JSON" }); }
        if (!a || !a.comment || !a.element?.selector) return json(res, 400, { error: "comment and element.selector required" });
        const saved = await api.add(a);
        return json(res, 201, { ok: true, id: saved.id, number: saved.number });
      }

      if (p === "/annotations" && req.method === "DELETE") {
        await api.clear();
        return json(res, 200, { ok: true });
      }

      if (p === "/annotations/send-drafts" && req.method === "POST") {
        let body = {};
        try { body = (await readBody(req)) || {}; } catch {}
        return json(res, 200, { ok: true, sent: await api.sendDrafts(body.url || null) });
      }

      if (p === "/annotations/wait") {
        const ac = new AbortController();
        res.on("close", () => { if (!res.writableEnded) ac.abort(); });
        // Capped: the tool allows ten minutes, and an unbounded wait is a leaked socket.
        const ms = Math.min(Number(url.searchParams.get("timeout") || 120000), 600000);
        const a = await api.waitForNext(ms, ac.signal);
        const full = a ? await api.waitForScreenshot(a.id) : null;
        if (res.destroyed || ac.signal.aborted) { if (a) api.release(a); return; }
        return json(res, 200, { annotation: full });
      }

      const m = p.match(/^\/annotations\/([^/]+)(\/resolve|\/after|\/accept|\/reply|\/answer|\/screenshot|\/notified|\/element-state|\/recheck)?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === "DELETE") return json(res, 200, { ok: await api.remove(id) });
        if (req.method === "POST" && m[2] === "/resolve") {
          let body = {};
          try { body = (await readBody(req)) || {}; } catch {}
          return json(res, 200, { ok: await api.resolve(id, body.note, body.by) });
        }
        if (req.method === "POST" && m[2] === "/accept") return json(res, 200, { ok: await api.accept(id) });
        // The panel showing a done note that has no after yet (its tab was not in front at resolve
        // time). Answers at once; the crop lands with the next version bump.
        if (req.method === "POST" && m[2] === "/after") {
          const a = find(id);
          const ok = !!a && a.status === "resolved" && !a.after && canLook(a);
          if (ok) api.captureAfter(a.id).catch(() => {});
          return json(res, 200, { ok });
        }
        if (req.method === "POST" && (m[2] === "/reply" || m[2] === "/answer")) {
          let body = {};
          try { body = (await readBody(req)) || {}; } catch {}
          if (!body.text) return json(res, 400, { error: "text required" });
          return json(res, 200, { ok: m[2] === "/reply" ? await api.reply(id, body.text, body.by) : await api.answer(id, body.text) });
        }
        if (req.method === "POST" && m[2] === "/element-state") {
          let body = {};
          try { body = (await readBody(req)) || {}; } catch {}
          if (!body.state) return json(res, 400, { error: "state required" });
          return json(res, 200, { ok: await api.setElementState(id, body) });
        }
        // Ask the browser, wait for it, and answer with the verdict. This is what the stdio MCP
        // server proxies to, which is how Claude Code and Cursor reach it.
        if (req.method === "POST" && m[2] === "/recheck") {
          const timeout = Math.min(Number(url.searchParams.get("timeout") || 10000), 60000);
          const a = find(id);
          if (!a) return json(res, 404, { error: "not found" });
          return json(res, 200, { annotation: a, result: await api.recheck(id, timeout) });
        }
          if (req.method === "POST" && m[2] === "/notified") {
          const a = find(id);
          if (a) { a.notifiedAt = new Date().toISOString(); save(db); }
          return json(res, 200, { ok: !!a });
        }
      if ((req.method === "PUT" || req.method === "POST") && m[2] === "/screenshot") {
          let body;
          try { body = await readBody(req); } catch (e) { return json(res, 400, { error: String(e.message) }); }
          if (!body?.base64 && !body?.skipped) return json(res, 400, { error: "base64 or skipped required" });
          return json(res, 200, { ok: await api.attachScreenshot(id, body) });
        }
        if (req.method === "GET") {
          const a = find(id);
          return a ? json(res, 200, { annotation: a }) : json(res, 404, { error: "not found" });
        }
      }

      // The extension answering a recheck it was asked for.
      const rc = p.match(/^\/rechecks\/([^/]+)$/);
      if (rc && req.method === "POST") {
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (e) { return json(res, 400, { error: String(e.message) }); }
        return json(res, 200, { ok: api.completeRecheck(decodeURIComponent(rc[1]), body) });
      }

      if (p === "/pending.md") {
        res.writeHead(200, { "content-type": "text/markdown", "access-control-allow-origin": allowOrigin(res), vary: "origin" });
        return res.end(pendingMarkdown(db, { channel: "file", cliPath: CLI_PATH, port }));
      }

      json(res, 404, { error: "not found" });
    } catch (e) {
      log("error:", e);
      if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
    }
  });

  function restart() {
    bump();                        // release /events waiters with a normal 200
    events.emit("added", null);    // release /annotations/wait the way a timeout does
    server.closeAllConnections?.(); // without this, close() waits out every 25s long-poll
    server.close(() => {
      // Close BEFORE spawning or the replacement hits EADDRINUSE against us. stdio is inherited on
      // purpose: started from a terminal, Ctrl-C must still work on the new one.
      spawn(process.execPath, restartArgs({ port, project, quiet, print }), {
        stdio: "inherit", cwd: process.cwd(),
        // On Windows a non-detached child dies with its parent's console; hide the new window.
        detached: process.platform === "win32", windowsHide: true,
      }).unref();
      process.exit(0);
    });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      log(`listening on http://127.0.0.1:${port}  (MCP: http://127.0.0.1:${port}/mcp)`);
      if (process.platform === "darwin") log(`iOS Simulator picker: http://127.0.0.1:${port}/ios`);
      if (project) { log(`mirroring pending annotations to ${path.join(project, ".pinpoint")}/`); mirrorToProject(); }
      resolve({ server, api, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
