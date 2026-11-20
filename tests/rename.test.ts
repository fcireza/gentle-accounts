import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, INVALID_NAME_MESSAGE, MISSING_PROFILE_MESSAGE, RESERVED_NAME_MESSAGE } from "../src/store.ts";
import { writeAuthFile } from "../src/auth-sync.ts";
import { buildSessionHome } from "../src/session-home.ts";
import { renameProfile, IN_USE_MESSAGE, RENAMED_MESSAGE, RENAMED_CURRENT_NOTE } from "../src/rename.ts";

function setup() {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-rename-")));
  const store = new ProfileStore(agentDir);
  for (const name of ["work", "other"]) {
    store.create(name);
    writeAuthFile(store.authPath(name), { anthropic: { type: "api_key", key: `key-${name}` } });
  }
  return { agentDir, store, baseDir: join(agentDir, "homes") };
}

/** Every path under `dir` with its content, to prove a refusal leaves the disk untouched. */
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, { [path.slice(base.length)]: "<dir>" }, snapshot(path, base));
    else out[path.slice(base.length)] = readFileSync(path, "utf8");
  }
  return out;
}

const ALIVE = () => true;
const DEAD = () => false;

test("S8 rename flow: a profile that is not the current one is renamed with the plain message", () => {
  const { store, baseDir } = setup();
  store.setCurrent("other");
  const result = renameProfile(store, "work", "office", { baseDir, isAlive: DEAD });
  assert.deepEqual(result, { ok: true, message: 'Renamed profile "work" to "office".' });
  assert.equal(RENAMED_MESSAGE("work", "office"), 'Renamed profile "work" to "office".');
  assert.deepEqual(store.list(), ["office", "other"]);
  assert.equal(store.current(), "other");
});

test("S4/S8 rename flow: the current profile moves its pointers, re-applies CLAUDE_CONFIG_DIR and warns about other sessions", () => {
  const { store, baseDir } = setup();
  store.setCurrent("work");
  store.setStartup("work");
  const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: store.claudeConfigEnv("work") };
  const result = renameProfile(store, "work", "office", { baseDir, isAlive: DEAD, env });
  assert.equal(result.ok, true);
  assert.equal(result.message, `${RENAMED_MESSAGE("work", "office")}${RENAMED_CURRENT_NOTE}`);
  assert.equal(RENAMED_CURRENT_NOTE, " Other open sessions that use it keep the old path until they switch or restart.");
  assert.equal(store.current(), "office");
  assert.equal(store.startup(), "office");
  assert.equal(env.CLAUDE_CONFIG_DIR, join(store.profileDir("office"), "claude"), "this process follows the folder");
  assert.equal(existsSync(env.CLAUDE_CONFIG_DIR!), true, "and it exists");
});

test("S4 rename flow: a CLAUDE_CONFIG_DIR the user set, or one of another profile, is left alone", () => {
  const { store, baseDir } = setup();
  store.setCurrent("work");
  const forced: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: "/user/chose/this" };
  renameProfile(store, "work", "office", { baseDir, isAlive: DEAD, env: forced });
  assert.equal(forced.CLAUDE_CONFIG_DIR, "/user/chose/this");
  const other: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: store.claudeConfigEnv("other") };
  renameProfile(store, "office", "office2", { baseDir, isAlive: DEAD, env: other });
  assert.equal(other.CLAUDE_CONFIG_DIR, join(store.profileDir("other"), "claude"));
  const unset: NodeJS.ProcessEnv = {};
  renameProfile(store, "office2", "office3", { baseDir, isAlive: DEAD, env: unset });
  assert.equal("CLAUDE_CONFIG_DIR" in unset, false, "nothing is set that was not set");
});

