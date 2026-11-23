import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { writeAuthFile } from "../src/auth-sync.ts";
import { detectLogins } from "../src/detect.ts";

const codex = (accountId: string) => ({ type: "oauth", access: "a", refresh: "r", expires: 1, accountId });

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-detect-"));
  const homeDir = mkdtempSync(join(tmpdir(), "gentle-accounts-detect-home-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  return { agentDir, homeDir, store, liveAuthPath };
}

function claudeLogin(homeDir: string, email: string) {
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  writeFileSync(join(homeDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email } }));
}

test("detects nothing when every login belongs to a profile", () => {
  const { store, homeDir, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codex("A") });
  writeAuthFile(liveAuthPath, { "openai-codex": codex("A") });
  assert.deepEqual(detectLogins({ store, liveAuthPath, homeDir }), []);
});

test("detects a live codex account that differs from the current profile's snapshot", () => {
  const { store, homeDir, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codex("A") });
  writeAuthFile(liveAuthPath, { "openai-codex": codex("B") });
  const found = detectLogins({ store, liveAuthPath, homeDir });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "live");
  assert.deepEqual(found[0].providers, ["openai-codex"]);
});

test("a live account already saved in another profile is not detected", () => {
  const { store, homeDir, liveAuthPath } = setup();
  store.create("work");
  store.create("other");
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codex("A") });
  writeAuthFile(store.authPath("other"), { "openai-codex": codex("B") });
  writeAuthFile(liveAuthPath, { "openai-codex": codex("B") });
  assert.deepEqual(detectLogins({ store, liveAuthPath, homeDir }), []);
});

test("entries without an account id are never detected, and a refreshed token is not a new login", () => {
  const { store, homeDir, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { anthropic: { type: "oauth", access: "1", refresh: "1", expires: 1 }, "openai-codex": codex("A") });
  writeAuthFile(liveAuthPath, { anthropic: { type: "oauth", access: "2", refresh: "2", expires: 2 }, "openai-codex": { ...codex("A"), access: "new", expires: 9 } });
  assert.deepEqual(detectLogins({ store, liveAuthPath, homeDir }), []);
});

test("detects an unowned ~/.claude login, with its email, and not when a profile uses it", () => {
  const { store, homeDir, liveAuthPath } = setup();
  claudeLogin(homeDir, "me@x.io");
  store.create("work");
  store.setCurrent("work");
  const found = detectLogins({ store, liveAuthPath, homeDir });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "claude");
  assert.equal(found[0].email, "me@x.io");
  store.create("home", { claudeDefault: true });
  assert.deepEqual(detectLogins({ store, liveAuthPath, homeDir }), []);
});

test("an unreadable live auth file detects nothing and never throws", () => {
  const { store, homeDir, liveAuthPath } = setup();
  store.create("work");
  store.setCurrent("work");
  writeFileSync(liveAuthPath, "{ not json");
  assert.deepEqual(detectLogins({ store, liveAuthPath, homeDir }), []);
});
