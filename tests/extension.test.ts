import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import gentleProfiles from "../src/index.ts";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile } from "../src/auth-sync.ts";

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function fakePi() {
  const commands = new Map<string, { handler: Handler; getArgumentCompletions?: (p: string) => unknown }>();
  const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = {
    registerCommand: (name: string, options: { handler: Handler; getArgumentCompletions?: (p: string) => unknown }) =>
      commands.set(name, options),
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => events.set(event, handler),
  } as unknown as ExtensionAPI;
  return { pi, commands, events };
}

function fakeCtx(overrides: { hasUI?: boolean; idle?: boolean; select?: string; confirm?: boolean } = {}) {
  const notes: { message: string; type?: string }[] = [];
  let refreshed = 0;
  const statuses: { key: string; text: string | undefined }[] = [];
  const ctx = {
    hasUI: overrides.hasUI ?? true,
    isIdle: () => overrides.idle ?? true,
    ui: {
      notify: (message: string, type?: string) => notes.push({ message, type }),
      select: async () => overrides.select,
      confirm: async () => overrides.confirm ?? false,
      setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
    },
    modelRegistry: { refresh: async () => void refreshed++ },
  } as unknown as ExtensionCommandContext;
  return { ctx, notes, statuses, refreshed: () => refreshed };
}

type Runner = (env: Record<string, string | undefined>) => Promise<string>;
/** The real `claude` binary must never run in tests: the default stub behaves like a missing CLI. */
const missingClaude: Runner = async () => {
  throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
};

function setup(deps: Parameters<typeof gentleProfiles>[1] = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-profiles-ext-"));
  // Never read the real ~/.claude.json.
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const { pi, commands, events } = fakePi();
  gentleProfiles(pi, { runClaudeStatus: missingClaude, setInterval: () => ({ unref() {} }), clearInterval: () => {}, ...deps });
  const profile = commands.get("profile")!;
  return { agentDir, store: new ProfileStore(agentDir), profile, events, liveAuthPath: join(agentDir, "auth.json") };
}

test("registers /profile and a session_start hook", () => {
  const { profile, events } = setup();
  assert.ok(profile);
  assert.ok(events.get("session_start"));
});

test("session_start wraps the live login into a default profile and leaves CLAUDE_CONFIG_DIR unset (S16)", async () => {
  const { store, events, liveAuthPath } = setup();
  writeFileSync(liveAuthPath, JSON.stringify({ anthropic: { type: "api_key", key: "k" } }));
  await events.get("session_start")!({}, {});
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { anthropic: { type: "api_key", key: "k" } });
  assert.equal("CLAUDE_CONFIG_DIR" in process.env, false);
});

test("session_start on a later run only applies the current profile's env", async () => {
  const { store, events } = setup();
  store.create("work");
  store.setCurrent("work");
  await events.get("session_start")!({}, {});
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
});

test("session_start with a corrupt live auth.json notifies instead of throwing", async () => {
  const { store, events, liveAuthPath } = setup();
  writeFileSync(liveAuthPath, "{broken");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.equal(c.notes.length, 1);
  assert.equal(c.notes[0].type, "error");
  assert.match(c.notes[0].message, /^gentle-profiles: Cannot parse/);
  assert.deepEqual(store.list(), []);
});

test("/profile create, list, current and switch", async () => {
  const { store, profile, liveAuthPath } = setup();
  writeFileSync(liveAuthPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 } }));
  const c1 = fakeCtx();
  await profile.handler("create work", c1.ctx);
  assert.match(c1.notes[0].message, /Created profile "work"/);
  await profile.handler("create Work", c1.ctx);
  assert.equal(c1.notes[1].message, 'Invalid profile name "Work": use lowercase letters, digits, "-" or "_" (max 32 chars).');
  assert.equal(c1.notes[1].type, "error");

  const c2 = fakeCtx();
  await profile.handler("work", c2.ctx);
  assert.match(c2.notes[0].message, /Switched to profile "work"/);
  assert.equal(c2.refreshed(), 1);
  assert.equal(store.current(), "work");
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  assert.deepEqual(readAuthFile(liveAuthPath), {});
  assert.deepEqual(readAuthFile(store.authPath("default")), { "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 } });

  const c3 = fakeCtx();
  await profile.handler("work", c3.ctx);
  assert.equal(c3.notes[0].message, 'Already on profile "work".');
  assert.equal(c3.refreshed(), 0);

  const c4 = fakeCtx();
  await profile.handler("list", c4.ctx);
  assert.equal(c4.notes[0].message, "  default\n* work");
  await profile.handler("current", c4.ctx);
  assert.match(c4.notes[1].message, /^Active profile: work/);
});

test("/profile with no args uses the picker and strips the (active) marker", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  const c = fakeCtx({ select: "personal" });
  await profile.handler("", c.ctx);
  assert.equal(store.current(), "personal");
  const back = fakeCtx({ select: "work" });
  await profile.handler("", back.ctx);
  assert.equal(store.current(), "work");
  const same = fakeCtx({ select: "work (active)" });
  await profile.handler("", same.ctx);
  assert.equal(same.notes[0].message, 'Already on profile "work".');
});

