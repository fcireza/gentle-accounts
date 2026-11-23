import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readdirSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { pointAuthAt } from "../src/auth-link.ts";
import { logoutProvider } from "../src/logout.ts";
import { adoptLogin } from "../src/adopt.ts";
import { saveCredential } from "../src/menu/run.ts";

// S3: Windows keeps the copy model, so the linked behaviour is only exercised on POSIX.
const posix = { skip: process.platform === "win32" };

const tok = (n: number) => ({ type: "oauth", access: `a${n}`, refresh: `r${n}`, expires: n });
const googleKey = { type: "api_key", key: "g-key" };

/** Profiles `work` (current, linked) and `other`, in a temp agent dir. */
function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-writers-"));
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("other");
  store.setCurrent("work");
  const liveAuthPath = join(agentDir, "auth.json");
  writeAuthFile(store.authPath("work"), { "openai-codex": tok(1), anthropic: tok(1), google: googleKey });
  writeAuthFile(store.authPath("other"), { "openai-codex": tok(5) });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  return { agentDir, store, liveAuthPath };
}

test("S5: logging out of the active profile on a linked file removes the provider once and keeps the link", posix, () => {
  const { store, liveAuthPath } = setup();

  const result = logoutProvider({ store, liveAuthPath, profile: "work", provider: "openai-codex" });

  assert.deepEqual(result, { ok: true, message: 'Logged "openai-codex" out of profile "work". The token is only forgotten on this machine.' });
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: tok(1), google: googleKey });
  assert.deepEqual(readAuthFile(store.authPath("other")), { "openai-codex": tok(5) });
});

test("S5: logging out of another profile on a linked file edits only that profile's file", posix, () => {
  const { store, liveAuthPath } = setup();
  const workBefore = readAuthFile(store.authPath("work"));

  assert.equal(logoutProvider({ store, liveAuthPath, profile: "other", provider: "openai-codex" }).ok, true);

  assert.deepEqual(readAuthFile(store.authPath("other")), {});
  assert.deepEqual(readAuthFile(store.authPath("work")), workBefore);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
});

test("S5: a live login cannot be adopted while the file is linked: nothing is created or changed", posix, () => {
  const { store, liveAuthPath } = setup();
  const profilesBefore = readdirSync(join(store.authPath("work"), "..", "..")).sort();
  const workBefore = readAuthFile(store.authPath("work"));

  const result = adoptLogin({ store, liveAuthPath, env: {}, login: { kind: "live", providers: ["openai-codex"] }, name: "second" });

  assert.equal(result.ok, false);
  assert.match(result.message, /linked/);
  assert.deepEqual(readdirSync(join(store.authPath("work"), "..", "..")).sort(), profilesBefore);
  assert.deepEqual(readAuthFile(store.authPath("work")), workBefore);
  assert.equal(store.current(), "work");
});

test("S5: a Claude login can still be adopted while the file is linked", posix, () => {
  const { store, liveAuthPath } = setup();

  const result = adoptLogin({ store, liveAuthPath, env: {}, login: { kind: "claude", providers: [] }, name: "claude-one" });

  assert.equal(result.ok, true);
  assert.equal(store.exists("claude-one"), true);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
});

test("S5: saveCredential on a linked file writes the current profile's file once and keeps the link", posix, () => {
  const { store, liveAuthPath } = setup();
  const credential = tok(9);

  saveCredential(liveAuthPath, store.authPath("work"), "anthropic", credential);

  assert.equal(lstatSync(liveAuthPath).isSymbolicLink(), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": tok(1), anthropic: credential, google: googleKey });
  assert.deepEqual(readAuthFile(store.authPath("other")), { "openai-codex": tok(5) });
});

test("S5: saveCredential for a profile the link does not point at never writes through the link", posix, () => {
  const { store, liveAuthPath } = setup();
  const workBefore = readAuthFile(store.authPath("work"));

  saveCredential(liveAuthPath, store.authPath("other"), "anthropic", tok(9));

  assert.deepEqual(readAuthFile(store.authPath("other")), { "openai-codex": tok(5), anthropic: tok(9) });
  assert.deepEqual(readAuthFile(store.authPath("work")), workBefore);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
});
