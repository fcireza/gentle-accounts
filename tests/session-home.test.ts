import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import {
  SESSION_CURRENT,
  SESSION_MARKER,
  buildSessionHome,
  pickFreshest,
  recordSessionChildPid,
  finishSessionHome,
  readSessionCurrent,
  readSessionMarker,
  removeSessionHome,
  resolveContext,
  sweepSessionHomes,
  ensureBaseDir,
  sessionBaseDir,
} from "../src/session-home.ts";

const W = { anthropic: { type: "oauth", access: "w-access", refresh: "w-refresh", expires: 1 } };
const P = { "openai-codex": { type: "oauth", access: "p-access", refresh: "p-refresh", expires: 2 } };
const COPILOT = { "github-copilot": { type: "oauth", access: "gh", refresh: "gh", expires: 3 } };

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-sh-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, "agent");
  const base = join(root, "homes");
  mkdirSync(shared);
  mkdirSync(join(shared, "skills"));
  writeFileSync(join(shared, "skills", "s.md"), "skill");
  mkdirSync(join(shared, "sessions"));
  writeFileSync(join(shared, "AGENTS.md"), "agents");
  writeFileSync(join(shared, "models-store.json"), "{}");
  writeFileSync(join(shared, "auth.json.lock"), "");
  writeFileSync(join(shared, "auth.json.123.abc.tmp"), "{}");
  mkdirSync(join(shared, "settings.json.lock"));
  writeFileSync(join(shared, ".gentle-shell-home"), "");
  writeFileSync(
    join(shared, "settings.json"),
    JSON.stringify({
      packages: ["../ext/local", "./sub/deep/pkg", "npm:@scope/pkg", "git:github.com/a/b", "https://x.dev/p.git", "ssh://git@h/p", "/abs/pkg", { source: "../ext/obj", extensions: ["a"] }],
      compaction: { enabled: false },
      theme: "dark",
    }),
  );
  const store = new ProfileStore(shared);
  store.create("work");
  store.create("personal");
  writeAuthFile(store.authPath("work"), W);
  writeAuthFile(store.authPath("personal"), P);
  return { root, shared, base, store };
}

test("S30: build creates the recipe: links, private auth.json, absolute settings, current and marker", () => {
  const { shared, base, store } = sandbox();
  writeAuthFile(join(shared, "auth.json"), { ...COPILOT, anthropic: { type: "api_key", key: "live" } });
  const { home, marker } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base, pid: 4242 });
  assert.equal(home.startsWith(base), true);
  if (process.platform !== "win32") assert.equal(statSync(home).mode & 0o777, 0o700); // Windows has no POSIX modes
  assert.deepEqual(readdirSync(home).sort(), [SESSION_MARKER, SESSION_CURRENT, "AGENTS.md", "auth.json", "models-store.json", "profiles", "sessions", "settings.json", "skills"].sort());
  for (const name of ["AGENTS.md", "models-store.json", "profiles", "sessions", "skills"]) {
    // On Windows without symlink rights the file entries fall back to a hard link or a copy.
    if (process.platform === "win32") assert.equal(existsSync(join(home, name)), true, name);
    else assert.equal(lstatSync(join(home, name)).isSymbolicLink(), true, name);
  }
  assert.equal(lstatSync(join(home, "auth.json")).isFile(), true);
  if (process.platform !== "win32") assert.equal(statSync(join(home, "auth.json")).mode & 0o777, 0o600);
  // Non covered providers of the shared live auth are kept, covered ones come from the profile snapshot.
  assert.deepEqual(readAuthFile(join(home, "auth.json")), { ...COPILOT, ...P });
  const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));
  assert.deepEqual(settings, {
    packages: [join(shared, "..", "ext", "local"), join(shared, "sub", "deep", "pkg"), "npm:@scope/pkg", "git:github.com/a/b", "https://x.dev/p.git", "ssh://git@h/p", "/abs/pkg", { source: join(shared, "..", "ext", "obj"), extensions: ["a"] }],
    compaction: { enabled: false },
    theme: "dark",
  });
  assert.equal(readFileSync(join(home, SESSION_CURRENT), "utf8"), "personal\n");
  assert.equal(readSessionCurrent(home), "personal");
  assert.deepEqual(readSessionMarker(home), marker);
  assert.equal(marker.version, 1);
  assert.equal(marker.sharedAgentDir, realpathSync(shared));
  assert.equal(marker.profile, "personal");
  assert.equal(marker.pid, 4242);
  assert.match(marker.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(store.current(), null, "the global current is never written");
});

