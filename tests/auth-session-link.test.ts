import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { buildSessionHome, finishSessionHome, removeSessionHome } from "../src/session-home.ts";

const posix = process.platform !== "win32";
const W = { anthropic: { type: "oauth", access: "w-access", refresh: "w-refresh", expires: 1 } };
const P = { "openai-codex": { type: "oauth", access: "p-access", refresh: "p-refresh", expires: 2 } };
const GOOGLE = { google: { type: "api_key", key: "g-key" } };

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-sl-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, "agent");
  mkdirSync(shared);
  const store = new ProfileStore(shared);
  store.create("work");
  store.create("personal");
  writeAuthFile(store.authPath("work"), W);
  writeAuthFile(store.authPath("personal"), P);
  return { root, shared, base: join(root, "homes"), store };
}

const authOf = (dir: string) => join(dir, "auth.json");

test("S6: POSIX home credentials file is a link to the session profile file with the global entries carried", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  writeFileSync(authOf(shared), JSON.stringify({ ...GOOGLE, ...W }));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.equal(lstatSync(authOf(home)).isSymbolicLink(), true);
  assert.equal(readlinkSync(authOf(home)), store.authPath("personal"));
  assert.deepEqual(readAuthFile(store.authPath("personal")), { ...P, ...GOOGLE });
  assert.deepEqual(readAuthFile(authOf(home)), { ...P, ...GOOGLE });
  assert.deepEqual(readAuthFile(store.authPath("work")), W); // other profile untouched
  assert.deepEqual(readAuthFile(authOf(shared)), { ...GOOGLE, ...W }); // shared live file untouched
});

test("S6: shared global entries win on a conflict, profile-only keys are kept, covered come from the profile", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  writeAuthFile(store.authPath("personal"), { ...P, google: { type: "api_key", key: "old" }, extra: { type: "api_key", key: "only-profile" } });
  writeFileSync(authOf(shared), JSON.stringify({ google: { type: "api_key", key: "new" }, anthropic: W.anthropic }));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.deepEqual(readAuthFile(authOf(home)), { ...P, google: { type: "api_key", key: "new" }, extra: { type: "api_key", key: "only-profile" } });
});

test("S6: the profile file is not rewritten when the union equals it", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  writeAuthFile(store.authPath("personal"), { ...P, ...GOOGLE });
  writeFileSync(authOf(shared), JSON.stringify(GOOGLE));
  const before = lstatSync(store.authPath("personal")).ino;
  buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.equal(lstatSync(store.authPath("personal")).ino, before);
});

test("S6: a corrupt shared or profile file builds nothing and writes nothing", { skip: !posix }, () => {
  const a = sandbox();
  writeFileSync(authOf(a.shared), "{nope");
  assert.throws(() => buildSessionHome({ sharedAgentDir: a.shared, profile: "personal", baseDir: a.base }), /Cannot parse/);
  assert.equal(existsSync(a.base) ? nodeFs.readdirSync(a.base).length : 0, 0);
  assert.deepEqual(readAuthFile(a.store.authPath("personal")), P);
  const b = sandbox();
  writeFileSync(authOf(b.shared), JSON.stringify(GOOGLE));
  writeFileSync(b.store.authPath("personal"), "[1]");
  assert.throws(() => buildSessionHome({ sharedAgentDir: b.shared, profile: "personal", baseDir: b.base }), /Cannot parse/);
  assert.equal(existsSync(b.base) ? nodeFs.readdirSync(b.base).length : 0, 0);
  assert.equal(readFileSync(b.store.authPath("personal"), "utf8"), "[1]");
});

test("S6: a token rotated through the home lands in the profile file; finish needs no copy back and keeps it", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  writeAuthFile(authOf(home), { "openai-codex": { ...P["openai-codex"], access: "rotated" } });
  assert.equal(lstatSync(authOf(home)).isSymbolicLink(), true); // written through, link intact
  assert.equal((readAuthFile(store.authPath("personal"))["openai-codex"] as { access?: string }).access, "rotated");
  const errors: string[] = [];
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: (l) => errors.push(l) }), true);
  assert.deepEqual(errors, []);
  assert.equal(existsSync(home), false);
  assert.equal(lstatSync(store.authPath("personal")).isFile(), true);
  assert.equal((readAuthFile(store.authPath("personal"))["openai-codex"] as { access?: string }).access, "rotated");
  assert.deepEqual(readAuthFile(store.authPath("work")), W);
});

test("S6: removeSessionHome unlinks the link and the profile file survives", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  removeSessionHome(home);
  assert.equal(existsSync(home), false);
  assert.deepEqual(readAuthFile(store.authPath("personal")), P);
});

test("S6: finish keeps the old copy-back for a copy-mode home", () => {
  const { shared, base, store } = sandbox();
  const home = join(base, "old");
  mkdirSync(base, { mode: 0o700 });
  mkdirSync(home);
  writeFileSync(join(home, ".gentle-accounts-current"), "personal\n");
  writeAuthFile(authOf(home), { "openai-codex": { ...P["openai-codex"], access: "copy-rotated", expires: 99 } });
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.equal((readAuthFile(store.authPath("personal"))["openai-codex"] as { access?: string }).access, "copy-rotated");
  assert.equal(existsSync(home), false);
});

test("S3: when creating the link throws, the home gets a private copy", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  writeFileSync(authOf(shared), JSON.stringify(GOOGLE));
  const failing = { ...nodeFs, symlinkSync: (target: string, path: string, ...rest: unknown[]) => {
    if (String(path).includes("auth.json")) throw new Error("EPERM");
    return (nodeFs.symlinkSync as (...a: unknown[]) => void)(target, path, ...rest);
  } } as typeof nodeFs;
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base, fs: failing });
  assert.equal(lstatSync(authOf(home)).isSymbolicLink(), false);
  assert.deepEqual(readAuthFile(authOf(home)), { ...GOOGLE, ...P });
  assert.deepEqual(readAuthFile(store.authPath("personal")), P); // no data moved on the failed link
  assert.deepEqual(readAuthFile(store.authPath("work")), W);
});

test("S3: win32 keeps the private copy", () => {
  const { shared, base } = sandbox();
  writeFileSync(authOf(shared), JSON.stringify(GOOGLE));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base, platform: "win32" });
  assert.equal(lstatSync(authOf(home)).isSymbolicLink(), false);
  assert.deepEqual(readAuthFile(authOf(home)), { ...GOOGLE, ...P });
});

test("S6: shared file linked to another profile, session on a different profile", { skip: !posix }, () => {
  const { shared, base, store } = sandbox();
  writeAuthFile(store.authPath("work"), { ...W, ...GOOGLE });
  symlinkSync(store.authPath("work"), authOf(shared));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.equal(readlinkSync(authOf(home)), store.authPath("personal"));
  assert.deepEqual(readAuthFile(store.authPath("personal")), { ...P, ...GOOGLE });
  assert.deepEqual(readAuthFile(store.authPath("work")), { ...W, ...GOOGLE }); // work untouched
  assert.equal(readlinkSync(authOf(shared)), store.authPath("work")); // global link untouched
});