test("switching refuses while the agent is busy and for unknown profiles", async () => {
  const { store, profile } = setup();
  store.create("work");
  const busy = fakeCtx({ idle: false });
  await profile.handler("work", busy.ctx);
  assert.match(busy.notes[0].message, /Wait for the current turn/);
  assert.equal(store.current(), null);
  const ghost = fakeCtx();
  await profile.handler("ghost", ghost.ctx);
  assert.equal(ghost.notes[0].message, 'Profile "ghost" does not exist.');
});

test("/profile delete asks for confirmation, refuses the active and missing profiles", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  const active = fakeCtx({ confirm: true });
  await profile.handler("delete work", active.ctx);
  assert.equal(active.notes[0].message, 'Cannot delete the active profile "work". Switch to another profile first.');
  const missing = fakeCtx({ confirm: true });
  await profile.handler("delete ghost", missing.ctx);
  assert.equal(missing.notes[0].message, 'Profile "ghost" does not exist.');
  const declined = fakeCtx({ confirm: false });
  await profile.handler("delete personal", declined.ctx);
  assert.equal(declined.notes[0].message, "Delete cancelled.");
  assert.deepEqual(store.list(), ["personal", "work"]);
  const ok = fakeCtx({ confirm: true });
  await profile.handler("delete personal", ok.ctx);
  assert.equal(ok.notes[0].message, 'Deleted profile "personal".');
  assert.deepEqual(store.list(), ["work"]);
});

test("/profile login claude prints the login command for the active profile", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.setCurrent("work");
  const c = fakeCtx();
  await profile.handler("login claude", c.ctx);
  assert.match(c.notes[0].message, /claude auth login/);
  assert.ok(c.notes[0].message.includes(store.claudeDir("work")));
});

test("argument completions offer subcommands and profile names", () => {
  const { store, profile } = setup();
  store.create("work");
  assert.deepEqual(profile.getArgumentCompletions!("w"), [{ value: "work", label: "work" }]);
  assert.deepEqual(profile.getArgumentCompletions!("li"), [{ value: "list", label: "list" }]);
  assert.equal(profile.getArgumentCompletions!("zzz"), null);
});

test("/profile switch to a corrupt target with no active profile creates nothing", async () => {
  const { store, profile, liveAuthPath } = setup();
  store.create("work");
  writeFileSync(liveAuthPath, JSON.stringify({ anthropic: { type: "api_key", key: "k" } }));
  writeFileSync(store.authPath("work"), "{bad");
  const c = fakeCtx();
  await profile.handler("work", c.ctx);
  assert.equal(c.notes[0].type, "error");
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(store.current(), null);
});

function writeAccount(claudeDir: string, email: string) {
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email, accessToken: "x" } }));
}

