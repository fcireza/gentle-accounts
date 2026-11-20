import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import gentleProfiles from "../src/index.ts";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile, LAUNCH_PROFILE_ENV } from "../src/auth-sync.ts";
import { runCli, type SpawnCall } from "../src/cli.ts";
import { SESSION_CURRENT, buildSessionHome } from "../src/session-home.ts";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { claudeLoginCommand } from "../src/login.ts";

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
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-ext-"));
  // Never read the real ~/.claude.json.
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const { pi, commands, events } = fakePi();
  gentleProfiles(pi, { runClaudeStatus: missingClaude, setInterval: () => ({ unref() {} }), clearInterval: () => {}, ...deps });
  const profile = commands.get("gentle:accounts")!;
  return { agentDir, store: new ProfileStore(agentDir), profile, events, liveAuthPath: join(agentDir, "auth.json") };
}

const PROMPT = process.platform === "win32" ? "PS> " : "$ ";

test("registers /gentle:accounts and a session_start hook", () => {
  const { profile, events } = setup();
  assert.ok(profile);
  assert.ok(events.get("session_start"));
});

test("S19: registers exactly one command, gentle:accounts, and no profile command", () => {
  const { pi, commands } = fakePi();
  gentleProfiles(pi, { runClaudeStatus: missingClaude, setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  assert.deepEqual([...commands.keys()], ["gentle:accounts"]);
  assert.equal(commands.has("profile"), false);
});

test("S19: /gentle:accounts help uses the new command name only", async () => {
  const { profile } = setup();
  const c = fakeCtx();
  await profile.handler("help", c.ctx);
  assert.match(c.notes[0].message, /^\/gentle:accounts +open the accounts menu \(picker without the TUI\)$/m);
  assert.match(c.notes[0].message, /^\/gentle:accounts menu +open the accounts menu$/m);
  assert.match(c.notes[0].message, /^\/gentle:accounts login claude +show the command/m);
  assert.doesNotMatch(c.notes[0].message, /\/profile/);
  const d = fakeCtx();
  await profile.handler("list", d.ctx);
  assert.deepEqual(d.notes, [{ message: "No profiles. Create one with /gentle:accounts create <name>", type: "info" }]);
  const e = fakeCtx();
  await profile.handler("create work", e.ctx);
  assert.deepEqual(e.notes, [{ message: 'Created profile "work". Switch with /gentle:accounts work, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.', type: "info" }]);
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
  assert.match(c.notes[0].message, /^gentle-accounts: Cannot parse/);
  assert.deepEqual(store.list(), []);
});

test("/gentle:accounts create, list, current and switch", async () => {
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

test("/gentle:accounts with no args uses the picker and strips the (active) marker", async () => {
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

test("/gentle:accounts delete asks for confirmation, refuses the active and missing profiles", async () => {
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

test("/gentle:accounts login claude prints the login command for the active profile", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.setCurrent("work");
  const c = fakeCtx();
  await profile.handler("login claude", c.ctx);
  const cmd = claudeLoginCommand(store.claudeDir("work"));
  assert.equal(c.notes[0].message,
    'To log profile "work" into Claude Code, run this in ANOTHER terminal (it opens your browser):\n\n' +
    `  ${PROMPT}${cmd}\n\n` +
    "Or run it from a terminal with the launcher: gentle-accounts login work\n" +
    "When it finishes, run /gentle:accounts current to see the account.");
});

test("argument completions offer subcommands and profile names", () => {
  const { store, profile } = setup();
  store.create("work");
  assert.deepEqual(profile.getArgumentCompletions!("w"), [{ value: "work", label: "work" }]);
  assert.deepEqual(profile.getArgumentCompletions!("li"), [{ value: "list", label: "list" }]);
  assert.equal(profile.getArgumentCompletions!("zzz"), null);
});

test("/gentle:accounts switch to a corrupt target with no active profile creates nothing", async () => {
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

test("status bar shows the active account after session_start, switch and /gentle:accounts current", async () => {
  const { store, profile, events } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAccount(store.claudeDir("work"), "w@x.y");

  const c1 = fakeCtx();
  await events.get("session_start")!({}, c1.ctx);
  assert.deepEqual(c1.statuses, [{ key: "gentle-accounts", text: "👤 gentle-accounts: work" }]);

  const c2 = fakeCtx();
  await profile.handler("personal", c2.ctx);
  assert.deepEqual(c2.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: personal · not logged in" }]);

  const c3 = fakeCtx();
  await profile.handler("personal", c3.ctx);
  assert.deepEqual(c3.statuses, []);

  writeAccount(store.claudeDir("personal"), "p@x.y");
  const c4 = fakeCtx();
  await profile.handler("current", c4.ctx);
  assert.deepEqual(c4.statuses, [{ key: "gentle-accounts", text: "👤 gentle-accounts: personal" }]);
  assert.match(c4.notes[0].message, /^Active profile: personal/);
});

test("status is cleared with no active profile and untouched without UI", async () => {
  const { profile, events } = setup();
  const c1 = fakeCtx();
  await profile.handler("current", c1.ctx);
  assert.equal(c1.notes[0].message, "No active profile.");
  assert.deepEqual(c1.statuses, [{ key: "gentle-accounts", text: undefined }]);

  const c2 = fakeCtx({ hasUI: false });
  await events.get("session_start")!({}, c2.ctx);
  await profile.handler("current", c2.ctx);
  assert.deepEqual(c2.statuses, []);
});

test("S16: /gentle:accounts default -> work -> default sets then deletes CLAUDE_CONFIG_DIR in process.env", async () => {
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
  assert.equal(c3.notes[1].message,
    'To log profile "default" into Claude Code, run this in ANOTHER terminal (it opens your browser):\n\n' +
    `  ${PROMPT}claude auth login\n\n` +
    "Or run it from a terminal with the launcher: gentle-accounts login default\n" +
    "When it finishes, run /gentle:accounts current to see the account.");
});

test("S16: a legacy default whose claude-dir is <home>/.claude is treated as the system default", async () => {
  const { store, agentDir, events } = setup();
  store.create("default", { claudeDir: join(agentDir, ".claude") });
  store.setCurrent("default");
  await events.get("session_start")!({}, fakeCtx().ctx);
  assert.equal("CLAUDE_CONFIG_DIR" in process.env, false);
});

test("S17/S18: status uses claude auth status, never shows the email while hidden", async () => {
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
    "👤 gentle-accounts: work",
    "👤 gentle-accounts: personal",
    "👤 gentle-accounts: personal",
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
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: work · not logged in" }]);
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
  assert.deepEqual(c.statuses.map((x) => x.text), ["👤 gentle-accounts: work", "👤 gentle-accounts: work"]);
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
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "👤 gentle-accounts: work" }]);
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
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "👤 gentle-accounts: personal" }]);
});

test("S27: /gentle:accounts startup shows, sets and clears the session profile", async () => {
  const { store, profile } = setup();
  const show = async () => {
    const c = fakeCtx();
    await profile.handler("startup", c.ctx);
    return c.notes;
  };
  assert.deepEqual(await show(), [{ message: "Session profile: none (new sessions start on the last used profile: none)", type: "info" }]);
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  assert.deepEqual(await show(), [{ message: "Session profile: none (new sessions start on the last used profile: personal)", type: "info" }]);

  const set = fakeCtx();
  await profile.handler("startup work", set.ctx);
  assert.deepEqual(set.notes, [{ message: 'Session profile set to "work". New sessions start on it.', type: "info" }]);
  assert.equal(store.startup(), "work");
  assert.equal(store.current(), "personal");
  assert.deepEqual(await show(), [{ message: "Session profile: work", type: "info" }]);

  const bad = fakeCtx();
  await profile.handler("startup Bad", bad.ctx);
  assert.deepEqual(bad.notes, [{ message: 'Invalid profile name "Bad": use lowercase letters, digits, "-" or "_" (max 32 chars).', type: "error" }]);
  const ghost = fakeCtx();
  await profile.handler("startup ghost", ghost.ctx);
  assert.deepEqual(ghost.notes, [{ message: 'Profile "ghost" does not exist.', type: "error" }]);
  assert.equal(store.startup(), "work");

  const last = fakeCtx();
  await profile.handler("session last", last.ctx);
  assert.deepEqual(last.notes, [{ message: "Session profile cleared. New sessions start on the last used profile.", type: "info" }]);
  assert.equal(store.startup(), null);
});

test("session and its alias startup give identical output and effect in /gentle:accounts", async () => {
  const run = async (word: string) => {
    const { store, profile } = setup();
    const notes: unknown[] = [];
    store.create("work");
    for (const arg of ["", " work", "", " last", ""]) {
      const c = fakeCtx();
      await profile.handler(`${word}${arg}`, c.ctx);
      notes.push(c.notes, store.startup());
    }
    return notes;
  };
  const a = await run("session");
  assert.deepEqual(await run("startup"), a);
  assert.match(JSON.stringify(a), /Session profile set to/);
});

test("S27: help, usage and completions list startup", async () => {
  const { profile } = setup();
  const c = fakeCtx();
  await profile.handler("help", c.ctx);
  assert.match(c.notes[0].message, /^\/gentle:accounts session \[<name>\|last\] +.*\(alias: startup\)/m);
  const completions = profile.getArgumentCompletions!("sta") as { value: string }[];
  assert.deepEqual(completions.map((x) => x.value), ["startup"]);
  const ses = profile.getArgumentCompletions!("ses") as { value: string }[];
  assert.deepEqual(ses.map((x) => x.value), ["session"]);
});

test("S27: session_start switches to the session profile and notifies", async () => {
  const { store, events, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  store.setStartup("work");
  writeFileSync(liveAuthPath, JSON.stringify({ anthropic: { type: "api_key", key: "p" } }));
  writeFileSync(store.authPath("work"), JSON.stringify({ anthropic: { type: "api_key", key: "w" } }));
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.deepEqual(c.notes, [{ message: 'Started on profile "work" (session profile).', type: "info" }]);
  assert.equal(store.current(), "work");
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: { type: "api_key", key: "w" } });
  assert.deepEqual(readAuthFile(store.authPath("personal")), { anthropic: { type: "api_key", key: "p" } });
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: work · not logged in" }]);
});

test("S27: the session profile is applied only when the process starts, not on new, resume, fork or reload", async () => {
  const { store, events, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal"); // a manual switch made earlier in this process
  store.setStartup("work");
  writeFileSync(liveAuthPath, JSON.stringify({ anthropic: { type: "api_key", key: "p" } }));
  writeFileSync(store.authPath("work"), JSON.stringify({ anthropic: { type: "api_key", key: "w" } }));
  for (const reason of ["new", "resume", "fork", "reload"]) {
    const c = fakeCtx();
    await events.get("session_start")!({ type: "session_start", reason }, c.ctx);
    assert.equal(store.current(), "personal", reason);
    assert.deepEqual(c.notes, [], reason);
    assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: { type: "api_key", key: "p" } }, reason);
  }
  const c = fakeCtx();
  await events.get("session_start")!({ type: "session_start", reason: "startup" }, c.ctx);
  assert.equal(store.current(), "work");
  assert.deepEqual(c.notes, [{ message: 'Started on profile "work" (session profile).', type: "info" }]);
});

test("S27: session_start with the session profile already active changes nothing", async () => {
  const { store, events, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  store.setStartup("work");
  writeFileSync(liveAuthPath, '{"anthropic":{"type":"api_key","key":"w"}}');
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.deepEqual(c.notes, []);
  assert.equal(readFileSync(liveAuthPath, "utf8"), '{"anthropic":{"type":"api_key","key":"w"}}');
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: work · not logged in" }]);
});

test("S27: session_start with a corrupt startup target notifies an error and keeps working", async () => {
  const { store, profile, events, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  store.setStartup("work");
  writeFileSync(store.authPath("work"), "{bad");
  writeFileSync(liveAuthPath, "{}");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.equal(c.notes.length, 1);
  assert.equal(c.notes[0].type, "error");
  assert.match(c.notes[0].message, /^gentle-accounts: Cannot parse/);
  assert.equal(store.current(), "personal");
  assert.equal(readFileSync(liveAuthPath, "utf8"), "{}");
  const l = fakeCtx();
  await profile.handler("list", l.ctx);
  assert.deepEqual(l.notes, [{ message: "* personal\n  work", type: "info" }]);
});

test("S27: delete refuses the session profile", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  store.setStartup("work");
  const c = fakeCtx({ confirm: true });
  await profile.handler("delete work", c.ctx);
  assert.deepEqual(c.notes, [{ message: 'Cannot delete the session profile "work". Set another one or clear it with "session last" first.', type: "error" }]);
  assert.deepEqual(store.list(), ["personal", "work"]);
});

function startupScenario() {
  const s = setup();
  s.store.create("work");
  s.store.create("personal");
  s.store.setCurrent("personal");
  s.store.setStartup("work");
  writeFileSync(s.liveAuthPath, "{}");
  return s;
}

test("S27: session_start launched by `gentle-accounts personal` (env var set) skips the startup switch", async () => {
  const { store, events, liveAuthPath } = startupScenario();
  process.env[LAUNCH_PROFILE_ENV] = "personal";
  try {
    const c = fakeCtx();
    await events.get("session_start")!({}, c.ctx);
    assert.deepEqual(c.notes, []);
    assert.equal(store.current(), "personal");
    assert.equal(readFileSync(liveAuthPath, "utf8"), "{}");
    assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("personal"));
    assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: personal · not logged in" }]);
  } finally {
    delete process.env[LAUNCH_PROFILE_ENV];
  }
});

test("S27: an empty launch variable does not skip the startup switch", async () => {
  const { store, events } = startupScenario();
  process.env[LAUNCH_PROFILE_ENV] = "";
  try {
    const c = fakeCtx();
    await events.get("session_start")!({}, c.ctx);
    assert.deepEqual(c.notes, [{ message: 'Started on profile "work" (session profile).', type: "info" }]);
    assert.equal(store.current(), "work");
  } finally {
    delete process.env[LAUNCH_PROFILE_ENV];
  }
});

test("S27+S30: real launcher env reaches session_start: the launched session runs on its profile without the startup switch", async () => {
  const { store, events, liveAuthPath, agentDir } = startupScenario();
  store.setCurrent("work"); // global current and startup are both "work"; the launch asks for "personal"
  const spawns: SpawnCall[] = [];
  const seen: { notes: unknown[]; current: string | null; globalCurrent: string | null }[] = [];
  const code = await runCli(["personal"], {
    store, liveAuthPath, env: { PATH: "/usr/bin" }, platform: "linux", stdout: () => {}, stderr: () => {},
    sessionBaseDir: join(agentDir, "session-homes"),
    spawn: async (call) => {
      spawns.push(call);
      const saved = { ...process.env };
      Object.assign(process.env, call.env, { PI_CODING_AGENT_DIR: call.args[1], HOME: agentDir, USERPROFILE: agentDir });
      try {
        const c = fakeCtx();
        await events.get("session_start")!({}, c.ctx);
        seen.push({ notes: c.notes, current: readFileSync(join(call.args[1], SESSION_CURRENT), "utf8").trim(), globalCurrent: store.current() });
      } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
      }
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(seen, [{ notes: [], current: "personal", globalCurrent: "work" }]);
  assert.equal(store.current(), "work");
});

test("S27: a startup file naming a deleted profile warns at session_start and changes nothing", async () => {
  const { store, profile, events, liveAuthPath } = startupScenario();
  writeFileSync(store.startupPath, "ghost\n");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.deepEqual(c.notes, [{ message: 'Session profile "ghost" does not exist; starting on the last used profile.', type: "warning" }]);
  assert.equal(store.current(), "personal");
  assert.equal(readFileSync(liveAuthPath, "utf8"), "{}");
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: personal · not logged in" }]);
  const l = fakeCtx();
  await profile.handler("list", l.ctx);
  assert.deepEqual(l.notes, [{ message: "* personal\n  work", type: "info" }]);
});

const FULL = "maria.lopez@company.com";

test("S29: /gentle:accounts email shows, sets, warns on usage, and refreshes the status right away", async () => {
  const { store, profile, events, agentDir } = setup({ runClaudeStatus: async () => JSON.stringify({ loggedIn: true, email: FULL }) });
  store.create("work");
  store.setCurrent("work");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  await profile.handler("email", c.ctx);
  await profile.handler("email show", c.ctx);
  await profile.handler("email", c.ctx);
  await profile.handler("current", c.ctx);
  await profile.handler("email hide", c.ctx);
  await profile.handler("email maybe", c.ctx);
  assert.deepEqual(c.notes, [
    { message: "Email display: hidden (not shown in the status bar)", type: "info" },
    { message: "Email display set to shown. The status bar shows the full email.", type: "info" },
    { message: "Email display: shown (full email in the status bar)", type: "info" },
    { message: `Active profile: work (CLAUDE_CONFIG_DIR=${store.claudeDir("work")})`, type: "info" },
    { message: "Email display set to hidden. The status bar does not show the email.", type: "info" },
    { message: "Usage: /gentle:accounts email [show|hide]", type: "warning" },
  ]);
  assert.deepEqual(c.statuses.map((x) => x.text), [
    "👤 gentle-accounts: work",
    "👤 gentle-accounts: work · maria.lopez@company.com",
    "👤 gentle-accounts: work · maria.lopez@company.com",
    "👤 gentle-accounts: work",
  ]);
  assert.equal(JSON.stringify(c.notes).includes("maria.lopez"), false);
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "settings.json"), "utf8")), { showEmail: false });
});

