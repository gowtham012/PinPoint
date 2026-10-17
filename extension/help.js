// The setup guide shows real commands: once the bridge has run, the extension knows where cli.js
// lives, so the /ABS/PATH placeholders become paths you can copy as they are.
const chrome = globalThis.browser ?? globalThis.chrome;

(async () => {
  let cliPath = null;
  try { ({ cliPath } = await chrome.storage.local.get({ cliPath: null })); } catch {}
  if (cliPath) {
    const bridge = cliPath.replace(/[\\/]cli\.js$/, "");
    for (const el of document.querySelectorAll("pre, code")) {
      el.textContent = el.textContent
        .replaceAll("/ABS/PATH/pinpoint/bridge/cli.js", cliPath)
        .replaceAll("cd pinpoint/bridge", `cd ${bridge}`);
    }
  }
  // One click per command block, instead of a drag-select that catches the trailing newline.
  for (const pre of document.querySelectorAll("pre")) {
    const b = document.createElement("button");
    b.className = "cp";
    b.textContent = "Copy";
    b.onclick = async () => {
      const text = pre.firstChild.textContent.replace(/\s+#.*$/gm, "").trim();
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select it"; }
      setTimeout(() => (b.textContent = "Copy"), 1500);
    };
    pre.appendChild(b);
  }
})();