test("status bar shows the active account after session_start, switch and /profile current", async () => {
  const { store, profile, events } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAccount(store.claudeDir("work"), "w@x.y");

  const c1 = fakeCtx();
  await events.get("session_start")!({}, c1.ctx);
  assert.deepEqual(c1.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: work · w****@x.y" }]);

  const c2 = fakeCtx();
  await profile.handler("personal", c2.ctx);
  assert.deepEqual(c2.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: personal · not logged in" }]);

  const c3 = fakeCtx();
  await profile.handler("personal", c3.ctx);
  assert.deepEqual(c3.statuses, []);

  writeAccount(store.claudeDir("personal"), "p@x.y");
  const c4 = fakeCtx();
  await profile.handler("current", c4.ctx);
  assert.deepEqual(c4.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: personal · p****@x.y" }]);
  assert.match(c4.notes[0].message, /^Active profile: personal/);
});

test("status is cleared with no active profile and untouched without UI", async () => {
  const { profile, events } = setup();
  const c1 = fakeCtx();
  await profile.handler("current", c1.ctx);
  assert.equal(c1.notes[0].message, "No active profile.");
  assert.deepEqual(c1.statuses, [{ key: "gentle-profiles", text: undefined }]);

  const c2 = fakeCtx({ hasUI: false });
  await events.get("session_start")!({}, c2.ctx);
  await profile.handler("current", c2.ctx);
  assert.deepEqual(c2.statuses, []);
});

test("S16: /profile default -> work -> default sets then deletes CLAUDE_CONFIG_DIR in process.env", async () => {
  const { store, profile, events } = setup();
  await events.get("session_start")!({}, fakeCtx().ctx);
  assert.equal(store.current(), "default");
  store.create("work");
  const c1 = fakeCtx();
  await profile.handler("work", c1.ctx);
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  const c2 = fakeCtx();
  await profile.handler("default", c2.ctx);
  assert.equal("CLAUDE_CONFIG_DIR" in process.env, false);
  assert.equal(c2.notes[0].message, 'Switched to profile "default". Claude Code dir: (unset: Claude Code default)');
  const c3 = fakeCtx();
  await profile.handler("current", c3.ctx);
  assert.equal(c3.notes[0].message, "Active profile: default (CLAUDE_CONFIG_DIR=(unset: Claude Code default))");
  await profile.handler("login claude", c3.ctx);
  assert.equal(c3.notes[1].message, 'Run this in another terminal to log profile "default" into Claude Code:\nclaude auth login');
});

test("S16: a legacy default whose claude-dir is <home>/.claude is treated as the system default", async () => {
  const { store, agentDir, events } = setup();
  store.create("default", { claudeDir: join(agentDir, ".claude") });
  store.setCurrent("default");
  await events.get("session_start")!({}, fakeCtx().ctx);
  assert.equal("CLAUDE_CONFIG_DIR" in process.env, false);
});

test("S17/S18: status uses claude auth status, masks the email and never shows it unmasked", async () => {
  const seen: Record<string, string | undefined>[] = [];
  const run: Runner = async (env) => {
    seen.push(env);
    return JSON.stringify({ loggedIn: true, email: "fcireza@gmail.com" });
  };
  const { store, profile, events } = setup({ runClaudeStatus: run });
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  await profile.handler("personal", c.ctx);
  await profile.handler("current", c.ctx);
  await profile.handler("login claude", c.ctx);
  await profile.handler("list", c.ctx);
  assert.deepEqual(c.statuses.map((x) => x.text), [
    "gentle-profiles: work · fcir****@gmail.com",
    "gentle-profiles: personal · fcir****@gmail.com",
    "gentle-profiles: personal · fcir****@gmail.com",
  ]);
  assert.equal(seen[0].CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  const everything = JSON.stringify([c.statuses, c.notes]);
  assert.equal(everything.includes("fcireza@"), false);
});

test("S18: CLI loggedIn false wins over a .claude.json email", async () => {
  const { store, events } = setup({ runClaudeStatus: async () => JSON.stringify({ loggedIn: false }) });
  store.create("work");
  store.setCurrent("work");
  writeAccount(store.claudeDir("work"), "w@x.y");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.deepEqual(c.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: work · not logged in" }]);
});

test("S18: the status refreshes on agent_end", async () => {
  let email = "one@x.y";
  const { store, events } = setup({ runClaudeStatus: async () => JSON.stringify({ loggedIn: true, email }) });
  store.create("work");
  store.setCurrent("work");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  email = "twotwo@x.y";
  assert.ok(events.get("agent_end"));
  await events.get("agent_end")!({}, c.ctx);
  assert.deepEqual(c.statuses.map((x) => x.text), ["gentle-profiles: work · o****@x.y", "gentle-profiles: work · two****@x.y"]);
});

test("S18: a 60 s unref'd timer starts once on session_start, refreshes, and is cleared on session_shutdown", async () => {
  const timers: { fn: () => void; ms: number; unrefed: boolean; cleared: boolean }[] = [];
  const { store, events } = setup({
    runClaudeStatus: async () => JSON.stringify({ loggedIn: true, email: "abcde@x.y" }),
    setInterval: (fn: () => void, ms: number) => {
      const t = { fn, ms, unrefed: false, cleared: false, unref() { t.unrefed = true; } };
      timers.push(t);
      return t;
    },
    clearInterval: (t: unknown) => {
      (t as { cleared: boolean }).cleared = true;
    },
  });
  store.create("work");
  store.setCurrent("work");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  await events.get("session_start")!({}, c.ctx);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 60_000);
  assert.equal(timers[0].unrefed, true);
  c.statuses.length = 0;
  timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(c.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: work · ab****@x.y" }]);
  assert.ok(events.get("session_shutdown"));
  await events.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, c.ctx);
  assert.equal(timers[0].cleared, true);
  await events.get("session_start")!({}, c.ctx);
  assert.equal(timers.length, 2);
});

test("S18: overlapping refreshes are skipped and a stale result never overwrites a newer profile", async () => {
  const pending = new Map<string, (out: string) => void>();
  let calls = 0;
  const run: Runner = (env) => {
    calls++;
    return new Promise((resolve) => pending.set(env.CLAUDE_CONFIG_DIR ?? "", resolve));
  };
  const { store, events } = setup({ runClaudeStatus: run });
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  const c = fakeCtx();
  const first = events.get("agent_end")!({}, c.ctx) as Promise<void>;
  const overlap = events.get("agent_end")!({}, c.ctx) as Promise<void>;
  await overlap;
  assert.equal(calls, 1);
  store.setCurrent("personal");
  const second = events.get("agent_end")!({}, c.ctx) as Promise<void>;
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  pending.get(store.claudeDir("personal"))!(JSON.stringify({ loggedIn: true, email: "pers@x.y" }));
  await second;
  pending.get(store.claudeDir("work"))!(JSON.stringify({ loggedIn: true, email: "work@x.y" }));
  await first;
  assert.deepEqual(c.statuses, [{ key: "gentle-profiles", text: "gentle-profiles: personal · p****@x.y" }]);
});
