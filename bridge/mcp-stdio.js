// stdio MCP entrypoint for agents that spawn MCP servers as subprocesses (Claude Code, Cursor, Codex, …).
// It proxies to the running daemon so state is shared with the browser; if the daemon is not running,
// reads fall back to the JSON file and writes are applied to it directly.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp.js";
import { DEFAULT_PORT, load, save, findAnnotation } from "./store.js";

export async function startStdio({ port = DEFAULT_PORT } = {}) {
  const base = `http://127.0.0.1:${port}`;
  async function call(path, init) {
    const res = await fetch(base + path, init);
    if (!res.ok) throw new Error(`bridge ${res.status}`);
    return res.json();
  }
  const up = async () => { try { await call("/health"); return true; } catch { return false; } };

  const api = {
    touch(action, id, label, who) {
      // fire and forget: presence must never slow a tool call down
      fetch(`${base}/agent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, label, who }) }).catch(() => {});
    },
    async db() {
      if (await up()) {
        const { annotations } = await call("/annotations?status=all&images=1");
        return { annotations };
      }
      return load();
    },
    async resolve(id, note, by) {
      if (await up()) return (await call(`/annotations/${encodeURIComponent(id)}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note, by }) })).ok;
      const db = load();
      const a = findAnnotation(db, id);
      if (!a) return false;
      const first = a.status === "resolved" ? a.resolvedBy || "another agent" : null;
      a.status = "resolved"; a.resolvedAt = new Date().toISOString(); if (note) a.resolution = note; if (by) a.resolvedBy = by;
      save(db);
      return first ? "already" : true;
    },
    async reply(id, text, by) {
      if (await up()) return (await call(`/annotations/${encodeURIComponent(id)}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, by }) })).ok;
      const db = load();
      const a = findAnnotation(db, id);
      if (!a || a.status === "resolved" || a.status === "draft") return false;
      (a.thread ||= []).push({ by: "agent", name: by || null, text, at: new Date().toISOString() });
      a.status = "waiting";
      save(db);
      return true;
    },
    async clear() {
      if (await up()) return call("/annotations", { method: "DELETE" });
      save({ nextNumber: 1, annotations: [] });
    },
    // The browser is only reachable through the daemon, so a re-check without one is honestly
    // "could not look" rather than a guess from the stored snapshot.
    async recheck(id, timeoutMs) {
      if (!(await up())) return { status: "no_bridge" };
      const { result } = await call(`/annotations/${encodeURIComponent(id)}/recheck?timeout=${timeoutMs}`, { method: "POST" });
      return result;
    },
    async waitForNext(timeoutMs, signal) {
      // false, not null: null means "timed out", and with no bridge nothing can ever arrive — an
      // agent told "timed out" just waits again, forever.
      if (!(await up())) return false;
      // In slices under four minutes: Node's fetch gives up waiting for response headers at five,
      // while the tool allows ten. The signal reaches the bridge as a closed socket, which releases
      // the claim there too.
      const until = Date.now() + timeoutMs;
      while (Date.now() < until && !signal?.aborted) {
        const slice = Math.min(until - Date.now(), 240000);
        let res;
        try { res = await fetch(`${base}/annotations/wait?timeout=${slice}`, { headers: { "x-pinpoint": "1" }, signal }); }
        catch (e) { if (signal?.aborted) return null; throw e; }
        if (!res.ok) throw new Error(`bridge ${res.status}`);
        const { annotation } = await res.json();
        if (annotation) return annotation;
      }
      return null;
    },
  };

  const server = createMcpServer(api);
  await server.connect(new StdioServerTransport());
}
