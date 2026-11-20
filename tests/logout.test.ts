import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { logoutProvider } from "../src/logout.ts";

const tok = (n: number) => ({ type: "oauth", access: `a${n}`, refresh: `r${n}`, expires: n });

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-logout-"));
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("other");
  store.setCurrent("work");
  const liveAuthPath = join(agentDir, "auth.json");
  writeAuthFile(store.authPath("work"), { "openai-codex": tok(1), anthropic: tok(1) });
  writeAuthFile(store.authPath("other"), { "openai-codex": tok(5) });
  writeAuthFile(liveAuthPath, { "openai-codex": tok(2), anthropic: tok(2), google: { type: "api_key", key: "k" } });
  return { store, liveAuthPath };
}

test("logging out of the active profile removes the provider from the snapshot and the live file only", () => {
  const { store, liveAuthPath } = setup();
  const result = logoutProvider({ store, liveAuthPath, profile: "work", provider: "openai-codex" });
  assert.deepEqual(result, { ok: true, message: 'Logged "openai-codex" out of profile "work". The token is only forgotten on this machine.' });
  assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: tok(1) });
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: tok(2), google: { type: "api_key", key: "k" } });
  assert.deepEqual(readAuthFile(store.authPath("other")), { "openai-codex": tok(5) }, "other profiles are untouched");
});

test("logging out of another profile only edits its snapshot, never the live file", () => {
  const { store, liveAuthPath } = setup();
  const before = readAuthFile(liveAuthPath);
  assert.equal(logoutProvider({ store, liveAuthPath, profile: "other", provider: "openai-codex" }).ok, true);
  assert.deepEqual(readAuthFile(store.authPath("other")), {});
  assert.deepEqual(readAuthFile(liveAuthPath), before);
});

test("refusals change nothing: unknown profile, no login, corrupt file", () => {
  const { store, liveAuthPath } = setup();
  assert.deepEqual(logoutProvider({ store, liveAuthPath, profile: "nope", provider: "anthropic" }), { ok: false, message: 'Profile "nope" does not exist.' });
  assert.deepEqual(logoutProvider({ store, liveAuthPath, profile: "other", provider: "anthropic" }), { ok: false, message: 'Profile "other" has no login for "anthropic".' });
  writeFileSync(liveAuthPath, "{ nope");
  assert.equal(logoutProvider({ store, liveAuthPath, profile: "work", provider: "anthropic" }).ok, false);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": tok(1), anthropic: tok(1) });
});
