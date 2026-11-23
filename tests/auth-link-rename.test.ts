import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { renameProfile } from "../src/rename.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";

// S3: Windows keeps the copy model, where no link exists.
const posix = { skip: process.platform === "win32" };

const token = { type: "oauth", access: "x", refresh: "y", expires: 1 };

function setup() {
  const agent = join(realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-rename-link-"))), "agent");
  mkdirSync(agent);
  const store = new ProfileStore(agent);
  store.create("a");
  store.create("b");
  store.setCurrent("a");
  writeAuthFile(store.authPath("a"), { anthropic: token });
  const live = join(agent, "auth.json");
  symlinkSync(store.authPath("a"), live);
  return { store, live };
}

test("S1/S5: renaming the current profile repoints the credentials link to the renamed folder", posix, () => {
  const { store, live } = setup();

  const result = renameProfile(store, "a", "z");

  assert.equal(result.ok, true);
  assert.equal(existsSync(live), true, "the link must still resolve");
  assert.equal(readlinkSync(live), store.authPath("z"));
  assert.deepEqual(readAuthFile(live), { anthropic: token });
  assert.equal(store.current(), "z");
});

test("S1/S5: renaming a profile the link does not point at leaves the link alone", posix, () => {
  const { store, live } = setup();

  assert.equal(renameProfile(store, "b", "c").ok, true);

  assert.equal(readlinkSync(live), store.authPath("a"));
  assert.equal(existsSync(live), true);
  assert.equal(store.current(), "a");
});

test("S3: renaming the current profile with a regular credentials file never creates a link", () => {
  const { store, live } = setup();
  // Back to the copy model: a regular file instead of the link.
  unlinkSync(live);
  writeAuthFile(live, { anthropic: token, google: { type: "api_key", key: "g" } });

  assert.equal(renameProfile(store, "a", "z").ok, true);

  assert.equal(lstatSync(live).isSymbolicLink(), false);
  assert.deepEqual(readAuthFile(live), { anthropic: token, google: { type: "api_key", key: "g" } });
  assert.deepEqual(readAuthFile(store.authPath("z")), { anthropic: token });
});
