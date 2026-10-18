// Scrubs one string of page context — an error message, a stack line, a failed request's URL —
// before it leaves the browser. A developer's own dev site still logs tokens, session ids and signed
// URLs, and an annotation ends up in an agent's context and possibly a project file. Loaded as a
// classic script by the worker and the content script; the tests load it the same way.
globalThis.pinpointRedact = (v) => {
  // The URL rules backtrack per scheme, so a megabyte of junk would hang the page; only the first 300
  // characters are kept anyway. ponytail: a secret cut at 2000 could leak its head if the rules then
  // shrink the text below 300; no real message does that.
  let s = String(v ?? "").slice(0, 2000).replace(/\s+/g, " ").trim();
  // Query strings and fragments carry the secrets of most URLs; the path is what locates the bug.
  // A stack frame's :line:col after the query stays: Vite serves every module as ?t=<timestamp>.
  s = s.replace(/\b([a-z][a-z0-9+.-]{0,20}:\/\/)[^\/\s:@]+:[^\/\s@]+@/gi, "$1[redacted]@");
  s = s.replace(/\b([a-z][a-z0-9+.-]{0,20}:\/\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*?(:\d+(?::\d+)?)?(?=[\s"'<>()]|$)/gi, "$1$2");
  s = s.replace(/\b(Bearer)\s+[\w.~+\/=-]+/gi, "$1 [redacted]");
  // Basic needs a digit, + / or = in it, so "Basic authentication failed" reads as words.
  s = s.replace(/\b(Basic)\s+(?=[A-Za-z0-9+\/]*[0-9+\/=])[A-Za-z0-9+\/]{6,}={0,2}/g, "$1 [redacted]");
  s = s.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[jwt]");
  // Any prefix (DB_PASSWORD, csrf_token, connect.sid) and a JSON-quoted key ("token":"…") count.
  s = s.replace(/\b([\w.-]{0,40}?(?:api[_-]?key|token|secret|passw(?:or)?d|pwd|session[_-]?id|sid|signature|sig|auth))(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'&,;}\]]+)/gi, "$1$2[redacted]");
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, "[hex]");
  // Long runs of mixed-case letters and digits are keys. Paths are runs too, so a run is only a key
  // when one of its /-separated pieces is long and mixed on its own.
  s = s.replace(/[A-Za-z0-9+\/_-]{40,}={0,2}/g, (run) =>
    run.split("/").some((p) => p.length >= 20 && /\d/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p)) ? "[redacted]" : run);
  return s.length > 300 ? s.slice(0, 299) + "…" : s;
};
