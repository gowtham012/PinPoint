// Safari and Firefox expose the promise-based extension API as `browser`; Chrome only has
// `chrome`. Prefer `browser` where it exists so every `await chrome.…` below works on all three.
// Not named `chrome`: at the top level of a classic script that redeclares the global, and some
// Chrome builds refuse it ("Identifier 'chrome' has already been declared"), which kills the worker.
const api = globalThis.browser ?? globalThis.chrome;

const $ = (s) => document.querySelector(s);
const send = (msg) => api.runtime.sendMessage(msg);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.host + (x.pathname === "/" ? "" : x.pathname);
  } catch { return u; }
}

// keepHint: a button just explained what went wrong; the refresh after it must not replace that with
// the generic "start it in a terminal" line before anyone has read it.
async function refresh({ keepHint = false } = {}) {
  const where = await send({ type: "canRun" });
  const pick = $("#pick");
  if (where && !where.local) {
    // Not a local dev page. Say so plainly rather than failing when the button is pressed.
    $("#where").textContent = where.reason;
    $("#where").style.display = "block";
    // file:// with file access off: the one switch that fixes it is a click away, not five.
    if (where.code === "file_access") {
      const b = document.createElement("button");
      b.textContent = "Open Pinpoint's settings";
      b.onclick = () => api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` });
      $("#where").appendChild(b);
    }
    const browserPage = where.code === "browser_page";
    pick.disabled = browserPage;
    pick.querySelector(".pl").textContent = browserPage ? "Not available here" : "Turn on for this page anyway";
  } else {
    $("#where").style.display = "none";
    pick.disabled = false;
    pick.querySelector(".pl").textContent = "Annotate an element";
  }

  const h = await send({ type: "health" });
  const needsToken = h.code === "token";
  $("#dot").className = "dot " + (h.ok ? "on" : "off");
  $("#status").textContent = h.ok ? `bridge on :${h.port}${h.project ? " · " + h.project.split("/").pop() : ""}` : needsToken ? "bridge needs its token" : "bridge offline";
  // The saved port was wrong and the bridge was found next door: show the number it moved to.
  if (h.movedTo) $("#port").value = h.movedTo;
  paintAgent(h);
  $("#tokenBox").hidden = !needsToken;
  // The bridge tells us where it lives, so once it has run once we can name the real command
  // instead of a <pinpoint> placeholder nobody can copy.
  if (h.cliPath) { cliPath = h.cliPath; api.storage.local.set({ cliPath }).catch(() => {}); }
  paintBridgeButton(h);
  if (!(keepHint && !h.ok)) $("#hint").innerHTML = h.ok
    ? (h.movedTo ? `Found the bridge on port ${h.movedTo} and switched to it.` : "")
    : h.code === "several"
      ? `Several bridges are running (${h.candidates.map((c) => `:${c.port}${c.project ? " " + esc(c.project.split("/").pop()) : ""}`).join(", ")}). Set the port below to the one you want.`
    : needsToken
      ? `The bridge is running, but this browser has not got its token. Run <code>node ${esc(cliPath || "<pinpoint>/bridge/cli.js")} token</code> and paste the output above — once.`
    : /Another server/.test(h.error || "")
      ? `Port ${$("#port").value} is taken by something else — change the port below, or start the bridge with --port.`
      : `Or start it in a terminal: <code>node ${esc(cliPath || "<pinpoint>/bridge/cli.js")} --project &lt;your repo&gt;</code>`;

  const res = h.ok ? await send({ type: "list" }) : null;
  const list = $("#list");
  list.innerHTML = "";
  const items = res?.annotations || [];
  $("#copyAll").disabled = $("#clear").disabled = !items.length;
  if (!items.length) {
    list.innerHTML = `<div class="empty">${h.ok ? "No pending annotations" : ""}</div>`;
    return;
  }
  const here = (where?.url || "").split("#")[0];
  for (const a of items) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n">${a.number}</span><div class="c"><div class="t"></div><div class="s"></div><div class="u"></div></div><button class="x" title="Remove" aria-label="Remove note ${a.number}">✕</button>`;
    li.querySelector(".t").textContent = a.comment;
    li.querySelector(".s").textContent = (a.source?.components?.[0] ? `<${a.source.components[0]}> ` : "") + a.element.selector;
    const u = li.querySelector(".u");
    u.textContent = shortUrl(a.page.url);
    if (a.page.url.split("#")[0] === here) u.classList.add("current");
    li.querySelector(".x").onclick = async (e) => {
      e.stopPropagation();
      await send({ type: "delete", id: a.id });
      refresh();
    };
    // The row takes you to the note: its tab in front and the element flashed, or the page opened.
    li.onclick = () => jumpTo(a);
    list.appendChild(li);
  }
}

// ---------- starting / restarting the bridge ----------
let cliPath = null;
api.storage.local.get({ cliPath: null }).then((v) => { cliPath = v.cliPath; }).catch(() => {});
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// Safari has no native messaging host of this kind, so it gets Restart (plain HTTP) but not Start.
const canStart = typeof api.runtime.sendNativeMessage === "function";

const ICON = {
  start: `<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>`,
  restart: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>`,
};
function paintBridgeButton(h) {
  const btn = $("#bridge");
  // Up but locked out (no token yet) is not "start it" — the token box is the next step.
  btn.style.display = h.code === "token" ? "none" : h.ok || canStart ? "flex" : "none";
  btn.disabled = false;
  btn.dataset.state = h.ok ? "restart" : "start";
  btn.querySelector(".bg").innerHTML = ICON[btn.dataset.state];
  btn.querySelector(".bl").textContent = h.ok ? "Restart bridge" : "Start bridge";
}

// What the agent is doing, so "is anything listening?" has an answer before you send a batch.
function paintAgent(h) {
  const box = $("#agent");
  box.hidden = !h.ok;
  if (!h.ok) return;
  const a = (h.agents || []).slice().sort((x, y) => (x.secondsAgo ?? 1e9) - (y.secondsAgo ?? 1e9))[0] || h.agent;
  box.classList.toggle("live", !!a && (a.secondsAgo ?? 1e9) < 120);
  $("#agentWho").textContent = a
    ? `${a.name || "Your agent"} · ${a.label || a.action || "active"} · ${ago(a.secondsAgo)}`
    : "No agent activity yet";
}
const ago = (s) => (s == null ? "" : s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);

const WATCH_PROMPT = `Watch Pinpoint for me: call the pinpoint MCP tool wait_for_annotation in a loop. For each note that arrives, make the change it asks for, then call resolve_annotation with its id and a short note saying what you changed and where. Keep going until I say stop.`;
$("#watch").onclick = async () => {
  try { await navigator.clipboard.writeText(WATCH_PROMPT); $("#watch").textContent = "Copied — paste it to your agent"; }
  catch { $("#watch").textContent = "Copy failed"; }
  setTimeout(() => ($("#watch").textContent = "Copy watch prompt"), 2500);
};

async function jumpTo(a) {
  const want = (a.page.topUrl || a.page.url).split("#")[0];
  const tab = (await api.tabs.query({})).find((t) => (t.url || "").split("#")[0] === want);
  if (!tab) { await api.tabs.create({ url: a.page.topUrl || a.page.url }); window.close(); return; }
  await api.tabs.update(tab.id, { active: true });
  try { await api.windows.update(tab.windowId, { focused: true }); } catch {}
  api.tabs.sendMessage(tab.id, { type: "reveal", id: a.id }).catch(() => {});
  window.close();
}

$("#bridge").onclick = async () => {
  const btn = $("#bridge");
  const running = btn.dataset.state === "restart";
  btn.disabled = true;
  btn.querySelector(".bl").textContent = running ? "Restarting…" : "Starting…";
  const r = await send({ type: running ? "restartBridge" : "startBridge" });
  if (r?.ok) { $("#hint").textContent = ""; refresh(); return; }
  // Everything that can go wrong here ends in "run the installer once", except a busy port,
  // which the bridge's own message already explains better than we could.
  const install = `node ${esc(cliPath || "<pinpoint>/bridge/cli.js")} install-native-host`;
  $("#hint").innerHTML =
    r?.code === "no_host" ? `One-time setup. Run this once, then press again — if you have already run it, run it again, the extension's id may have changed:<br><code>${install}</code>`
    : r?.code === "no_node" ? `The launcher couldn't find Node. Run this again, then press again:<br><code>${install}</code>`
    : r?.code === "unsupported" ? esc(r.error)
    : `<span style="white-space:pre-wrap">${esc(r?.error || "the bridge did not start")}</span>`;
  refresh({ keepHint: true });
};

$("#tokenSave").onclick = async () => {
  const token = $("#token").value.trim();
  if (!token) return;
  const r = await send({ type: "setToken", token });
  if (!r?.ok) $("#hint").textContent = r?.code === "token" ? "That token was not accepted — copy it again from cli.js token." : (r?.error || "could not reach the bridge");
  else { $("#token").value = ""; refresh(); }
};

$("#pick").onclick = async () => {
  // The background never throws for an unusable page — it answers with a reason.
  let r;
  try { r = await send({ type: "pick" }); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  if (r && r.ok === false) {
    $("#where").textContent = r.error;
    $("#where").style.display = "block";
    return;
  }
  window.close();
};

$("#copyAll").onclick = async () => {
  const res = await send({ type: "list" });
  const items = res?.annotations || [];
  if (!items.length) return;
  const text = items.map((a, i) => formatPrompt(a, i + 1)).join("\n\n---\n\n");
  await navigator.clipboard.writeText(`# ${items.length} change request(s)\n\n` + text);
  $("#status").textContent = "copied!";
  setTimeout(refresh, 900);
};

$("#clear").onclick = async () => {
  const res = await send({ type: "list" });
  const n = res?.annotations?.length || 0;
  if (n && !confirm(`Delete ${n} annotation${n === 1 ? "" : "s"}? This can't be undone.`)) return;
  await send({ type: "clear" });
  refresh();
};

$("#showbar").onclick = async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try { await api.tabs.sendMessage(tab.id, { type: "showDock" }); } catch {}
  window.close();
};

// Nothing in this popup may throw into the console when the tab is a page we cannot touch.
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  $("#where").textContent = String(e.reason?.message || e.reason);
  $("#where").style.display = "block";
});

