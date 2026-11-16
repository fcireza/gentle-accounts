import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import {
  COVERED_PROVIDERS,
  readAuthFile,
  writeAuthFile,
  switchProfile,
  applyCurrentProfileEnv,
  ensureDefaultProfile,
} from "../src/auth-sync.ts";

const codexWork = { type: "oauth", access: "a-work", refresh: "r-work", expires: 1, accountId: "acc-w" };
const codexPersonal = { type: "oauth", access: "a-pers", refresh: "r-pers", expires: 2, accountId: "acc-p" };
const anthropicWork = { type: "api_key", key: "sk-work" };
const other = { type: "api_key", key: "untouched" };

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-profiles-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  return { agentDir, store, liveAuthPath };
}

test("covered providers are exactly openai-codex and anthropic", () => {
  assert.deepEqual([...COVERED_PROVIDERS], ["openai-codex", "anthropic"]);
});

test("readAuthFile returns {} for a missing file and throws on invalid JSON", () => {
  const { agentDir } = setup();
  assert.deepEqual(readAuthFile(join(agentDir, "nope.json")), {});
  const bad = join(agentDir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.throws(() => readAuthFile(bad), /bad\.json/);
});

test("writeAuthFile writes JSON atomically with mode 0600 and leaves no temp file", () => {
  const { agentDir } = setup();
  const p = join(agentDir, "auth.json");
  writeAuthFile(p, { anthropic: anthropicWork });
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { anthropic: anthropicWork });
  if (platform() !== "win32") assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(existsSync(`${p}.tmp`), false);
});

test("switchProfile snapshots the outgoing live credentials and loads the incoming ones", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { "openai-codex": codexWork, anthropic: anthropicWork, other });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  const env: Record<string, string | undefined> = {};

  const result = switchProfile({ store, liveAuthPath, env, to: "personal" });

  assert.deepEqual(result, { status: "switched", from: "work", to: "personal" });
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork, anthropic: anthropicWork });
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": codexPersonal, other });
  assert.equal(env.CLAUDE_CONFIG_DIR, store.claudeDir("personal"));
  assert.equal(store.current(), "personal");
});

test("switchProfile to the active profile is a no-op that changes nothing", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/keep" };
  const before = readFileSync(liveAuthPath, "utf8");

  assert.deepEqual(switchProfile({ store, liveAuthPath, env, to: "work" }), { status: "noop", from: "work", to: "work" });
  assert.equal(readFileSync(liveAuthPath, "utf8"), before);
  assert.deepEqual(readAuthFile(store.authPath("work")), {});
  assert.equal(env.CLAUDE_CONFIG_DIR, "/keep");
});

test("switchProfile rejects a missing profile and leaves live credentials and current untouched", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.throws(() => switchProfile({ store, liveAuthPath, env, to: "ghost" }), { message: 'Profile "ghost" does not exist.' });
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: anthropicWork });
  assert.equal(store.current(), "work");
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

test("switchProfile with no active profile skips the snapshot and still loads the target", () => {
  const { store, liveAuthPath } = setup();
  store.create("personal");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork, other });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  const env: Record<string, string | undefined> = {};
  assert.deepEqual(switchProfile({ store, liveAuthPath, env, to: "personal" }), { status: "switched", from: null, to: "personal" });
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": codexPersonal, other });
});

test("applyCurrentProfileEnv sets CLAUDE_CONFIG_DIR from the current profile unless already set", () => {
  const { store } = setup();
  store.create("work");
  store.setCurrent("work");
  const env: Record<string, string | undefined> = {};
  assert.equal(applyCurrentProfileEnv(store, env), "work");
  assert.equal(env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  const preset: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/preset" };
  assert.equal(applyCurrentProfileEnv(store, preset), "work");
  assert.equal(preset.CLAUDE_CONFIG_DIR, "/preset");
  const empty = new ProfileStore(mkdtempSync(join(tmpdir(), "gp-")));
  const none: Record<string, string | undefined> = {};
  assert.equal(applyCurrentProfileEnv(empty, none), null);
  assert.equal(none.CLAUDE_CONFIG_DIR, undefined);
});

test("ensureDefaultProfile creates 'default' from live credentials and the current Claude dir path", () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(liveAuthPath, { "openai-codex": codexWork, other });
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/home/me/.claude-custom" };
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), "default");
  assert.deepEqual(store.list(), ["default"]);
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { "openai-codex": codexWork });
  assert.equal(store.claudeDir("default"), "/home/me/.claude-custom");
  assert.equal(readFileSync(store.claudeDirPath("default"), "utf8").trim(), "/home/me/.claude-custom");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/home/me/.claude-custom");
});

test("ensureDefaultProfile does nothing when a profile is already active", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), null);
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

test("ensureDefaultProfile still creates default when other profiles exist but none is active", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), "default");
  assert.deepEqual(store.list(), ["default", "work"]);
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { anthropic: anthropicWork });
});

test("ensureDefaultProfile reuses an existing default without overwriting its snapshot", () => {
  const { store, liveAuthPath } = setup();
  store.create("default");
  writeAuthFile(store.authPath("default"), { "openai-codex": codexWork });
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), "default");
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { "openai-codex": codexWork });
  assert.equal(env.CLAUDE_CONFIG_DIR, store.claudeDir("default"));
});
