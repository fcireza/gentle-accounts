import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  const ctx = {
    hasUI: overrides.hasUI ?? true,
    isIdle: () => overrides.idle ?? true,
    ui: {
      notify: (message: string, type?: string) => notes.push({ message, type }),
      select: async () => overrides.select,
      confirm: async () => overrides.confirm ?? false,
    },
    modelRegistry: { refresh: async () => void refreshed++ },
  } as unknown as ExtensionCommandContext;
  return { ctx, notes, refreshed: () => refreshed };
}

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-profiles-ext-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const { pi, commands, events } = fakePi();
  gentleProfiles(pi);
  const profile = commands.get("profile")!;
  return { agentDir, store: new ProfileStore(agentDir), profile, events, liveAuthPath: join(agentDir, "auth.json") };
}

test("registers /profile and a session_start hook", () => {
  const { profile, events } = setup();
  assert.ok(profile);
  assert.ok(events.get("session_start"));
});

test("session_start wraps the live login into a default profile and sets CLAUDE_CONFIG_DIR", async () => {
  const { store, events, liveAuthPath } = setup();
  writeFileSync(liveAuthPath, JSON.stringify({ anthropic: { type: "api_key", key: "k" } }));
  await events.get("session_start")!({}, {});
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { anthropic: { type: "api_key", key: "k" } });
  assert.equal(process.env.CLAUDE_CONFIG_DIR, store.claudeDir("default"));
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
