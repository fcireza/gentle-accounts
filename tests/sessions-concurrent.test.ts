// S30 / L23: several projects at the same time, each on its own account.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, switchProfile, writeAuthFile } from "../src/auth-sync.ts";
import { SESSION_CURRENT, buildSessionHome, finishSessionHome, resolveContext } from "../src/session-home.ts";

const W = { anthropic: { type: "oauth", access: "w-access", refresh: "w-refresh", expires: 1 } };
const P = { "openai-codex": { type: "oauth", access: "p-access", refresh: "p-refresh", expires: 2 } };
const COPILOT = { "github-copilot": { type: "oauth", access: "gh", refresh: "gh", expires: 3 } };

const sha = (path: string): string => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "missing");

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-conc-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, "agent");
  const base = join(root, "homes");
  mkdirSync(shared);
  writeFileSync(join(shared, "settings.json"), JSON.stringify({ packages: ["../ext"] }));
  const store = new ProfileStore(shared);
  return { root, shared, base, store };
}

function twoSessions() {
  const box = sandbox();
  const { shared, base, store } = box;
  store.create("work");
  store.create("personal");
  writeAuthFile(store.authPath("work"), W);
  writeAuthFile(store.authPath("personal"), P);
  writeAuthFile(join(shared, "auth.json"), COPILOT);
  const h1 = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base }).home;
  const h2 = buildSessionHome({ sharedAgentDir: shared, profile: "personal", baseDir: base }).home;
  return { ...box, h1, h2 };
}

function fingerprint(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [p, sha(p)]));
}

test("S30: a switch inside session 1 leaves session 2, every snapshot and the global files byte-identical", () => {
  const { shared, store, h1, h2 } = twoSessions();
  const watched = [join(h2, "auth.json"), join(h2, SESSION_CURRENT), store.authPath("work"), store.authPath("personal"), join(shared, "auth.json"), store.currentPath];
  const before = fingerprint(watched);
  const s1 = resolveContext(h1);
  const env: Record<string, string | undefined> = {};
  assert.equal(switchProfile({ store: s1.store, liveAuthPath: s1.liveAuthPath, env, to: "personal" }).status, "switched");
  assert.deepEqual(fingerprint(watched), before);
  assert.equal(readFileSync(join(h1, SESSION_CURRENT), "utf8"), "personal\n");
  assert.deepEqual(readAuthFile(join(h1, "auth.json")), { ...COPILOT, ...P });
  assert.equal(existsSync(store.currentPath), false, "profiles/current is never written by a session");
  assert.equal(resolveContext(h2).store.current(), "personal");
  assert.deepEqual(readAuthFile(join(h2, "auth.json")), { ...COPILOT, ...P });
  assert.equal(env.CLAUDE_CONFIG_DIR, join(shared, "profiles", "personal", "claude"));
});

test("S30: no snapshot ever receives the other session's credentials", () => {
  const { store, h1, h2 } = twoSessions();
  const s1 = resolveContext(h1);
  const s2 = resolveContext(h2);
  // Session 2 rotates its Codex token, then both sessions switch around.
  const p2 = { "openai-codex": { type: "oauth", access: "p-rotated", refresh: "p-rotated", expires: 22 } };
  writeAuthFile(s2.liveAuthPath, { ...COPILOT, ...p2 });
  switchProfile({ store: s2.store, liveAuthPath: s2.liveAuthPath, env: {}, to: "work" });
  switchProfile({ store: s1.store, liveAuthPath: s1.liveAuthPath, env: {}, to: "personal" });
  assert.deepEqual(readAuthFile(store.authPath("work")), W);
  assert.deepEqual(readAuthFile(store.authPath("personal")), p2);
  assert.deepEqual(readAuthFile(s1.liveAuthPath), { ...COPILOT, ...p2 });
  assert.deepEqual(readAuthFile(s2.liveAuthPath), { ...COPILOT, ...W });
  assert.equal(s1.store.current(), "personal");
  assert.equal(s2.store.current(), "work");
});

