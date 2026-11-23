import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { pointAuthAt, isAuthLinked } from "../src/auth-link.ts";
import { migrateToLinkedAuth } from "../src/auth-migrate.ts";

const posix = { skip: process.platform === "win32" };

const codexOld = { type: "oauth", access: "a-1", refresh: "r-1", expires: 1, accountId: "acc-w" };
const codexNew = { type: "oauth", access: "a-2", refresh: "r-2", expires: 5, accountId: "acc-w" };
const googleKey = { type: "api_key", key: "g-key" };

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-migrate-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  store.create("work");
  store.setCurrent("work");
  return { agentDir, store, liveAuthPath };
}

test("S4: a regular live file becomes the current profile's file: fresher OAuth wins, live API keys are kept, then the link is made", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexNew });
  writeAuthFile(liveAuthPath, { "openai-codex": codexOld, google: googleKey });

  const result = migrateToLinkedAuth({ store, liveAuthPath });

  assert.deepEqual(result, { status: "migrated" });
  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexNew, google: googleKey });
});

test("S4: an already linked live file is left alone", posix, () => {
  const { store, liveAuthPath } = setup();
  pointAuthAt(liveAuthPath, store.authPath("work"));
  const before = readFileSync(store.authPath("work"), "utf8");

  assert.deepEqual(migrateToLinkedAuth({ store, liveAuthPath }), { status: "already-linked" });

  assert.equal(readFileSync(store.authPath("work"), "utf8"), before);
});

test("S3: Windows keeps the copy model: nothing is touched", () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(liveAuthPath, { "openai-codex": codexOld });
  const before = readFileSync(liveAuthPath, "utf8");

  assert.deepEqual(migrateToLinkedAuth({ store, liveAuthPath, platform: "win32" }), { status: "unsupported" });

  assert.equal(isAuthLinked(liveAuthPath), false);
  assert.equal(readFileSync(liveAuthPath, "utf8"), before);
});

test("S4: with no current profile there is nothing to link to", posix, () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-migrate-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  writeAuthFile(liveAuthPath, { "openai-codex": codexOld });

  assert.deepEqual(migrateToLinkedAuth({ store, liveAuthPath }), { status: "no-profile" });

  assert.equal(isAuthLinked(liveAuthPath), false);
});

test("S4: a corrupt live file throws before anything is written", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexNew });
  writeFileSync(liveAuthPath, "{not json");
  const profileBefore = readFileSync(store.authPath("work"), "utf8");

  assert.throws(() => migrateToLinkedAuth({ store, liveAuthPath }), /auth\.json/);

  assert.equal(readFileSync(liveAuthPath, "utf8"), "{not json");
  assert.equal(readFileSync(store.authPath("work"), "utf8"), profileBefore);
});

test("S3: when the symlink cannot be made the live file stays a regular file and keeps its data", posix, () => {
  if (process.getuid?.() === 0) return; // root ignores directory permissions
  const { agentDir, store, liveAuthPath } = setup();
  writeAuthFile(liveAuthPath, { "openai-codex": codexOld, google: googleKey });
  chmodSync(agentDir, 0o500);
  let result;
  try {
    result = migrateToLinkedAuth({ store, liveAuthPath });
  } finally {
    chmodSync(agentDir, 0o700);
  }

  assert.deepEqual(result, { status: "fallback" });
  assert.equal(lstatSync(liveAuthPath).isSymbolicLink(), false);
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": codexOld, google: googleKey });
});