test("S29: refreshes pick up the setting changed on disk; notifications never carry the email", async () => {
  const { store, profile, events, agentDir } = setup({ runClaudeStatus: async () => JSON.stringify({ loggedIn: true, email: FULL }) });
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  writeFileSync(join(agentDir, "profiles", "settings.json"), JSON.stringify({ showEmail: true }));
  await events.get("agent_end")!({}, c.ctx);
  await profile.handler("personal", c.ctx);
  await profile.handler("list", c.ctx);
  await profile.handler("help", c.ctx);
  writeFileSync(join(agentDir, "profiles", "settings.json"), "{broken");
  await events.get("agent_end")!({}, c.ctx);
  assert.deepEqual(c.statuses.map((x) => x.text), [
    "👤 gentle-accounts: work",
    "👤 gentle-accounts: work · maria.lopez@company.com",
    "👤 gentle-accounts: personal · maria.lopez@company.com",
    "👤 gentle-accounts: personal",
  ]);
  assert.equal(readFileSync(join(agentDir, "profiles", "settings.json"), "utf8"), "{broken");
  assert.equal(JSON.stringify(c.notes).includes("maria.lopez"), false);
  assert.match(c.notes.at(-1)!.message, /^\/gentle:accounts email \[show\|hide\] +show or set whether the status bar shows the full email/m);
});

