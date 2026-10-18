// Scrubs one string of page context — an error message, a stack line, a failed request's URL —
// before it leaves the browser. A developer's own dev site still logs tokens, session ids and signed
// URLs, and an annotation ends up in an agent's context and possibly a project file. Loaded as a
// classic script by the worker and the content script; the tests load it the same way.
globalThis.pinpointRedact = (v) => {
  let s = String(v ?? "").replace(/\s+/g, " ").trim();
  // Query strings and fragments carry the secrets of most URLs; the path is what locates the bug.
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*/gi, "$1");
  s = s.replace(/\b(Bearer)\s+[\w.~+\/=-]+/gi, "$1 [redacted]");
  s = s.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[jwt]");
  s = s.replace(/\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|token|secret|password|passwd|pwd|session[_-]?id|signature|sig)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'&,;]+)/gi, "$1$2[redacted]");
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, "[hex]");
  // Long runs of mixed-case letters and digits are keys. Paths are runs too, so a run is only a key
  // when one of its /-separated pieces is long and mixed on its own.
  s = s.replace(/[A-Za-z0-9+\/_-]{40,}={0,2}/g, (run) =>
    run.split("/").some((p) => p.length >= 20 && /\d/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p)) ? "[redacted]" : run);
  return s.length > 300 ? s.slice(0, 299) + "…" : s;
};
