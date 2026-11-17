import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
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
  applyClaudeConfigEnv,
  applyStartupProfile,
} from "../src/auth-sync.ts";

const codexWork = { type: "oauth", access: "a-work", refresh: "r-work", expires: 1, accountId: "acc-w" };
const codexPersonal = { type: "oauth", access: "a-pers", refresh: "r-pers", expires: 2, accountId: "acc-p" };
const anthropicWork = { type: "api_key", key: "sk-work" };
const other = { type: "api_key", key: "untouched" };

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-"));
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

test("switchProfile with a corrupt target leaves the outgoing snapshot, live and current untouched", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork });
  writeFileSync(store.authPath("personal"), "{broken");
  const env: Record<string, string | undefined> = {};
  assert.throws(() => switchProfile({ store, liveAuthPath, env, to: "personal" }), /personal/);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: anthropicWork });
  assert.equal(store.current(), "work");
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

test("a rotated token round-trips through the outgoing snapshot", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  const env: Record<string, string | undefined> = {};
  writeAuthFile(liveAuthPath, { "openai-codex": codexWork });
  ensureDefaultProfile({ store, liveAuthPath, env });
  const rotated = { ...codexWork, access: "a-rotated", refresh: "r-rotated" };
  writeAuthFile(liveAuthPath, { "openai-codex": rotated });
  switchProfile({ store, liveAuthPath, env, to: "work" });
  assert.deepEqual(readAuthFile(store.authPath("default")), { "openai-codex": rotated });
  switchProfile({ store, liveAuthPath, env, to: "default" });
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": rotated });
});

test("ensureDefaultProfile with a corrupt live auth.json throws and creates no profile", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  writeFileSync(liveAuthPath, "{broken");
  const env: Record<string, string | undefined> = {};
  assert.throws(() => ensureDefaultProfile({ store, liveAuthPath, env }), /auth\.json/);
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(store.current(), null);
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

test("S16: applyClaudeConfigEnv deletes the variable for undefined and assigns a value otherwise", () => {
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/x" };
  applyClaudeConfigEnv(env, undefined);
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
  applyClaudeConfigEnv(env, "/y");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/y");
});

test("S16: ensureDefaultProfile without a user CLAUDE_CONFIG_DIR writes the marker and leaves the variable unset", () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), "default");
  assert.ok(existsSync(join(store.profileDir("default"), "claude-default")));
  assert.equal(existsSync(store.claudeDirPath("default")), false);
  assert.equal(store.claudeConfigEnv("default"), undefined);
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
});

test("S16: switching work -> default deletes CLAUDE_CONFIG_DIR, default -> work sets it", () => {
  const { store, liveAuthPath } = setup();
  const env: Record<string, string | undefined> = {};
  ensureDefaultProfile({ store, liveAuthPath, env });
  store.create("work");
  switchProfile({ store, liveAuthPath, env, to: "work" });
  assert.equal(env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
  switchProfile({ store, liveAuthPath, env, to: "default" });
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
});

test("S16: applyCurrentProfileEnv leaves the environment alone for a system-default profile", () => {
  const { store } = setup();
  store.create("default", { claudeDefault: true });
  store.setCurrent("default");
  const empty: Record<string, string | undefined> = {};
  assert.equal(applyCurrentProfileEnv(store, empty), "default");
  assert.equal("CLAUDE_CONFIG_DIR" in empty, false);
  const preset: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/preset" };
  assert.equal(applyCurrentProfileEnv(store, preset), "default");
  assert.equal(preset.CLAUDE_CONFIG_DIR, "/preset");
});

test("S27: applyStartupProfile does nothing without a startup profile", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.deepEqual(applyStartupProfile({ store, liveAuthPath, env }), { status: "none", from: "work", to: null });
  assert.equal(store.current(), "work");
  assert.deepEqual(env, {});
});

test("S27: applyStartupProfile is a no-op when the startup profile is already active", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  store.setStartup("work");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const before = readFileSync(liveAuthPath, "utf8");
  const env: Record<string, string | undefined> = {};
  assert.deepEqual(applyStartupProfile({ store, liveAuthPath, env }), { status: "same", from: "work", to: "work" });
  assert.equal(readFileSync(liveAuthPath, "utf8"), before);
  assert.deepEqual(env, {});
});