test("S30: two sessions on different profiles copy back their own credentials", () => {
  const { shared, store, h1, h2 } = twoSessions();
  const w2 = { anthropic: { type: "oauth", access: "w2", refresh: "w2", expires: 11 } };
  const p2 = { "openai-codex": { type: "oauth", access: "p2", refresh: "p2", expires: 12 } };
  writeAuthFile(join(h1, "auth.json"), { ...COPILOT, ...w2 });
  writeAuthFile(join(h2, "auth.json"), { ...COPILOT, ...p2 });
  assert.equal(finishSessionHome(h2, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.equal(finishSessionHome(h1, { sharedAgentDir: shared, stderr: () => {} }), true);
  assert.deepEqual(readAuthFile(store.authPath("work")), w2);
  assert.deepEqual(readAuthFile(store.authPath("personal")), p2);
  assert.equal(existsSync(h1) || existsSync(h2), false);
  assert.deepEqual(readAuthFile(join(shared, "auth.json")), COPILOT);
});

test("S30: a token rotation in one private auth.json lands only in its profile snapshot", () => {
  const { shared, store, h1, h2 } = twoSessions();
  const personalBefore = sha(store.authPath("personal"));
  const sharedBefore = sha(join(shared, "auth.json"));
  const w2 = { anthropic: { type: "oauth", access: "w-rot", refresh: "w-rot", expires: 99 } };
  writeAuthFile(join(h1, "auth.json"), { ...COPILOT, ...w2 });
  const h2Before = sha(join(h2, "auth.json"));
  finishSessionHome(h1, { sharedAgentDir: shared, stderr: () => {} });
  assert.deepEqual(readAuthFile(store.authPath("work")), w2);
  assert.equal(sha(store.authPath("personal")), personalBefore);
  assert.equal(sha(join(h2, "auth.json")), h2Before);
  assert.equal(sha(join(shared, "auth.json")), sharedBefore);
  finishSessionHome(h2, { sharedAgentDir: shared, stderr: () => {} });
  assert.equal(sha(store.authPath("personal")), personalBefore);
  assert.deepEqual(readAuthFile(store.authPath("work")), w2);
});

test("S30: first-run default creation from 8 real processes at once (4 sessions, 4 global) is consistent", async () => {
  const { root, shared, base, store } = sandbox();
  const live = { ...COPILOT, ...W };
  writeAuthFile(join(shared, "auth.json"), live);
  const homes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { home } = buildSessionHome({ sharedAgentDir: shared, profile: "default", baseDir: base });
    rmSync(join(home, SESSION_CURRENT)); // no session profile yet: the session must create default
    writeAuthFile(join(home, "auth.json"), live); // same live login as the shared dir
    homes.push(home);
  }
  const go = join(root, "go");
  const src = (f: string) => pathToFileURL(join(import.meta.dirname, "..", "src", f)).href;
  const script = join(root, "child.mjs");
  writeFileSync(
    script,
    [
      `import { existsSync } from "node:fs";`,
      `import { ensureDefaultProfile } from ${JSON.stringify(src("auth-sync.ts"))};`,
      `import { resolveContext } from ${JSON.stringify(src("session-home.ts"))};`,
      `const ctx = resolveContext(process.argv[2]);`,
      `while (!existsSync(${JSON.stringify(go)})) {}`,
      `const env = {};`,
      `ensureDefaultProfile({ store: ctx.store, liveAuthPath: ctx.liveAuthPath, env });`,
      `process.stdout.write(String(ctx.store.current()));`,
    ].join("\n"),
  );
  const run = (dir: string) =>
    new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [script, dir], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => resolve({ code, out, err }));
    });
  const runs = [...homes, shared, shared, shared, shared].map(run);
  await new Promise((r) => setTimeout(r, 400)); // every child is loaded and spinning
  writeFileSync(go, "");
  const results = await Promise.all(runs);
  for (const r of results) {
    assert.equal(r.err, "");
    assert.equal(r.code, 0);
    assert.equal(r.out, "default");
  }
  assert.deepEqual(store.list(), ["default"]);
  assert.deepEqual(readAuthFile(store.authPath("default")), W);
  assert.equal(readFileSync(store.currentPath, "utf8"), "default\n");
  for (const h of homes) assert.equal(readFileSync(join(h, SESSION_CURRENT), "utf8"), "default\n");
  const leftovers = [...readdirSync(store.profilesDir), ...readdirSync(store.profileDir("default")), ...homes.flatMap((h) => readdirSync(h))].filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(readAuthFile(join(shared, "auth.json")), live);
});

const rot = (access: string, expires: number) => ({ anthropic: { type: "oauth", access, refresh: access, expires } });

for (const order of ["rotating session first", "idle session first"]) {
  test(`S30: two sessions on the same profile: a rotation survives the idle session's copy-back (${order})`, () => {
    const { shared, base, store } = sandbox();
    store.create("work");
    writeAuthFile(store.authPath("work"), rot("orig", 10));
    const a = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base }).home;
    const c = buildSessionHome({ sharedAgentDir: shared, profile: "work", baseDir: base }).home;
    writeAuthFile(join(a, "auth.json"), { ...COPILOT, ...rot("rotated", 20) });
    const homes = order === "rotating session first" ? [a, c] : [c, a];
    for (const h of homes) assert.equal(finishSessionHome(h, { sharedAgentDir: shared, stderr: () => {} }), true);
    assert.deepEqual(readAuthFile(store.authPath("work")), rot("rotated", 20));
    assert.equal(existsSync(join(shared, "auth.json")), false);
  });
}