test("S30: re-scan at build time picks up new shared entries", () => {
  const { shared, base } = sandbox();
  const a = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeFileSync(join(shared, "new-file.json"), "{}");
  const b = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  assert.equal(existsSync(join(a.home, "new-file.json")), false);
  if (process.platform === "win32") assert.equal(existsSync(join(b.home, "new-file.json")), true);
  else assert.equal(lstatSync(join(b.home, "new-file.json")).isSymbolicLink(), true);
  assert.notEqual(a.home, b.home);
});

test("S30: the global current profile takes its covered entries from the shared live auth.json (freshest copy)", () => {
  const { shared, base, store } = sandbox();
  store.setCurrent("work");
  const fresh = { anthropic: { type: "oauth", access: "rotated", refresh: "rotated", expires: 9 } };
  writeAuthFile(join(shared, "auth.json"), { ...COPILOT, ...fresh });
  const w = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  assert.deepEqual(readAuthFile(join(w.home, "auth.json")), { ...COPILOT, ...fresh });
  const p = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.deepEqual(readAuthFile(join(p.home, "auth.json")), { ...COPILOT, ...P });
});

test("S30: no shared auth.json and an empty snapshot give {}; no shared settings.json writes none", () => {
  const { shared, base, store } = sandbox();
  rmSync(join(shared, "settings.json"));
  store.create("empty");
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "empty", baseDir: base });
  assert.deepEqual(readAuthFile(join(home, "auth.json")), {});
  assert.equal(existsSync(join(home, "settings.json")), false);
});

test("S30: win32 links directories as absolute junctions and files as hard links, then copies", () => {
  const { shared, base } = sandbox();
  const calls: string[] = [];
  const facade = {
    ...fs,
    symlinkSync: (target: string, path: string, type?: string) => {
      calls.push(`symlink ${type} ${target}`);
      fs.symlinkSync(target, path, "dir");
    },
    linkSync: (target: string, path: string) => {
      calls.push(`link ${target}`);
      if (target.endsWith("AGENTS.md")) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
      fs.linkSync(target, path);
    },
    copyFileSync: (src: string, dest: string) => {
      calls.push(`copy ${src}`);
      fs.copyFileSync(src, dest);
    },
  } as unknown as typeof fs;
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, platform: "win32", fs: facade });
  const real = realpathSync(shared);
  assert.deepEqual(calls.sort(), [
    `copy ${join(real, "AGENTS.md")}`,
    `link ${join(real, "AGENTS.md")}`,
    `link ${join(real, "models-store.json")}`,
    `symlink junction ${join(real, "profiles")}`,
    `symlink junction ${join(real, "sessions")}`,
    `symlink junction ${join(real, "skills")}`,
  ].sort());
  assert.equal(readFileSync(join(home, "AGENTS.md"), "utf8"), "agents");
  removeSessionHome(home, { platform: "win32", fs: facade });
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(join(shared, "AGENTS.md"), "utf8"), "agents");
  assert.equal(readFileSync(join(shared, "skills", "s.md"), "utf8"), "skill");
});

test("S30: removal never follows links: every shared file and folder stays intact", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  mkdirSync(join(home, "auth.json.lock")); // pi's lock dir left behind
  mkdirSync(join(home, "real-dir"));
  fs.symlinkSync(join(shared, "skills"), join(home, "real-dir", "nested-link"));
  removeSessionHome(home);
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(join(shared, "skills", "s.md"), "utf8"), "skill");
  assert.equal(readFileSync(join(shared, "AGENTS.md"), "utf8"), "agents");
  assert.deepEqual(readAuthFile(store.authPath("work")), W);
  assert.equal(existsSync(join(shared, "sessions")), true);
  assert.deepEqual(store.list(), ["personal", "work"]);
});