test("S27: applyStartupProfile switches with the safe switch (snapshot outgoing, load incoming, env)", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  store.setStartup("work");
  writeAuthFile(liveAuthPath, { "openai-codex": codexPersonal, other });
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, anthropic: anthropicWork });
  const env: Record<string, string | undefined> = {};
  assert.deepEqual(applyStartupProfile({ store, liveAuthPath, env }), { status: "switched", from: "personal", to: "work" });
  assert.equal(store.current(), "work");
  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": codexPersonal });
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": codexWork, anthropic: anthropicWork, other });
  assert.equal(env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
});

test("S27: a corrupt startup target throws and leaves every file byte-identical", () => {
  const { store, liveAuthPath } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("personal");
  store.setStartup("work");
  writeAuthFile(liveAuthPath, { "openai-codex": codexPersonal });
  writeFileSync(store.authPath("work"), "{bad");
  const files = [liveAuthPath, store.authPath("personal"), store.authPath("work"), store.currentPath, store.startupPath];
  const before = files.map((f) => readFileSync(f, "utf8"));
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/keep" };
  assert.throws(() => applyStartupProfile({ store, liveAuthPath, env }), /Cannot parse/);
  assert.deepEqual(files.map((f) => readFileSync(f, "utf8")), before);
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: "/keep" });
});

test("S27+S16: switching to a system-default startup profile deletes CLAUDE_CONFIG_DIR", () => {
  const { store, liveAuthPath } = setup();
  store.create("default", { claudeDefault: true });
  store.create("work");
  store.setCurrent("work");
  store.setStartup("default");
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: store.claudeDir("work") };
  assert.equal(applyStartupProfile({ store, liveAuthPath, env }).status, "switched");
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
  assert.equal(store.current(), "default");
});

test("S27: applyStartupProfile reports a missing startup profile and changes nothing", () => {
  const { store, liveAuthPath } = setup();
  store.create("personal");
  store.setCurrent("personal");
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  writeFileSync(store.startupPath, "ghost\n");
  const files = [liveAuthPath, store.authPath("personal"), store.currentPath, store.startupPath];
  const before = files.map((f) => readFileSync(f, "utf8"));
  const env: Record<string, string | undefined> = {};
  assert.deepEqual(applyStartupProfile({ store, liveAuthPath, env }), { status: "missing", from: "personal", to: "ghost" });
  assert.deepEqual(files.map((f) => readFileSync(f, "utf8")), before);
  assert.deepEqual(env, {});
});

test("S30: writeAuthFile uses a unique temp name, so a stale <path>.tmp never collides", () => {
  const { agentDir } = setup();
  const p = join(agentDir, "auth.json");
  mkdirSync(`${p}.tmp`);
  writeAuthFile(p, { anthropic: anthropicWork });
  assert.deepEqual(readAuthFile(p), { anthropic: anthropicWork });
  assert.deepEqual(readdirSync(agentDir).sort(), ["auth.json", "auth.json.tmp"]);
});

test("S30: ensureDefaultProfile treats a default created by another session in between as success", () => {
  const { agentDir, store, liveAuthPath } = setup();
  writeAuthFile(liveAuthPath, { anthropic: anthropicWork });
  const theirs = '{\n  "anthropic": {\n    "type": "api_key",\n    "key": "theirs"\n  }\n}\n';
  const other = new ProfileStore(agentDir);
  let raced = false;
  store.exists = (name: string) => {
    if (name === "default" && !raced) {
      raced = true;
      other.create("default", { claudeDefault: true });
      writeFileSync(other.authPath("default"), theirs);
      return false;
    }
    return ProfileStore.prototype.exists.call(store, name);
  };
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureDefaultProfile({ store, liveAuthPath, env }), "default");
  assert.equal(raced, true);
  assert.equal(store.current(), "default");
  assert.equal(readFileSync(store.authPath("default"), "utf8"), theirs, "the winner's snapshot is kept");
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
});