$("#help").onclick = (e) => {
  e.preventDefault();
  api.tabs.create({ url: api.runtime.getURL("help.html") });
};

api.storage.sync.get({ port: 7331, dockPos: "tr" }).then(({ port, dockPos }) => {
  $("#port").value = port;
  $("#dockPos").value = dockPos;
});
$("#dockPos").onchange = async (e) => {
  await api.storage.sync.set({ dockPos: e.target.value });
  const tab = await activeTab();
  if (tab?.id) api.tabs.sendMessage(tab.id, { type: "showDock" }).catch(() => {});
};
$("#port").onchange = async (e) => {
  await api.storage.sync.set({ port: Number(e.target.value) || 7331 });
  refresh();
};

// Show the shortcut the user's platform actually uses.
$("#kpick").textContent = MAC ? "⌥⇧A" : "Alt+Shift+A";

function formatPrompt(a, n) {
  const s = a.source || {};
  const lines = [`### ${n}. ${a.comment}`, ``, `- Page: ${a.page.url}`, `- Element: \`${a.element.selector}\``, `- DOM path: ${a.element.domPath}`];
  if (a.element.text) lines.push(`- Text: "${a.element.text}"`);
  if (s.components?.length) lines.push(`- Component chain (${s.framework}): ${s.components.join(" ← ")}`);
  if (s.file) lines.push(`- Source: ${s.file}${s.line ? ":" + s.line : ""}`);
  lines.push(`- Size: ${a.element.rect.width}×${a.element.rect.height}px at viewport ${a.page.viewport.width}×${a.page.viewport.height}`);
  const st = Object.entries(a.element.styles || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
  if (st) lines.push(`- Computed styles: ${st}`);
  lines.push("", "```html", a.element.outerHTML, "```");
  return lines.join("\n");
}

refresh();