test("S29: argument completions include email", () => {
  const { profile } = setup();
  assert.deepEqual(profile.getArgumentCompletions!("em"), [{ value: "email", label: "email" }]);
});

// ---- S30: session mode (the agent dir is a private home built by the launcher) ----

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function sessionSetup(profile = "work") {
  const env = setup();
  const shared = realpathSync(env.agentDir);
  const store = new ProfileStore(shared);
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  writeAuthFile(store.authPath("work"), ({ anthropic: { type: "api_key", key: "w" } }));
  writeAuthFile(store.authPath("personal"), ({ "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 } }));
  writeFileSync(join(shared, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 }, other: { type: "api_key", key: "o" } }));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile, baseDir: join(shared, "homes") });
  process.env.PI_CODING_AGENT_DIR = home;
  const globalFiles = [join(shared, "auth.json"), store.currentPath, store.authPath("work"), store.authPath("personal")];
  const before = Object.fromEntries(globalFiles.map((p) => [p, sha(p)]));
  const unchanged = () => assert.deepEqual(Object.fromEntries(globalFiles.map((p) => [p, sha(p)])), before);
  return { ...env, shared, store, home, unchanged };
}

test("S30: session_start in a session home uses its own profile, skips the session profile and never writes global files", async () => {
  const { store, events, home, shared, unchanged } = sessionSetup("work");
  store.setStartup("personal");
  const c = fakeCtx();
  await events.get("session_start")!({ reason: "startup" }, c.ctx);
  assert.deepEqual(c.notes, []);
  assert.equal(readFileSync(join(home, SESSION_CURRENT), "utf8"), "work\n");
  assert.equal(store.current(), "personal");
  assert.equal(process.env.CLAUDE_CONFIG_DIR, join(shared, "profiles", "work", "claude"));
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: work · not logged in" }]);
  unchanged();
});

