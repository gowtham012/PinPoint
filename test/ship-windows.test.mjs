// What setup hands cmd.exe on Windows. Pure node. Run: node --test ship-windows.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmdLine } from "../bridge/setup.js";

test("cmdLine: one string for shell: true, quoting only what cmd.exe would split", () => {
  assert.equal(cmdLine("claude", ["mcp", "remove", "pinpoint", "-s", "user"]), "claude mcp remove pinpoint -s user");
  assert.equal(
    cmdLine("claude", ["mcp", "add", "pinpoint", "--", "node", "C:\\Program Files\\pinpoint\\bridge\\cli.js", "mcp", "--port", "7400"]),
    'claude mcp add pinpoint -- node "C:\\Program Files\\pinpoint\\bridge\\cli.js" mcp --port 7400');
  // & | < > ^ would start a second command; quoted, they are just characters in a path.
  assert.equal(cmdLine("claude", ["a&b", 'say "hi"', ""]), 'claude "a&b" "say ""hi""" ""');
});
