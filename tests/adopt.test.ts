import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { adoptLogin } from "../src/adopt.ts";

const codex = (accountId: string) => ({ type: "oauth", access: "a", refresh: "r", expires: 1, accountId });
const claudeTok = (n: number) => ({ type: "oauth", access: `a${n}`, refresh: `r${n}`, expires: n });

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-adopt-"));
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.setCurrent("work");
  const liveAuthPath = join(agentDir, "auth.json");
  writeAuthFile(store.authPath("work"), { "openai-codex": codex("A"), anthropic: claudeTok(1) });
  writeAuthFile(liveAuthPath, { "openai-codex": codex("B"), anthropic: claudeTok(2), google: { type: "api_key", key: "k" } });
  return { store, liveAuthPath, env: {} as Record<string, string | undefined> };
}

test("adopting a live login creates the profile, makes it current and keeps the previous profile's account", () => {
  const { store, liveAuthPath, env } = setup();
  const result = adoptLogin({ store, liveAuthPath, env, login: { kind: "live", providers: ["openai-codex"] }, name: "second" });
  assert.deepEqual(result, { ok: true, message: 'Adopted the detected login as profile "second".' });
  assert.equal(store.current(), "second");
  assert.deepEqual(readAuthFile(store.authPath("second")), { "openai-codex": codex("B") });
  const work = readAuthFile(store.authPath("work"));
  assert.deepEqual(work["openai-codex"], codex("A"), "the previous account is not overwritten");
  assert.deepEqual(work.anthropic, claudeTok(2), "its other providers keep the fresher token");
  const live = readAuthFile(liveAuthPath);
  assert.deepEqual(live["openai-codex"], codex("B"));
  assert.equal("anthropic" in live, false, "live now holds only the new profile's covered entries");
  assert.deepEqual(live.google, { type: "api_key", key: "k" }, "api keys stay global");
});

test("adopting refuses an existing or invalid name and changes nothing", () => {
  const { store, liveAuthPath, env } = setup();
  const before = readAuthFile(liveAuthPath);
  const taken = adoptLogin({ store, liveAuthPath, env, login: { kind: "live", providers: ["openai-codex"] }, name: "work" });
  assert.deepEqual(taken, { ok: false, message: 'Profile "work" already exists.' });
  assert.equal(adoptLogin({ store, liveAuthPath, env, login: { kind: "live", providers: ["openai-codex"] }, name: "rename" }).ok, false);
  assert.equal(store.current(), "work");
  assert.deepEqual(readAuthFile(liveAuthPath), before);
  assert.deepEqual(readAuthFile(store.authPath("work"))["openai-codex"], codex("A"));
});

test("a corrupt live auth file fails before any profile is created", () => {
  const { store, liveAuthPath, env } = setup();
  writeFileSync(liveAuthPath, "{ nope");
  assert.equal(adoptLogin({ store, liveAuthPath, env, login: { kind: "live", providers: ["openai-codex"] }, name: "second" }).ok, false);
  assert.equal(store.exists("second"), false);
});

test("adopting the ~/.claude login only creates a profile on Claude Code's default dir", () => {
  const { store, liveAuthPath, env } = setup();
  const before = readAuthFile(liveAuthPath);
  assert.equal(adoptLogin({ store, liveAuthPath, env, login: { kind: "claude", providers: ["claude"], email: "me@x.io" }, name: "home" }).ok, true);
  assert.equal(store.claudeConfigEnv("home"), undefined);
  assert.equal(store.current(), "work", "no switch");
  assert.deepEqual(readAuthFile(liveAuthPath), before);
});
