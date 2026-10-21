// Runs in the page's MAIN world so it can read framework internals (React fibers, Vue instances)
// that are invisible from the isolated content-script world. Communicates via a synchronous
// CustomEvent round-trip: content.js dispatches "pinpoint:inspect" on the element, we answer by
// dispatching "pinpoint:inspect-result" on the same element with a JSON string.
(() => {
  if (window.__pinpointInspector) return;
  window.__pinpointInspector = true;

  function reactHint(el, hint) {
    let node = el, fiber = null;
    while (node && !fiber) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (key) fiber = node[key];
      else node = node.parentElement;
    }
    if (!fiber) return false;
    hint.framework = "react";
    let f = fiber, guard = 0;
    while (f && guard++ < 80 && hint.components.length < 8) {
      const t = f.type;
      let name = null;
      if (typeof t === "function") name = t.displayName || t.name;
      else if (t && typeof t === "object") name = t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name;
      if (name && name !== "Fragment" && !/^(Provider|Consumer|Context|Suspense|Boundary|Anonymous)$/.test(name) && hint.components[hint.components.length - 1] !== name) hint.components.push(name);
      if (!hint.file && f._debugSource) {
        hint.file = f._debugSource.fileName;
        hint.line = f._debugSource.lineNumber;
        hint.column = f._debugSource.columnNumber ?? null;
      }
      // React 19 dev: _debugStack is an Error whose stack mentions the source file.
      if (!hint.file && f._debugStack && typeof f._debugStack.stack === "string") {
        const m = f._debugStack.stack.match(/\((?:webpack-internal:\/\/\/|file:\/\/|https?:\/\/[^/]+\/)?([^)\s]+?\.(?:[jt]sx?|vue|svelte)):(\d+):(\d+)\)/);
        if (m && !/node_modules/.test(m[1])) { hint.file = m[1]; hint.line = Number(m[2]); hint.column = Number(m[3]); }
      }
      f = f.return;
    }
    if (hint.file) hint.file = hint.file.replace(/^.*?\/((src|app|pages|components|lib)\/)/, "$1").replace(/\?.*$/, "");
    return true;
  }

  function vueHint(el, hint) {
    let v = el;
    for (let i = 0; v && i < 12; i++, v = v.parentElement) {
      const inst = v.__vueParentComponent || v.__vue__;
      if (!inst) continue;
      hint.framework = "vue";
      let c = inst, guard = 0;
      while (c && guard++ < 10 && hint.components.length < 8) {
        const type = c.type || c.$options;
        const name = type?.name || type?.__name;
        if (name) hint.components.push(name);
        if (!hint.file && type?.__file) hint.file = type.__file;
        c = c.parent || c.$parent;
      }
      return true;
    }
    return false;
  }

  function attrHints(el, hint) {
    let cur = el;
    for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) {
      const get = (n) => cur.getAttribute(n);
      const src = get("data-source") || get("data-loc") || get("data-inspector-relative-path") || get("data-source-file") || get("data-file") || get("data-locatorjs-id");
      if (src && !hint.file) {
        const m = src.match(/^(.*?):(\d+)(?::(\d+))?$/);
        hint.file = m ? m[1] : src;
        hint.line = m ? Number(m[2]) : Number(get("data-inspector-line") || get("data-line")) || null;
        hint.column = m && m[3] ? Number(m[3]) : Number(get("data-inspector-column")) || null;
      }
      for (const n of ["data-component", "data-sentry-component", "data-sentry-source-file", "data-testid", "data-test", "data-cy"]) {
        const v = get(n);
        if (v && !hint.attributes[n]) hint.attributes[n] = v;
      }
    }
  }

  // Is the picked element one of several copies of the same component? Counted in the tree the
  // framework already keeps (React fibers from the root, Vue instances from the app root); a page
  // with neither gets an estimate from structure: same tag + classes under the same kind of parent.
  // Sets hint.reuse = { component, count, estimate } only when count > 1.
  // ponytail: one React root / one Vue app (the picked element's); counting stops at 500 and the
  // walk at 50k nodes. Vue 2 (__vue__) is not counted.
  function reuseHint(el, hint) {
    const CAP = 500, WALK = 50000;
    let node = el, fiber = null;
    while (node && !fiber) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (key) fiber = node[key]; else node = node.parentElement;
    }
    if (fiber) {
      const nameOf = (t) => typeof t === "function" ? t.displayName || t.name
        : t && typeof t === "object" && !t._context ? t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name : null;
      let f = fiber, comp = null, root = null;
      for (let g = 0; f && g < 200; g++, f = f.return) {
        const n = nameOf(f.type);
        if (!comp && n && !/^(Fragment|Provider|Consumer|Context|Suspense|Boundary|Anonymous)$/.test(n)) comp = f;
        if (!f.return) root = f;
      }
      if (!comp || root?.tag !== 3) return;   // 3 = HostRoot
      let count = 0, seen = 0;
      const stack = [root.stateNode?.current || root];   // the committed tree, not a stale alternate
      while (stack.length && count < CAP && seen++ < WALK) {
        const x = stack.pop();
        if (x.type === comp.type) count++;
        if (x.sibling) stack.push(x.sibling);
        if (x.child) stack.push(x.child);
      }
      if (count > 1) hint.reuse = { component: nameOf(comp.type), count, estimate: false };
      return;
    }
    let v = el;
    while (v && !v.__vueParentComponent) v = v.parentElement;
    const inst = v?.__vueParentComponent;
    if (inst) {
      let root = inst; while (root.parent) root = root.parent;
      let count = 0, seen = 0;
      const stack = [root.subTree];
      while (stack.length && count < CAP && seen++ < WALK) {
        const vn = stack.pop();
        if (!vn || typeof vn !== "object") continue;
        if (vn.component) { if (vn.component.type === inst.type) count++; stack.push(vn.component.subTree); }
        else if (vn.suspense) stack.push(vn.suspense.activeBranch);
        else if (Array.isArray(vn.children)) stack.push(...vn.children);
      }
      const t = inst.type;
      if (count > 1) hint.reuse = { component: t?.name || t?.__name || "Anonymous", count, estimate: false };
      return;
    }
    if (hint.framework) return;   // Svelte, Angular…: no tree to count in, and no guessing over one
    const p = el.parentElement;
    if (!p || el === document.body || el === document.documentElement) return;
    if (!el.classList.length && !p.classList.length) return;   // a bare <p> in a bare <div> is everywhere
    const sig = (n) => n.tagName.toLowerCase() + [...n.classList].sort().map((c) => "." + c).join("");
    const mine = sig(el), parent = sig(p);
    let count = 0;
    for (const n of el.getRootNode().querySelectorAll(el.tagName)) {
      if (n.parentElement && sig(n) === mine && sig(n.parentElement) === parent && ++count >= CAP) break;
    }
    if (count > 1) hint.reuse = { component: `${parent} > ${mine}`, count, estimate: true };
  }

  function inspect(el) {
    const hint = { framework: null, components: [], file: null, line: null, column: null, attributes: {} };
    try { attrHints(el, hint); } catch {}
    try { reactHint(el, hint) || vueHint(el, hint); } catch {}
    if (!hint.framework) {
      if ([...el.classList].some((c) => /^svelte-/.test(c))) hint.framework = "svelte";
      else if ([...el.attributes].some((a) => /^_ngcontent|^ng-/.test(a.name))) hint.framework = "angular";
      else if (el.closest("[data-astro-cid], astro-island")) hint.framework = "astro";
    }
    try { reuseHint(el, hint); } catch {}
    return hint;
  }

  // For the source-map fallback (sourcemap.js, in the worker): the nearest component's own source
  // text and the page's scripts, so the worker can find which bundle holds it. Only asked when the
  // hint above found no file — a production build. The function's text is the page's own code.
  function mapProbe(el) {
    let fn = null;
    for (let node = el; node && !fn; node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      for (let f = key && node[key], i = 0; f && i < 80 && !fn; f = f.return, i++) {
        const t = f.type;
        fn = typeof t === "function" ? t : [t?.render, t?.type, t?.type?.render].find((x) => typeof x === "function") || null;
      }
      const v = node.__vueParentComponent?.type || node.__vue__?.$options;
      if (!fn && v) fn = [v.setup, v.render].find((x) => typeof x === "function") || null;
    }
    if (!fn) return null;
    const src = Function.prototype.toString.call(fn);
    if (src.length < 16 || /\{\s*\[native code\]\s*\}/.test(src)) return null;
    const scripts = new Set([...document.scripts].map((s) => s.src).filter(Boolean));
    try { for (const r of performance.getEntriesByType("resource")) if (r.initiatorType === "script") scripts.add(r.name); } catch {}
    return { snippet: src.slice(0, 120), name: fn.name || null, scripts: [...scripts].slice(0, 30) };
  }
  document.addEventListener("pinpoint:probe", (e) => {
    let r = null;
    try { r = mapProbe(e.target); } catch {}
    e.target.dispatchEvent(new CustomEvent("pinpoint:probe-result", { detail: JSON.stringify(r) }));
  }, true);

  // ---------- page context ----------
  // What went wrong on the page lately: uncaught errors and unhandled rejections, newest last. Only
  // listening — console is never wrapped, so DevTools keeps showing the page's own call sites. This
  // file runs at document_start for exactly this, so errors thrown while the page boots are caught.
  // content.js asks with "pinpoint:context"; the worker redacts before anything leaves the browser.
  const recent = [];
  const keep = (message, err) => {
    let stack = [];
    try {
      stack = String(err?.stack || "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (stack[0] && !/^at |@/.test(stack[0])) stack.shift(); // V8 repeats the message as line one
    } catch {}
    recent.push({ at: Date.now(), message: String(message).slice(0, 1000), stack: stack.slice(0, 3).map((l) => l.slice(0, 300)) });
    if (recent.length > 30) recent.shift();
  };
  window.addEventListener("error", (e) => {
    if (e instanceof ErrorEvent) keep(e.message || "Script error", e.error); // not <img> load failures
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    let msg = "Unhandled rejection";
    try { const r = e.reason; msg += ": " + (r instanceof Error ? `${r.name}: ${r.message}` : String(r)); } catch {}
    try { keep(msg, e.reason); } catch {}
  });
  document.addEventListener("pinpoint:context", () => {
    const since = Date.now() - 60000;
    document.dispatchEvent(new CustomEvent("pinpoint:context-result", { detail: JSON.stringify(recent.filter((x) => x.at >= since)) }));
  }, true);

  document.addEventListener("pinpoint:inspect", (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    let result;
    try { result = inspect(el); } catch (err) { result = { error: String(err) }; }
    el.dispatchEvent(new CustomEvent("pinpoint:inspect-result", { detail: JSON.stringify(result) }));
  }, true);
})();
