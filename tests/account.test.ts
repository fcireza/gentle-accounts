import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_LABEL, maskEmail, providerStates, queryClaudeAccount, readClaudeAccount, statusText } from "../src/account.ts";

function dirs() {
  const home = mkdtempSync(join(tmpdir(), "gentle-accounts-acct-"));
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

test("S28: statusText is `👤 gentle-accounts: <profile> · <masked>` or `🔒 ... · not logged in`", () => {
  assert.equal(PLUGIN_LABEL, "gentle-accounts");
  assert.equal(statusText("work", { email: "fcireza@gmail.com" }), "👤 gentle-accounts: work · fcir****@gmail.com");
  assert.equal(statusText("work", null), "🔒 gentle-accounts: work · not logged in");
  assert.ok(!statusText("work", { email: "fcireza@gmail.com" }).includes("fcireza@gmail.com"));
});

test("S17: maskEmail keeps min(4, max(1, local - 3)) chars and the domain", () => {
  const table: [string, string][] = [
    ["fcireza@gmail.com", "fcir****@gmail.com"],
    ["ab@x.com", "a****@x.com"],
    ["abcde@x.com", "ab****@x.com"],
    ["a@x.com", "a****@x.com"],
    ["abcdefghij@x.com", "abcd****@x.com"],
    ["no-at-sign", "****"],
  ];
  for (const [input, expected] of table) assert.equal(maskEmail(input), expected, input);
});

test("S18: queryClaudeAccount uses `claude auth status` JSON first", async () => {
  const { home, claudeDir } = dirs();
  writeFileSync(join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "file@x.y" } }));
  const envs: Record<string, string | undefined>[] = [];
  const yes = async (env: Record<string, string | undefined>) => {
    envs.push(env);
    return JSON.stringify({ loggedIn: true, email: "cli@x.y", configDirectory: "/d" });
  };
  assert.deepEqual(await queryClaudeAccount({ claudeConfigDir: claudeDir, homeDir: home, run: yes }), { email: "cli@x.y" });
  assert.equal(envs[0].CLAUDE_CONFIG_DIR, claudeDir);
  const no = async () => JSON.stringify({ loggedIn: false });
  assert.equal(await queryClaudeAccount({ claudeConfigDir: claudeDir, homeDir: home, run: no }), null);
});

test("S18: the runner env has no CLAUDE_CONFIG_DIR for a system-default profile", async () => {
  const { home } = dirs();
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/should/be/removed";
  try {
    let seen: Record<string, string | undefined> | undefined;
    const run = async (env: Record<string, string | undefined>) => {
      seen = env;
      return JSON.stringify({ loggedIn: true, email: "me@x.y" });
    };
    assert.deepEqual(await queryClaudeAccount({ claudeConfigDir: undefined, homeDir: home, run }), { email: "me@x.y" });
    assert.equal("CLAUDE_CONFIG_DIR" in seen!, false);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, "/should/be/removed");
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test("S18: garbage, a throwing runner or a timeout fall back to .claude.json without throwing", async () => {
  const { home, claudeDir } = dirs();
  writeFileSync(join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "file@x.y" } }));
  const runners = [
    async () => "not json at all",
    async () => JSON.stringify({ something: "else" }),
    async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    },
    async () => {
      throw Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
    },
    () => {
      throw new Error("sync throw");
    },
  ];
  for (const run of runners) {
    assert.deepEqual(await queryClaudeAccount({ claudeConfigDir: claudeDir, homeDir: home, run: run as never }), { email: "file@x.y" });
  }
  const other = join(home, "empty-claude");
  assert.equal(await queryClaudeAccount({ claudeConfigDir: other, homeDir: home, run: runners[0] }), null);
});

test("S18: the <home>/.claude.json fallback applies only to the system-default profile", async () => {
  const { home, claudeDir } = dirs();
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "home@x.y" } }));
  const fail = async () => {
    throw new Error("missing");
  };
  assert.deepEqual(await queryClaudeAccount({ claudeConfigDir: undefined, homeDir: home, run: fail }), { email: "home@x.y" });
  assert.equal(await queryClaudeAccount({ claudeConfigDir: claudeDir, homeDir: home, run: fail }), null);
});

test("S29: statusText hides by default and prints the full email only when shown", () => {
  const a = { email: "fcireza@gmail.com" };
  assert.equal(statusText("work", a, {}), "👤 gentle-accounts: work · fcir****@gmail.com");
  assert.equal(statusText("work", a, { showEmail: false }), "👤 gentle-accounts: work · fcir****@gmail.com");
  assert.equal(statusText("work", a, { showEmail: true }), "👤 gentle-accounts: work · fcireza@gmail.com");
  assert.equal(statusText("work", null, { showEmail: true }), "🔒 gentle-accounts: work · not logged in");
  assert.equal(statusText("work", null, { showEmail: false }), "🔒 gentle-accounts: work · not logged in");
});

// ---- S34: covered providers generalization ----

test("S34: providerStates keeps the base rows and adds every other oauth provider, never api keys or malformed entries", () => {
  const auth = {
    "openai-codex": { type: "oauth", access: "secret-a", expires: 1 },
    "google-antigravity": { type: "oauth", access: "secret-g", expires: 2 },
    google: { type: "api_key", key: "secret-k" },
    weird1: null,
    weird2: "oauth",
    weird3: ["oauth"],
  };
  const rows = providerStates(null, auth);
  assert.deepEqual(rows, [
    { provider: "claude", label: "Claude (claude-bridge)", loggedIn: false },
    { provider: "openai-codex", label: "Codex", loggedIn: true },
    { provider: "anthropic", label: "Anthropic", loggedIn: false },
    { provider: "google-antigravity", label: "google-antigravity", loggedIn: true },
  ]);
  assert.equal(JSON.stringify(rows).includes("secret"), false);
});

test("S34: providerStates with base providers only is unchanged (api key anthropic counts as logged in)", () => {
  assert.deepEqual(providerStates(null, { anthropic: { type: "api_key", key: "k" } }).slice(1), [
    { provider: "openai-codex", label: "Codex", loggedIn: false },
    { provider: "anthropic", label: "Anthropic", loggedIn: true },
  ]);
});
