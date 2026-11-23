import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, switchProfile, writeAuthFile } from "../src/auth-sync.ts";
import { isAuthLinked, pointAuthAt, resolveAuthTarget } from "../src/auth-link.ts";

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

test("S2: a switch keeps an API key that exists only in the incoming file, and the live one wins on a conflict", posix, () => {
  const { store, liveAuthPath } = setup();
  store.setCurrent("work");
  const onlyPersonal = { type: "api_key", key: "p-only" };
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, google: googleKey });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal, google: staleGoogleKey, mistral: onlyPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));

  switchProfile({ store, liveAuthPath, env: {}, to: "personal" });

  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": codexPersonal, google: googleKey, mistral: onlyPersonal });
});

test("S2: a dangling live link never strips the incoming file's API keys", posix, () => {
  const { agentDir, store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal, google: googleKey });
  symlinkSync(join(agentDir, "gone.json"), liveAuthPath);

  switchProfile({ store, liveAuthPath, env: {}, to: "personal" });

  assert.equal(readlinkSync(liveAuthPath), store.authPath("personal"));
  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": codexPersonal, google: googleKey });
});

test("S5: writeAuthFile follows a relative two-hop chain and leaves both links in place", posix, () => {
  const { agentDir, store, liveAuthPath } = setup();
  symlinkSync("hop.json", liveAuthPath);
  symlinkSync(join("profiles", "work", "auth.json"), join(agentDir, "hop.json"));

  writeAuthFile(liveAuthPath, { "openai-codex": codexWork });

  assert.equal(lstatSync(liveAuthPath).isSymbolicLink(), true);
  assert.equal(lstatSync(join(agentDir, "hop.json")).isSymbolicLink(), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
});

test("S5: a link cycle or an over-long chain throws instead of replacing the link by a regular file", posix, () => {
  const { agentDir, liveAuthPath } = setup();
  symlinkSync("b.json", liveAuthPath);
  symlinkSync("auth.json", join(agentDir, "b.json"));

  assert.throws(() => resolveAuthTarget(liveAuthPath), /too many links/);
  assert.throws(() => writeAuthFile(liveAuthPath, { google: googleKey }), /too many links/);
  assert.equal(lstatSync(liveAuthPath).isSymbolicLink(), true);
});

test("S1: when the link cannot be moved the switch throws and the link, current and live file stay", posix, () => {
  if (process.getuid?.() === 0) return; // root ignores directory permissions
  const { agentDir, store, liveAuthPath } = setup();
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  chmodSync(agentDir, 0o500);
  try {
    assert.throws(() => switchProfile({ store, liveAuthPath, env: {}, to: "personal" }));
  } finally {
    chmodSync(agentDir, 0o700);
  }

  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.equal(store.current(), "work");
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork });
});

test("S3: switchLinked re-reads the incoming file right before writing: a token rotated in between survives with the carried api key", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, google: googleKey });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  store.setCurrent("work");
  const rotated = { ...codexPersonal, access: "a-rotated", refresh: "r-rotated", expires: 99 };

  switchProfile({ store, liveAuthPath, env: {}, to: "personal", beforeProfileWrite: () => writeAuthFile(store.authPath("personal"), { "openai-codex": rotated }) });

  assert.deepEqual(readAuthFile(store.authPath("personal")), { "openai-codex": rotated, google: googleKey });
  assert.equal(readlinkSync(liveAuthPath), store.authPath("personal"));
});

test("S3: when the incoming file turns corrupt between the two reads the switch throws and the link, current profile and env stay", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, google: googleKey });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  store.setCurrent("work");
  const env: Record<string, string | undefined> = {};

  assert.throws(
    () => switchProfile({ store, liveAuthPath, env, to: "personal", beforeProfileWrite: () => writeFileSync(store.authPath("personal"), "{broken") }),
    /personal/,
  );

  assert.equal(readlinkSync(liveAuthPath), store.authPath("work"));
  assert.equal(store.current(), "work");
  assert.deepEqual(env, {});
  assert.equal(readFileSync(store.authPath("personal"), "utf8"), "{broken");
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": codexWork, google: googleKey });
});

test("S3: when the second read shows the file already holds the carried keys the switch writes nothing and still moves the link", posix, () => {
  const { store, liveAuthPath } = setup();
  writeAuthFile(store.authPath("work"), { "openai-codex": codexWork, google: googleKey });
  writeAuthFile(store.authPath("personal"), { "openai-codex": codexPersonal });
  pointAuthAt(liveAuthPath, store.authPath("work"));
  store.setCurrent("work");
  // Another session already carried the key into the incoming file between the two reads.
  const already = { "openai-codex": { ...codexPersonal, expires: 50 }, google: googleKey };

  switchProfile({ store, liveAuthPath, env: {}, to: "personal", beforeProfileWrite: () => writeAuthFile(store.authPath("personal"), already) });

  assert.deepEqual(readAuthFile(store.authPath("personal")), already);
  assert.equal(readlinkSync(liveAuthPath), store.authPath("personal"));
  assert.equal(store.current(), "personal");
});