test("S30: a switch inside a session rewrites only H/auth.json and the session current", async () => {
  const { store, profile, events, home, shared, unchanged } = sessionSetup("work");
  await events.get("session_start")!({}, fakeCtx().ctx);
  const c = fakeCtx();
  await profile.handler("personal", c.ctx);
  assert.deepEqual(c.notes, [{ message: `Switched to profile "personal". Claude Code dir: ${join(shared, "profiles", "personal", "claude")}`, type: "info" }]);
  assert.equal(c.refreshed(), 1);
  assert.equal(readFileSync(join(home, SESSION_CURRENT), "utf8"), "personal\n");
  assert.deepEqual(readAuthFile(join(home, "auth.json")), { "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 }, other: { type: "api_key", key: "o" } });
  assert.deepEqual(c.statuses, [{ key: "gentle-accounts", text: "🔒 gentle-accounts: personal · not logged in" }]);
  unchanged();
  assert.equal(store.current(), "personal");
  const cur = fakeCtx();
  await profile.handler("current", cur.ctx);
  assert.deepEqual(cur.notes, [{ message: `Active profile: personal (CLAUDE_CONFIG_DIR=${join(shared, "profiles", "personal", "claude")})`, type: "info" }]);
  const list = fakeCtx();
  await profile.handler("list", list.ctx);
  assert.deepEqual(list.notes, [{ message: "* personal\n  work", type: "info" }]);
});

test("S30: list, current and delete use the session's current profile", async () => {
  const { store, profile, unchanged } = sessionSetup("work");
  const list = fakeCtx();
  await profile.handler("list", list.ctx);
  assert.deepEqual(list.notes, [{ message: "  personal\n* work", type: "info" }]);
  const del = fakeCtx({ confirm: true });
  await profile.handler("delete work", del.ctx);
  assert.deepEqual(del.notes, [{ message: 'Cannot delete the active profile "work". Switch to another profile first.', type: "error" }]);
  assert.deepEqual(store.list(), ["personal", "work"]);
  unchanged();
});

test("S30: startup and email in a session write the shared profiles folder", async () => {
  const { store, profile, shared, home } = sessionSetup("work");
  const s = fakeCtx();
  await profile.handler("startup work", s.ctx);
  assert.deepEqual(s.notes, [{ message: 'Session profile set to "work". New sessions start on it.', type: "info" }]);
  assert.equal(readFileSync(join(shared, "profiles", "startup"), "utf8"), "work\n");
  const e = fakeCtx();
  await profile.handler("email show", e.ctx);
  assert.equal(e.notes[0].message, "Email display set to shown. The status bar shows the full email.");
  assert.deepEqual(JSON.parse(readFileSync(join(shared, "profiles", "settings.json"), "utf8")), { showEmail: true });
  assert.equal(store.startup(), "work");
  assert.equal(existsSync(join(home, "profiles", "settings.json")), true, "reached through the shared profiles link");
  assert.deepEqual(readdirSync(home).filter((n) => n.startsWith("startup") || n === "settings.json.tmp"), []);
});

test("S30: a session whose profile was deleted creates default race-safely in the shared store and keeps it per session", async () => {
  const { store, events, home, shared } = sessionSetup("work");
  rmSync(join(home, SESSION_CURRENT));
  const c = fakeCtx();
  await events.get("session_start")!({}, c.ctx);
  assert.deepEqual(c.notes, []);
  assert.equal(readFileSync(join(home, SESSION_CURRENT), "utf8"), "default\n");
  assert.equal(store.current(), "personal");
  assert.deepEqual(store.list(), ["default", "personal", "work"]);
  assert.equal(existsSync(join(shared, "profiles", "default", "claude-default")), true);
});

test("S30: without a marker the agent dir keeps the global behavior", async () => {
  const { store, events, profile, agentDir } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  await events.get("session_start")!({}, fakeCtx().ctx);
  await profile.handler("personal", fakeCtx().ctx);
  assert.equal(store.current(), "personal");
  assert.equal(existsSync(join(agentDir, SESSION_CURRENT)), false);
});

// ---- S31: accounts menu ----

function menuCtx(mode: string | undefined, hasUI = true, select?: string) {
  const c = fakeCtx({ hasUI, select });
  let opened = 0;
  let selects = 0;
  const ui = (c.ctx as unknown as { ui: Record<string, unknown> }).ui;
  ui.custom = async () => {
    opened++;
    return { type: "close" };
  };
  const origSelect = ui.select as () => Promise<unknown>;
  ui.select = async () => {
    selects++;
    return origSelect();
  };
  (c.ctx as unknown as { mode?: string }).mode = mode;
  return { ...c, opened: () => opened, selects: () => selects };
}

test("S31: /gentle:accounts menu and the bare command open the panel in the TUI", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.setCurrent("work");
  for (const args of ["menu", "", "  "]) {
    const c = menuCtx("tui");
    await profile.handler(args, c.ctx);
    assert.equal(c.opened(), 1, JSON.stringify(args));
    assert.equal(c.selects(), 0);
    assert.deepEqual(c.notes, []);
  }
});

test("S31: without the TUI the menu falls back to the select picker (or usage without UI)", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  for (const mode of ["rpc", undefined]) {
    const c = menuCtx(mode, true, "personal");
    await profile.handler("menu", c.ctx);
    assert.equal(c.opened(), 0);
    assert.equal(c.selects(), 1);
    assert.equal(store.current(), "personal");
    store.setCurrent("work");
  }
  const noUi = menuCtx("tui", false);
  await profile.handler("", noUi.ctx);
  assert.equal(noUi.opened(), 0);
  assert.equal(noUi.notes[0].type, "warning");
  assert.match(noUi.notes[0].message, /\/gentle:accounts menu +open the accounts menu/);
});

