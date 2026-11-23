import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, switchProfile, writeAuthFile } from "../src/auth-sync.ts";
import { isAuthLinked, pointAuthAt } from "../src/auth-link.ts";

// S3: Windows keeps the copy model, so the symlink behaviour is only exercised on POSIX.
const posix = { skip: process.platform === "win32" };

const codexWork = { type: "oauth", access: "a-work", refresh: "r-work", expires: 1, accountId: "acc-w" };
const codexPersonal = { type: "oauth", access: "a-pers", refresh: "r-pers", expires: 2, accountId: "acc-p" };
const googleKey = { type: "api_key", key: "g-key" };
const staleGoogleKey = { type: "api_key", key: "g-old" };

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-link-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  store.create("work");
  store.create("personal");
  return { agentDir, store, liveAuthPath };
}

test("S1: pointAuthAt makes auth.json a symlink to the profile file and repoints it without touching either file", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  const before = [readFileSync(store.authPath("work"), "utf8"), readFileSync(store.authPath("personal"), "utf8")];

  pointAuthAt(liveAuthPath, store.authPath("work"));
  assert.equal(isAuthLinked(liveAuthPath), true);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  pointAuthAt(liveAuthPath, store.authPath("personal"));

  assert.equal(readlinkSync(liveAuthPath), store.authPath("personal"));
  assert.deepEqual([readFileSync(store.authPath("work"), "utf8"), readFileSync(store.authPath("personal"), "utf8")], before);
});

test("S1: isAuthLinked is false for a regular file and for a missing path", posix, () => {
  const { agentDir, liveAuthPath } = setup();
  assert.equal(isAuthLinked(liveAuthPath), false);
  writeFileSync(liveAuthPath, "{}\n");
  assert.equal(isAuthLinked(liveAuthPath), false);
  assert.equal(isAuthLinked(join(agentDir, "nope.json")), false);
});

test("S5: writeAuthFile on a linked auth.json writes through: the link stays and the profile file changes", posix, () => {
  const { store, liveAuthPath } = setup();
  pointAuthAt(liveAuthPath, store.authPath("work"));

  writeAuthFile(liveAuthPath, { "openai-codex": codexWork });

  assert.equal(lstatSync(liveAuthPath).isSymbolicLink(), true);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
});

test("S1: a switch on a linked auth.json repoints the link and never copies OAuth credentials", posix, () => {
  const { store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  // pi rotates the token through the link: it lands in the work file, nowhere else.
  const rotated = { ...codexWork, access: "a-work-2", expires: 9 };
  writeAuthFile(liveAuthPath, { "openai-codex": rotated });

  const result = switchProfile({ store, liveAuthPath, env: {}, to: "personal" });

  assert.deepEqual(result, { status: "switched", from: "work", to: "personal" });
  assert.equal(readlinkSync(liveAuthPath), store.authPath("personal"));
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": rotated });
  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": codexPersonal });
  assert.equal(store.current(), "personal");
});

test("S2: a switch carries the non-OAuth entries to the incoming file and replaces its stale ones", posix, () => {
  const { store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, google: googleKey });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal, google: staleGoogleKey });
  pointAuthAt(liveAuthPath, store.authPath("work"));

  switchProfile({ store, liveAuthPath, env: {}, to: "personal" });

  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": codexPersonal, google: googleKey });
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork, google: googleKey });
});

test("S1: a switch whose target file is corrupt changes nothing: link, files and current stay", posix, () => {
  const { store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork });
  writeFileSync(store.authPath("personal"), "{not json");
  pointAuthAt(liveAuthPath, store.authPath("work"));

  assert.throws(() => switchProfile({ store, liveAuthPath, env: {}, to: "personal" }), /personal/);

  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
  assert.equal(store.current(), "work");
});

test("S3: a regular auth.json keeps the copy model, even next to a leftover link elsewhere", posix, () => {
  const { agentDir, store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { "openai-codex": codexWork });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  symlinkSync(store.authPath("personal"), join(agentDir, "unrelated-link.json"));

  switchProfile({ store, liveAuthPath, env: {}, to: "personal" });

  assert.equal(isAuthLinked(liveAuthPath), false);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": codexPersonal });
});
