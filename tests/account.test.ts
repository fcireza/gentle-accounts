import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeAccount, statusText } from "../src/account.ts";

function dirs() {
  const home = mkdtempSync(join(tmpdir(), "gentle-profiles-acct-"));
  const claudeDir = join(home, "profiles", "work", "claude");
  mkdirSync(claudeDir, { recursive: true });
  return { home, claudeDir };
}

test("reads the email from <claudeDir>/.claude.json", () => {
  const { home, claudeDir } = dirs();
  writeFileSync(join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } }));
  assert.deepEqual(readClaudeAccount(claudeDir, home), { email: "a@b.c" });
});

test("includes the display name and never leaks other fields", () => {
  const { home, claudeDir } = dirs();
  writeFileSync(
    join(claudeDir, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "a@b.c", displayName: "Ann", accessToken: "secret", orgId: "o" }, token: "t" }),
  );
  assert.deepEqual(readClaudeAccount(claudeDir, home), { email: "a@b.c", name: "Ann" });
});

test("returns null for missing file, invalid JSON, no oauthAccount and empty email", () => {
  const { home, claudeDir } = dirs();
  assert.equal(readClaudeAccount(claudeDir, home), null);
  const file = join(claudeDir, ".claude.json");
  writeFileSync(file, "{broken");
  assert.equal(readClaudeAccount(claudeDir, home), null);
  writeFileSync(file, JSON.stringify({ other: 1 }));
  assert.equal(readClaudeAccount(claudeDir, home), null);
  writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: "" } }));
  assert.equal(readClaudeAccount(claudeDir, home), null);
  writeFileSync(file, "null");
  assert.equal(readClaudeAccount(claudeDir, home), null);
});

test("falls back to <home>/.claude.json only for the <home>/.claude dir", () => {
  const { home, claudeDir } = dirs();
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "home@x.y" } }));
  const homeClaude = join(home, ".claude");
  mkdirSync(homeClaude);
  assert.deepEqual(readClaudeAccount(homeClaude, home), { email: "home@x.y" });
  assert.equal(readClaudeAccount(claudeDir, home), null);
  writeFileSync(join(homeClaude, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "dir@x.y" } }));
  assert.deepEqual(readClaudeAccount(homeClaude, home), { email: "dir@x.y" });
});

test("statusText formats the profile and email", () => {
  assert.equal(statusText("work", { email: "a@b.c" }), "work · a@b.c");
  assert.equal(statusText("work", null), "work · not logged in");
});