test("S31: completions include menu; other commands unchanged in the TUI", async () => {
  const { store, profile } = setup();
  assert.deepEqual(profile.getArgumentCompletions!("me"), [{ value: "menu", label: "menu" }]);
  store.create("work");
  const c = menuCtx("tui");
  await profile.handler("work", c.ctx);
  await profile.handler("list", c.ctx);
  assert.equal(c.opened(), 0);
  assert.match(c.notes[0].message, /^Switched to profile "work"/);
  assert.match(c.notes[1].message, /^\* work$/m);
});

test("T22: /gentle:accounts create refuses a reserved name and email rejects extra words", async () => {
  const { store, profile } = setup();
  const c = fakeCtx();
  await profile.handler("create menu", c.ctx);
  assert.deepEqual(c.notes, [{ message: '"menu" is a reserved word (it is a subcommand). Pick another profile name.', type: "error" }]);
  assert.deepEqual(store.list(), []);
  const e = fakeCtx();
  await profile.handler("email show extra words", e.ctx);
  assert.deepEqual(e.notes, [{ message: "Usage: /gentle:accounts email [show|hide]", type: "warning" }]);
  const f = fakeCtx();
  await profile.handler("email hide", f.ctx);
  assert.deepEqual(f.notes, [{ message: "Email display set to hidden. The status bar does not show the email.", type: "info" }]);
});