test("S30: finish copies the covered providers back into the session's current snapshot and removes the home", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  const rotated = { anthropic: { type: "oauth", access: "w2", refresh: "w2r", expires: 5 } };
  writeAuthFile(join(home, "auth.json"), { ...COPILOT, ...rotated });
  const err: string[] = [];
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: (l) => err.push(l) }), true);
  assert.deepEqual(err, []);
  assert.deepEqual(readAuthFile(store.authPath("work")), rotated);
  assert.deepEqual(readAuthFile(store.authPath("personal")), P);
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(join(shared, "auth.json")), false, "the shared live auth.json is not written");
  assert.deepEqual(readdirSync(store.profileDir("work")).filter((n) => n.includes(".tmp")), []);
});

test("S30: finish follows a switch made inside the session (H/.gentle-accounts-current)", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeFileSync(join(home, SESSION_CURRENT), "personal\n");
  const p2 = { "openai-codex": { type: "oauth", access: "p2", refresh: "p2", expires: 7 } };
  writeAuthFile(join(home, "auth.json"), p2);
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.deepEqual(readAuthFile(store.authPath("personal")), p2);
  assert.deepEqual(readAuthFile(store.authPath("work")), W);
});

test("S30: a failed copy-back reports on stderr and keeps H/auth.json and the home", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeFileSync(store.authPath("work"), "{corrupt");
  const err: string[] = [];
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: (l) => err.push(l) }), false);
  assert.equal(err.length, 1);
  assert.match(err[0], /^gentle-accounts: cannot save the session credentials of "work": .*kept in /);
  assert.equal(existsSync(join(home, "auth.json")), true);
  assert.equal(readFileSync(store.authPath("work"), "utf8"), "{corrupt");
});

test("S30: marker and current reads are tolerant", () => {
  const { root } = sandbox();
  const dir = join(root, "x");
  mkdirSync(dir);
  assert.equal(readSessionMarker(dir), null);
  assert.equal(readSessionCurrent(dir), null);
  for (const content of ["", "{bad", "[]", '{"version":2,"sharedAgentDir":"/a","profile":"w","pid":1}', '{"version":1,"profile":"w","pid":1}']) {
    writeFileSync(join(dir, SESSION_MARKER), content);
    assert.equal(readSessionMarker(dir), null, content);
  }
  assert.equal(readSessionMarker(join(root, "missing")), null);
});

test("S30: the sweeper finishes dead-pid homes, leaves alive and unreadable ones", () => {
  const { shared, base, store } = sandbox();
  const dead = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, pid: 999001 });
  const alive = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base, pid: 999002 });
  const broken = join(base, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, SESSION_MARKER), "{bad");
  const rotated = { anthropic: { type: "oauth", access: "late", refresh: "late", expires: 8 } };
  writeAuthFile(join(dead.home, "auth.json"), rotated);
  const swept = sweepSessionHomes(base, (pid) => pid === 999002, () => {});
  assert.deepEqual(swept, [dead.home]);
  assert.equal(existsSync(dead.home), false);
  assert.equal(existsSync(alive.home), true);
  assert.equal(existsSync(broken), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), rotated);
  assert.deepEqual(sweepSessionHomes(join(base, "none")), []);
});

test("S30: resolveContext uses the session paths with a marker and the global ones without", () => {
  const { shared, base, store } = sandbox();
  store.setCurrent("personal");
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  const s = resolveContext(home);
  assert.equal(s.session?.profile, "work");
  assert.equal(s.sharedDir, realpathSync(shared));
  assert.equal(s.store.agentDir, realpathSync(shared));
  assert.equal(s.store.currentPath, join(home, SESSION_CURRENT));
  assert.equal(s.liveAuthPath, join(home, "auth.json"));
  assert.equal(s.store.current(), "work");
  assert.equal(s.store.claudeDir("work"), join(realpathSync(shared), "profiles", "work", "claude"));
  const g = resolveContext(shared);
  assert.equal(g.session, null);
  assert.equal(g.sharedDir, shared);
  assert.equal(g.liveAuthPath, join(shared, "auth.json"));
  assert.equal(g.store.current(), "personal");
});

