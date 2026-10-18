#!/usr/bin/env node
// One-time Chrome Web Store API setup for the release workflow. Run it on your own machine:
//
//   node tools/cws-auth.mjs <CLIENT_ID> <CLIENT_SECRET> <EXTENSION_ID>
//
// It opens Google's consent page, catches the reply on http://localhost:8765, exchanges it for a
// refresh token, and stores all four values as GitHub Actions secrets with `gh secret set`. Nothing
// is printed: the secrets go straight from Google to GitHub. Needs `gh` signed in as an account that
// can write the repository's secrets.
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";

const [clientId, clientSecret, extensionId] = process.argv.slice(2);
if (!clientId || !clientSecret || !/^[a-p]{32}$/.test(extensionId || "")) {
  console.error("usage: node tools/cws-auth.mjs <CLIENT_ID> <CLIENT_SECRET> <EXTENSION_ID (32 letters a-p)>");
  process.exit(2);
}
const REPO = "gowtham012/pinpoint";
const PORT = 8765, REDIRECT = `http://localhost:${PORT}`;
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  response_type: "code", client_id: clientId, redirect_uri: REDIRECT, access_type: "offline", prompt: "consent",
  scope: "https://www.googleapis.com/auth/chromewebstore",
}).toString();

const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    const c = u.searchParams.get("code"), err = u.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(c ? "Done — you can close this tab and go back to the terminal." : `Google said: ${err || "no code"}`);
    srv.close();
    c ? resolve(c) : reject(new Error(err || "no code in the reply"));
  }).listen(PORT, "127.0.0.1", () => {
    console.log("Opening Google's consent page. Approve access for the Chrome Web Store…");
    console.log(`(If nothing opens, visit: ${auth})`);
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [auth.toString()], { stdio: "ignore", detached: true }).unref();
  });
});

const r = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
});
const tok = await r.json();
if (!tok.refresh_token) {
  console.error(`No refresh token from Google: ${tok.error_description || tok.error || "unknown error"}`);
  process.exit(1);
}
const set = (name, value) => execFileSync("gh", ["secret", "set", name, "-R", REPO], { input: value, stdio: ["pipe", "ignore", "inherit"] });
set("CWS_CLIENT_ID", clientId);
set("CWS_CLIENT_SECRET", clientSecret);
set("CWS_REFRESH_TOKEN", tok.refresh_token);
set("CWS_EXTENSION_ID", extensionId);
console.log(`Stored CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN and CWS_EXTENSION_ID on ${REPO}.`);
console.log("The next tagged release uploads to the Chrome Web Store and submits it for review.");