// -- rename --------------------------------------------------------------------------------------------------

test("S1/S8 rename command: renames a profile and answers with the exact message", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("other");
  store.setCurrent("other");
  const c = fakeCtx();
  await profile.handler("rename work office", c.ctx);
  assert.deepEqual(c.notes, [{ message: 'Renamed profile "work" to "office".', type: "info" }]);
  assert.deepEqual(store.list(), ["office", "other"]);
});

test("S4 rename command: renaming the current profile keeps CLAUDE_CONFIG_DIR and the status bar on it", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.setCurrent("work");
  store.setStartup("work");
  process.env.CLAUDE_CONFIG_DIR = store.claudeConfigEnv("work");
  try {
    const c = fakeCtx();
    await profile.handler("rename work office", c.ctx);
    assert.equal(c.notes[0].type, "info");
    assert.match(c.notes[0].message, /^Renamed profile "work" to "office"\. Other open sessions that use it keep the old path until they switch or restart\.$/);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, join(store.profileDir("office"), "claude"));
    assert.equal(store.current(), "office");
    assert.equal(store.startup(), "office");
    assert.match(c.statuses.at(-1)?.text ?? "", /gentle-accounts: office/, "the status bar shows the new name");
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("S6 rename command: a refusal is an error notification and changes nothing", async () => {
  const { store, profile } = setup();
  store.create("work");
  store.create("other");
  for (const [args, message] of [
    ["rename ghost office", 'Profile "ghost" does not exist.'],
    ["rename work work", "The new name is the same as the current one."],
    ["rename work other", 'Profile "other" already exists.'],
    ["rename work rename", '"rename" is a reserved word (it is a subcommand). Pick another profile name.'],
  ] as const) {
    const c = fakeCtx();
    await profile.handler(args, c.ctx);
    assert.deepEqual(c.notes, [{ message, type: "error" }], args);
  }
  assert.deepEqual(store.list(), ["other", "work"]);
});

test("S1 rename command: missing or extra words print the usage as a warning", async () => {
  const { store, profile } = setup();
  store.create("work");
  for (const args of ["rename", "rename work", "rename work office extra"]) {
    const c = fakeCtx();
    await profile.handler(args, c.ctx);
    assert.equal(c.notes.length, 1, args);
    assert.equal(c.notes[0].type, "warning", args);
    assert.match(c.notes[0].message, /^\/gentle:accounts rename <old> <new> +rename a profile/m, args);
  }
  assert.deepEqual(store.list(), ["work"]);
});

test("S1 rename command: help and completions list rename", async () => {
  const { store, profile } = setup();
  store.create("work");
  const c = fakeCtx();
  await profile.handler("help", c.ctx);
  assert.match(c.notes[0].message, /^\/gentle:accounts rename <old> <new> +rename a profile \(its logins move with it\)$/m);
  assert.deepEqual((profile.getArgumentCompletions!("ren") as { value: string }[]).map((x) => x.value), ["rename"]);
});