test("S30: relative packages resolve against the agent dir as given, also when it is reached through a symlink", { skip: process.platform === "win32" }, () => {
  const { root, shared, base } = sandbox();
  // <root>/a/b/link -> <root>/agent: "../../ext" means <root>/ext for pi, not <root>/../ext.
  mkdirSync(join(root, "a", "b"), { recursive: true });
  fs.symlinkSync(shared, join(root, "a", "b", "link"));
  writeFileSync(join(shared, "settings.json"), JSON.stringify({ packages: ["../../ext"] }));
  const via = join(root, "a", "b", "link");
  const { home, marker } = buildSessionHome({ sharedAgentDir: via, profile: "work", baseDir: base });
  assert.deepEqual(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).packages, [join(root, "a", "ext")]);
  assert.equal(marker.sharedAgentDir, shared);
});

const oauth = (access: string, expires: unknown) => ({ type: "oauth", access, refresh: access, expires });

test("S30: pickFreshest takes the oauth entry with the larger numeric expires, else the preferred one", () => {
  const live = oauth("live", 10);
  const snap = oauth("snap", 20);
  assert.equal(pickFreshest(live, snap), snap);
  assert.equal(pickFreshest(snap, live), snap);
  assert.equal(pickFreshest(oauth("a", 5), oauth("b", 5))?.access, "a");
  assert.equal(pickFreshest(oauth("a", "9"), oauth("b", 1))?.access, "a");
  assert.equal(pickFreshest(oauth("a", 1), oauth("b", null))?.access, "a");
  assert.equal(pickFreshest(oauth("a", undefined), oauth("b", 3))?.access, "a");
  const keyA = { type: "api_key", key: "a" };
  assert.equal(pickFreshest(keyA, { type: "api_key", key: "b" }), keyA);
  assert.equal(pickFreshest<unknown>(keyA, oauth("b", 99)), keyA);
  assert.equal(pickFreshest(undefined, snap), snap);
  assert.equal(pickFreshest(live, undefined), live);
  assert.equal(pickFreshest(undefined, undefined), undefined);
});

test("S30: the global current profile starts from the freshest entry per provider, never mixing fields", () => {
  const { shared, base, store } = sandbox();
  store.setCurrent("work");
  // A closed session copied a rotated anthropic token back into the snapshot; the shared live file is older.
  const snapAnthropic = oauth("snap-rotated", 50);
  const liveCodex = oauth("live-codex", 70);
  writeAuthFile(store.authPath("work"), { anthropic: snapAnthropic, "openai-codex": oauth("snap-codex", 60) });
  writeAuthFile(join(shared, "auth.json"), { ...COPILOT, anthropic: { ...oauth("live-old", 10), extra: "x" }, "openai-codex": liveCodex });
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  assert.deepEqual(readAuthFile(join(home, "auth.json")), { ...COPILOT, anthropic: snapAnthropic, "openai-codex": liveCodex });
});

test("S30: a provider only in the snapshot is used; api_key entries keep the live copy for the global current", () => {
  const { shared, base, store } = sandbox();
  store.setCurrent("work");
  writeAuthFile(store.authPath("work"), { anthropic: { type: "api_key", key: "snap" }, "openai-codex": oauth("only-snap", 5) });
  writeAuthFile(join(shared, "auth.json"), { ...COPILOT, anthropic: { type: "api_key", key: "live" } });
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  assert.deepEqual(readAuthFile(join(home, "auth.json")), { ...COPILOT, anthropic: { type: "api_key", key: "live" }, "openai-codex": oauth("only-snap", 5) });
});

test("S30: a profile that is not the global current uses only its snapshot, even when the live entry is fresher", () => {
  const { shared, base, store } = sandbox();
  store.setCurrent("work");
  writeAuthFile(store.authPath("personal"), { "openai-codex": oauth("snap", 1) });
  writeAuthFile(join(shared, "auth.json"), { ...COPILOT, "openai-codex": oauth("live", 99) });
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base });
  assert.deepEqual(readAuthFile(join(home, "auth.json")), { ...COPILOT, "openai-codex": oauth("snap", 1) });
});

