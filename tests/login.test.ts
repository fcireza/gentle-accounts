import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeLoginCommand } from "../src/login.ts";

test("claudeLoginCommand renders a POSIX command with the dir single-quoted", () => {
  assert.equal(claudeLoginCommand("/home/me/.gentle-shell/agent/profiles/work/claude", "linux"),
    "CLAUDE_CONFIG_DIR='/home/me/.gentle-shell/agent/profiles/work/claude' claude auth login");
  assert.equal(claudeLoginCommand("/a'b", "darwin"), "CLAUDE_CONFIG_DIR='/a'\\''b' claude auth login");
});

test("claudeLoginCommand renders a PowerShell command on Windows", () => {
  assert.equal(claudeLoginCommand("C:\\Users\\me\\.gentle-shell\\agent\\profiles\\work\\claude", "win32"),
    '$env:CLAUDE_CONFIG_DIR="C:\\Users\\me\\.gentle-shell\\agent\\profiles\\work\\claude"; claude auth login');
});

test("S16: claudeLoginCommand without a dir is plain `claude auth login` on every shell", () => {
  assert.equal(claudeLoginCommand(undefined, "linux"), "claude auth login");
  assert.equal(claudeLoginCommand(undefined, "darwin"), "claude auth login");
  assert.equal(claudeLoginCommand(undefined, "win32"), "claude auth login");
});