test("S6 rename flow: every store refusal comes back as the same message and changes nothing", () => {
  const { store, agentDir, baseDir } = setup();
  const before = snapshot(agentDir);
  const refuse = (from: string, to: string, message: string) => {
    assert.deepEqual(renameProfile(store, from, to, { baseDir, isAlive: DEAD }), { ok: false, message }, `${from} -> ${to}`);
    assert.deepEqual(snapshot(agentDir), before, `${from} -> ${to} changed the disk`);
  };
  refuse("ghost", "office", MISSING_PROFILE_MESSAGE("ghost"));
  refuse("work", "work", "The new name is the same as the current one.");
  refuse("work", "Office", INVALID_NAME_MESSAGE("Office"));
  refuse("work", "rename", RESERVED_NAME_MESSAGE("rename"));
  refuse("work", "other", 'Profile "other" already exists.');
});

test("S5 rename flow: a profile held by a live launcher session is refused and nothing moves", () => {
  const { agentDir, store, baseDir } = setup();
  buildSessionHome({ sharedAgentDir: agentDir, profile: "work", baseDir });
  const before = snapshot(store.profileDir("work"));
  const result = renameProfile(store, "work", "office", { baseDir, isAlive: ALIVE });
  assert.deepEqual(result, { ok: false, message: IN_USE_MESSAGE("work") });
  assert.equal(IN_USE_MESSAGE("work"), 'Cannot rename profile "work": a session started with gentle-accounts is using it. Close it first.');
  assert.deepEqual(snapshot(store.profileDir("work")), before);
  assert.equal(store.exists("office"), false);
});

test("S5 rename flow: only a live session on the same profile and agent dir blocks", () => {
  const { agentDir, store, baseDir } = setup();
  buildSessionHome({ sharedAgentDir: agentDir, profile: "other", baseDir }); // another profile
  assert.equal(renameProfile(store, "work", "office", { baseDir, isAlive: ALIVE }).ok, true, "a session on another profile does not block");

  const { agentDir: elsewhere, store: foreign } = setup();
  buildSessionHome({ sharedAgentDir: elsewhere, profile: "work", baseDir }); // another agent dir, same tmp base
  assert.equal(renameProfile(store, "office", "office2", { baseDir, isAlive: ALIVE }).ok, true, "a session of another agent dir does not block");
  assert.equal(foreign.exists("work"), true, "and its profiles are untouched");
});

test("S5 rename flow: the session's own current file decides, not only the marker", () => {
  const { agentDir, store, baseDir } = setup();
  const { home } = buildSessionHome({ sharedAgentDir: agentDir, profile: "work", baseDir });
  writeFileSync(join(home, ".gentle-accounts-current"), "other\n"); // the session switched to another profile
  assert.equal(renameProfile(store, "work", "office", { baseDir, isAlive: ALIVE }).ok, true, "the session is on `other` now");
  const blocked = renameProfile(store, "other", "other2", { baseDir, isAlive: ALIVE });
  assert.deepEqual(blocked, { ok: false, message: IN_USE_MESSAGE("other") });
});

test("S5 rename flow: a home whose launcher is gone is swept first, so its credentials are saved and it does not block", () => {
  const { agentDir, store, baseDir } = setup();
  const { home } = buildSessionHome({ sharedAgentDir: agentDir, profile: "work", baseDir });
  const result = renameProfile(store, "work", "office", { baseDir, isAlive: DEAD });
  assert.equal(result.ok, true);
  assert.equal(existsSync(home), false, "the dead session home was finished and removed");
  assert.equal(store.exists("office"), true);
});

test("S5 rename flow: a base dir that cannot be trusted means there are no launcher sessions to protect", () => {
  const { store } = setup();
  const result = renameProfile(store, "work", "office", { baseDir: join(tmpdir(), "gentle-accounts-no-such-base"), isAlive: ALIVE });
  assert.equal(result.ok, true);
});

test("S3 rename flow: a failure while moving is reported with its message and the profile is still there", () => {
  const { store, baseDir } = setup();
  const failing = { ...store, assertCanRename: store.assertCanRename.bind(store), rename: () => { throw new Error("disk is full"); } } as unknown as ProfileStore;
  Object.setPrototypeOf(failing, ProfileStore.prototype);
  const result = renameProfile(failing, "work", "office", { baseDir, isAlive: DEAD });
  assert.deepEqual(result, { ok: false, message: "disk is full" });
  assert.equal(store.exists("work"), true);
});