// ---- T19c: copy-back merge by freshness, and the child pid in the marker ----

test("S30: copy-back keeps the fresher oauth entry of the snapshot over an older private one", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeAuthFile(store.authPath("work"), { anthropic: oauth("rotated-by-other", 50) });
  writeAuthFile(join(home, "auth.json"), { ...COPILOT, anthropic: oauth("stale", 10) });
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: oauth("rotated-by-other", 50) });
});

test("S30: a covered provider logged out inside the session is removed from the snapshot at copy-back", () => {
  const { shared, base, store } = sandbox();
  writeAuthFile(store.authPath("work"), { anthropic: oauth("a", 10), "openai-codex": oauth("c", 10) });
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeAuthFile(join(home, "auth.json"), { ...COPILOT, "openai-codex": oauth("c", 10) }); // the user logged anthropic out
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": oauth("c", 10) });
});

test("S30: copy-back: a fresher private oauth entry wins; ties and api keys take the private entry", () => {
  const { shared, base, store } = sandbox();
  const cases: [unknown, unknown, unknown][] = [
    [oauth("mine", 60), oauth("snap", 50), oauth("mine", 60)],
    [oauth("mine", 50), oauth("snap", 50), oauth("mine", 50)],
    [oauth("mine", "x"), oauth("snap", 99), oauth("mine", "x")],
    [{ type: "api_key", key: "mine" }, { type: "api_key", key: "snap" }, { type: "api_key", key: "mine" }],
  ];
  for (const [mine, snap, expected] of cases) {
    const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
    writeAuthFile(store.authPath("work"), { anthropic: snap });
    writeAuthFile(join(home, "auth.json"), { anthropic: mine });
    assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
    assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: expected }, JSON.stringify(mine));
  }
});

test("S30: copy-back adds a provider missing in the snapshot, drops one missing in the private file, never writes non covered ones", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  writeAuthFile(store.authPath("work"), { anthropic: oauth("snap", 5) });
  writeAuthFile(join(home, "auth.json"), { ...COPILOT, "openai-codex": oauth("new", 7) });
  assert.equal(finishSessionHome(home, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), { "openai-codex": oauth("new", 7) });
  assert.equal(existsSync(join(shared, "auth.json")), false);
});

test("S30: recordSessionChildPid rewrites the marker keeping every field and tolerates failures", () => {
  const { shared, base, root } = sandbox();
  const { home, marker } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, pid: 11 });
  assert.equal(readSessionMarker(home)?.childPid, undefined);
  recordSessionChildPid(home, 4321);
  assert.deepEqual(readSessionMarker(home), { ...marker, childPid: 4321 });
  assert.deepEqual(readdirSync(home).filter((n) => n.endsWith(".tmp")), []);
  assert.doesNotThrow(() => recordSessionChildPid(join(root, "missing"), 1));
});

test("S30: the sweeper keeps a home whose child is alive even when the launcher is dead; both dead sweeps it", () => {
  const { shared, base, store } = sandbox();
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, pid: 999101 });
  recordSessionChildPid(home, 999102);
  writeAuthFile(join(home, "auth.json"), { anthropic: oauth("in-use", 70) });
  const before = readFileSync(store.authPath("work"), "utf8");
  assert.deepEqual(sweepSessionHomes(base, (pid) => pid === 999102, () => {}), []);
  assert.equal(existsSync(home), true);
  assert.equal(readFileSync(store.authPath("work"), "utf8"), before, "nothing copied while the child runs");
  assert.deepEqual(sweepSessionHomes(base, () => false, () => {}), [home]);
  assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: oauth("in-use", 70) });
});

// ---- T19d ----

test("S30: a dangling symlink in the shared dir is linked as is and does not break the build", { skip: process.platform === "win32" }, () => {
  const { root, shared, base } = sandbox();
  fs.symlinkSync(join(root, "nowhere"), join(shared, "dangling"));
  const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base });
  assert.equal(lstatSync(join(home, "dangling")).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(join(home, "dangling")), join(realpathSync(shared), "dangling"));
});

