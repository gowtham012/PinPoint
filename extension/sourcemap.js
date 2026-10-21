// The source hint's last resort: a production build strips React's _debugSource and Vue's __file,
// but its source map still knows where every function came from. inspector.js (MAIN world) hands
// us the clicked component's minified source text and the page's script URLs; here, in the worker,
// we find which script holds that text, read the script's source map and map the position back.
// Loaded as a classic script by the worker (Firefox lists it in background.scripts); the tests load
// it the same way. Nothing fetched here leaves the browser: the result is a file:line in the note.
(() => {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const DIGIT = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) DIGIT[B64.charCodeAt(i)] = i;

  // "mappings" → one array per generated line of [genCol, src, srcLine, srcCol, name?], all
  // absolute (the field stores deltas; genCol resets each line, the rest run on across lines).
  function decodeMappings(str) {
    const lines = [[]];
    const v = [0, 0, 0, 0, 0];
    let seg = [], n = 0, shift = 0;
    for (let i = 0; i <= str.length; i++) {
      const c = i < str.length ? str.charCodeAt(i) : 59; // 59 ";" closes the last segment
      if (c === 44 || c === 59) { // "," or ";"
        if (seg.length) {
          if (seg.length !== 1 && seg.length !== 4 && seg.length !== 5) throw new Error("bad segment");
          const out = [];
          for (let k = 0; k < seg.length; k++) out.push(v[k] += seg[k]);
          lines[lines.length - 1].push(out);
          seg = [];
        }
        if (c === 59 && i < str.length) { lines.push([]); v[0] = 0; }
        continue;
      }
      const d = c < 128 ? DIGIT[c] : -1;
      if (d < 0) throw new Error("bad base64 in mappings");
      n += (d & 31) << shift; // ponytail: plain shift; values past 2^31 do not occur in real maps
      if (d & 32) { shift += 5; if (shift > 30) throw new Error("VLQ too long"); continue; }
      seg.push(n & 1 ? -(n >>> 1) : n >>> 1);
      n = 0; shift = 0;
    }
    for (const l of lines) l.sort((a, b) => a[0] - b[0]);
    return lines;
  }

  // The segment at or before (line, column), both 0-based, on that generated line only — the
  // same rule as source-map's originalPositionFor (GREATEST_LOWER_BOUND).
  function segmentAt(lines, line, column) {
    const segs = lines[line];
    if (!segs) return null;
    let lo = 0, hi = segs.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid][0] <= column) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best < 0 ? null : { segs, i: best };
  }

  // A map's sources as webpack, Vite and esbuild write them, made project-relative where possible.
  function cleanSource(source, sourceRoot) {
    let s = String(source || "");
    if (sourceRoot && !/^[a-z][\w+.-]*:/i.test(s) && !s.startsWith("/")) s = sourceRoot.replace(/\/?$/, "/") + s;
    s = s.replace(/^webpack:\/\/[^/]*\//, "").replace(/^(file|vite|turbopack|rollup):\/\//, "").replace(/^\/@fs\//, "/")
      .replace(/[?#].*$/, "").replace(/^(\.\.?\/)+/, "").replace(/^\.\//, "");
    const m = ("/" + s).match(/^.*?\/((?:src|app|pages|components|lib)\/.*)$/); // the first such folder
    return m ? m[1] : s;
  }

  // (map, 0-based line, 0-based column) → { file, line, column (1-based), name } or null.
  // `map._lines` caches the decoded mappings on the parsed map object.
  function originalPosition(map, line, column) {
    if (Array.isArray(map.sections)) {
      let sec = null;
      for (const s of map.sections) {
        const o = s.offset || {};
        if (o.line < line || (o.line === line && o.column <= column)) sec = s; else break;
      }
      if (!sec?.map) return null; // a section by "url" is not followed
      const o = sec.offset;
      return originalPosition(sec.map, line - o.line, line === o.line ? column - o.column : column);
    }
    if (typeof map.mappings !== "string" || !Array.isArray(map.sources)) return null;
    map._lines ||= decodeMappings(map.mappings);
    let hit = segmentAt(map._lines, line, column);
    // No segment right at the function's start (Vue's generated `setup(__props) {` wrapper has
    // none): the one before it belongs to the previous module, so take the first one inside it.
    if (!hit || hit.segs[hit.i][0] < column) {
      const segs = map._lines[line] || [], k = segs.findIndex((s) => s[0] >= column);
      if (k >= 0 && segs[k][0] < column + 120) hit = { segs, i: k };
    }
    if (!hit) return null;
    const seg = hit.segs[hit.i];
    if (seg.length < 4) return null;
    const file = cleanSource(map.sources[seg[1]], map.sourceRoot);
    if (!file || /(^|\/)node_modules\//.test(file)) return null;
    // A component's own name: names[] on this segment or on the next few (esbuild puts it on the
    // identifier after `function`). PascalCase only, so a destructured prop is never taken for one.
    let name = null;
    for (let k = hit.i; k < hit.segs.length && hit.segs[k][0] <= column + 40 && !name; k++) {
      const s = hit.segs[k], cand = s.length === 5 ? map.names?.[s[4]] : null;
      if (typeof cand === "string" && /^[A-Z][\w$]*$/.test(cand)) name = cand;
    }
    // An arrow component (`const Price = ({ value }) => …`) has its name on the binding just
    // before the function's text: the nearest named segment back, same file, within 40 columns.
    for (let k = hit.i - 1; !name && k >= 0 && hit.segs[k][0] >= column - 40 && hit.segs[k][1] === seg[1]; k--) {
      const s = hit.segs[k], cand = s.length === 5 ? map.names?.[s[4]] : null;
      if (typeof cand !== "string") continue;
      if (/^[A-Z][\w$]*$/.test(cand)) name = cand;
      break;
    }
    return { file, line: seg[2] + 1, column: seg[3] + 1, name };
  }

  // Where `snippet` starts in `text`, 0-based — null when absent or when it appears twice.
  function locate(text, snippet) {
    const at = text.indexOf(snippet);
    if (at < 0 || text.indexOf(snippet, at + 1) >= 0) return null;
    let line = 0, last = -1;
    for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) { line++; last = i; }
    return { line, column: at - last - 1 };
  }

  // The last `//# sourceMappingURL=` comment (or the older `//@`).
  function mapComment(text) {
    const tail = text.slice(-4096);
    let m, url = null;
    const re = /\/[/*][#@][ \t]*sourceMappingURL=([^\s'"*]+)/g;
    while ((m = re.exec(tail))) url = m[1];
    return url;
  }

  const LOOPBACK = (h) => h === "localhost" || h.endsWith(".localhost") || /^127\./.test(h) || h === "[::1]";
  // Same origin as the page, or loopback when the page itself is on loopback (a dev server on
  // another port). Never a third party: a CDN's scripts and maps are not ours to download.
  function allowed(url, pageUrl) {
    try {
      const u = new URL(url), p = new URL(pageUrl);
      if (!/^https?:$/.test(u.protocol)) return false;
      return u.origin === p.origin || (LOOPBACK(p.hostname) && LOOPBACK(u.hostname));
    } catch { return false; }
  }

  const CAP = 8 * 1024 * 1024;
  // fetch → text, refused past CAP bytes. Redirects fail: a same-origin URL must not bounce us to
  // another host. No cookies: dev servers serve their bundles without them.
  async function fetchText(url, signal) {
    const res = await fetch(url, { signal, credentials: "omit", redirect: "error", cache: "force-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (Number(res.headers.get("content-length")) > CAP) throw new Error("too big");
    const reader = res.body.getReader(), parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CAP) { reader.cancel().catch(() => {}); throw new Error("too big"); }
      parts.push(value);
    }
    const text = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
    return { text, header: res.headers.get("sourcemap") || res.headers.get("x-sourcemap") };
  }

  // ponytail: 8 scripts, 60 s, oldest first out; a cache keyed by more than URL when a dev server
  // serves new code under an unchanged URL faster than that.
  const cache = new Map();
  function cached(key, make) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    const p = make();
    p.catch(() => cache.delete(key));
    cache.set(key, { at: Date.now(), p });
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return p;
  }

  async function loadMap(ref, scriptUrl, pageUrl, signal, get) {
    if (ref.startsWith("data:")) {
      const comma = ref.indexOf(",");
      const meta = ref.slice(5, comma), body = ref.slice(comma + 1);
      const raw = /;base64$/i.test(meta) ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
      return JSON.parse(raw);
    }
    const url = new URL(ref, scriptUrl).href;
    if (!allowed(url, pageUrl)) return null;
    return JSON.parse((await get(url, signal)).text.replace(/^\)\]\}'[^\n]*\n/, ""));
  }

  // { snippet, scripts } from the page, pageUrl from the sender → { file, line, column, name } | null.
  // `get` is fetchText; tests pass their own.
  async function resolve({ snippet, scripts }, pageUrl, { timeout = 4000, get = fetchText } = {}) {
    if (typeof snippet !== "string" || snippet.length < 16 || snippet.length > 500 || !Array.isArray(scripts)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const urls = [...new Set(scripts.filter((s) => typeof s === "string" && allowed(s, pageUrl)))].slice(0, 30);
    try {
      const found = await Promise.race([
        new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new Error("timeout")))),
        (async () => {
          const hits = await Promise.all(urls.map(async (url) => {
            const entry = await cached(url, () => get(url, ctl.signal)).catch(() => null);
            const at = entry && locate(entry.text, snippet);
            return at && { url, entry, at };
          }));
          const hit = hits.find(Boolean);
          if (!hit) return null;
          const ref = mapComment(hit.entry.text) || hit.entry.header;
          if (!ref) return null;
          hit.entry.map ||= loadMap(ref, hit.url, pageUrl, ctl.signal, get);
          const map = await hit.entry.map.catch(() => { hit.entry.map = null; return null; });
          return map ? originalPosition(map, hit.at.line, hit.at.column) : null;
        })(),
      ]);
      return found;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  globalThis.pinpointSourceMap = { decodeMappings, segmentAt, cleanSource, originalPosition, locate, mapComment, allowed, resolve };
})();