test("S30: a failed build leaves no home behind (corrupt shared auth.json)", () => {
  const { shared, base } = sandbox();
  mkdirSync(base, { mode: 0o700 });
  writeFileSync(join(shared, "auth.json"), "{corrupt");
  assert.throws(() => buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base }), /Cannot parse/);
  assert.deepEqual(readdirSync(base), []);
});

test("S30: a failure after the home exists removes it without following links", () => {
  const { shared, base } = sandbox();
  let calls = 0;
  const facade = {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).endsWith(SESSION_MARKER) && ++calls) throw new Error("disk full");
      return fs.writeFileSync(...args);
    },
  } as unknown as typeof fs;
  mkdirSync(base, { mode: 0o700 });
  assert.throws(() => buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, fs: facade }), /disk full/);
  assert.deepEqual(readdirSync(base), []);
  assert.equal(readFileSync(join(shared, "skills", "s.md"), "utf8"), "skill");
});

test("S30: invalid JSON in the shared settings.json fails the build with a clear error and builds nothing", () => {
  const { shared, base } = sandbox();
  mkdirSync(base, { mode: 0o700 });
  writeFileSync(join(shared, "settings.json"), "{bad");
  assert.throws(
    () => buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base }),
    (e: Error) => e.message.startsWith(`gentle-accounts: cannot read ${join(realpathSync(shared), "settings.json")}: `),
  );
  assert.deepEqual(readdirSync(base), []);
});

test("S30: the default base dir is per user on POSIX", () => {
  const expected = process.platform === "win32" ? "gentle-accounts" : `gentle-accounts-${process.getuid!()}`;
  assert.equal(sessionBaseDir(), join(tmpdir(), expected));
});

test("S30: the base dir is created 0700 and refused when it is a symlink, world writable or owned by someone else", { skip: process.platform === "win32" }, () => {
  const { root, shared } = sandbox();
  const fresh = join(root, "fresh");
  ensureBaseDir(fresh);
  assert.equal(statSync(fresh).mode & 0o777, 0o700);
  const link = join(root, "link");
  fs.symlinkSync(fresh, link);
  assert.throws(() => ensureBaseDir(link), { message: `gentle-accounts: refusing to use ${link}: it is a symbolic link` });
  assert.throws(() => buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: link }), /refusing to use/);
  assert.deepEqual(readdirSync(fresh), []);
  const open = join(root, "open");
  mkdirSync(open);
  fs.chmodSync(open, 0o777);
  assert.throws(() => ensureBaseDir(open), { message: `gentle-accounts: refusing to use ${open}: it is group or world writable` });
  assert.throws(() => ensureBaseDir(fresh, { uid: process.getuid!() + 1 }), { message: `gentle-accounts: refusing to use ${fresh}: it is owned by another user` });
  assert.throws(() => buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: fresh, uid: process.getuid!() + 1 }), /owned by another user/);
  assert.deepEqual(readdirSync(fresh), []);
});

test("S30: the sweeper checks the base dir and ignores markers of another agent dir", { skip: process.platform === "win32" }, () => {
  const { root, shared, base, store } = sandbox();
  const dead = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base, pid: 999201 });
  writeAuthFile(join(dead.home, "auth.json"), { anthropic: oauth("x", 3) });
  const before = readFileSync(store.authPath("work"), "utf8");
  const err: string[] = [];
  const other = join(root, "other-agent");
  mkdirSync(other);
  assert.deepEqual(sweepSessionHomes(base, () => false, (l) => err.push(l), { sharedAgentDir: other }), []);
  assert.equal(existsSync(dead.home), true);
  assert.equal(readFileSync(store.authPath("work"), "utf8"), before);
  assert.deepEqual(err, [`gentle-accounts: leaving ${dead.home}: it belongs to another agent dir (${realpathSync(shared)})`]);
  err.length = 0;
  assert.deepEqual(sweepSessionHomes(base, () => false, (l) => err.push(l), { uid: process.getuid!() + 1 }), []);
  assert.deepEqual(err, [`gentle-accounts: refusing to use ${base}: it is owned by another user`]);
  assert.equal(existsSync(dead.home), true);
  assert.deepEqual(sweepSessionHomes(base, () => false, () => {}, { sharedAgentDir: shared }), [dead.home]);
});
