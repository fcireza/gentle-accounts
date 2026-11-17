import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/gentle-accounts.mjs", import.meta.url));
const isWin = process.platform === "win32";

/** Real launcher + a fake `gentle-shell` on PATH (a .cmd shim on Windows) inside an isolated agent dir. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "gentle-accounts-e2e-"));
  const agentDir = join(root, "agent");
  const binDir = join(root, "bin");
  mkdirSync(agentDir);
  mkdirSync(binDir);
  if (isWin) {
    writeFileSync(join(binDir, "gentle-shell.cmd"), "@echo off\r\necho GS args=%* dir=%CLAUDE_CONFIG_DIR% launch=%GENTLE_ACCOUNTS_LAUNCH_PROFILE%\r\n");
  } else {
    const shim = join(binDir, "gentle-shell");
    writeFileSync(shim, '#!/bin/sh\necho "GS args=$* dir=$CLAUDE_CONFIG_DIR launch=$GENTLE_ACCOUNTS_LAUNCH_PROFILE"\n');
    chmodSync(shim, 0o755);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, HOME: root, USERPROFILE: root };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.GENTLE_ACCOUNTS_LAUNCH_PROFILE;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${binDir}${delimiter}${env[pathKey] ?? ""}`;
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "").replaceAll("\r\n", "\n"), err: (r.stderr ?? "").replaceAll("\r\n", "\n") };
  };
  return { agentDir, run, live: join(agentDir, "auth.json") };
}

const auth = { "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 }, other: { type: "api_key", key: "u" } };

test("launcher e2e: create, launch, switch back and forth keeps every credential", () => {
  const { agentDir, run, live } = sandbox();
  writeFileSync(live, JSON.stringify(auth));

  assert.equal(run("create", "work").code, 0);
  assert.equal(run("create", "personal").code, 0);

  const w = run("work", "--flag");
  assert.equal(w.code, 0, w.err);
  assert.match(w.out, /GS args=--flag dir=.*work.claude/);
  assert.deepEqual(JSON.parse(readFileSync(live, "utf8")), { other: auth.other });
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "default", "auth.json"), "utf8")), { "openai-codex": auth["openai-codex"] });

  assert.equal(run("personal").code, 0);
  const d = run("default");
  assert.equal(d.code, 0, d.err);
  assert.deepEqual(JSON.parse(readFileSync(live, "utf8")), auth);
  assert.equal(run("current").out.trim(), "default");
  assert.equal(run("list").out, "* default\n  personal\n  work\n");
});

test("launcher e2e: a corrupt auth.json exits 1 and changes nothing", () => {
  const { agentDir, run, live } = sandbox();
  run("create", "work");
  writeFileSync(live, "{bad");
  const r = run("work");
  assert.equal(r.code, 1);
  assert.match(r.err, /Cannot parse/);
  assert.equal(readFileSync(live, "utf8"), "{bad");
  assert.equal(run("list").out, "  work\n");
  assert.equal(run("current").out.trim(), "No active profile.");
  assert.equal(agentDir.length > 0, true);
});

test("launcher e2e: a missing profile exits 1 with the documented message", () => {
  const { run } = sandbox();
  const r = run("ghost");
  assert.equal(r.code, 1);
  assert.equal(r.err.trim(), 'Profile "ghost" does not exist. Create it with: gentle-accounts create <name>');
});

test("launcher e2e (S16): the default profile starts gentle-shell without CLAUDE_CONFIG_DIR", () => {
  const { run } = sandbox();
  assert.equal(run("create", "work").code, 0);
  assert.match(run("work").out, /dir=.*work.claude/);
  const d = run("default");
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /^GS args= ?dir= launch=default\s*$/m);
});

test("launcher e2e (S27): startup sets the file, shows it, and an explicit launch still wins", () => {
  const { agentDir, run } = sandbox();
  assert.equal(run("create", "work").code, 0);
  assert.equal(run("create", "personal").code, 0);
  const s = run("startup", "work");
  assert.equal(s.code, 0, s.err);
  assert.equal(s.out, 'Startup profile set to "work". New sessions start on it.\n');
  assert.equal(readFileSync(join(agentDir, "profiles", "startup"), "utf8"), "work\n");
  assert.equal(run("startup").out, "Startup profile: work\n");
  const p = run("personal");
  assert.equal(p.code, 0, p.err);
  assert.match(p.out, /GS args= ?dir=.*personal.claude/);
  assert.equal(run("current").out.trim(), "personal");
  const g = run("startup", "ghost");
  assert.equal(g.code, 1);
  assert.equal(g.err, 'Profile "ghost" does not exist.\n');
});

test("launcher e2e (S27): gentle-shell receives GENTLE_ACCOUNTS_LAUNCH_PROFILE while startup is another profile", () => {
  const { run } = sandbox();
  run("create", "work");
  run("create", "personal");
  assert.equal(run("startup", "work").code, 0);
  const p = run("personal");
  assert.equal(p.code, 0, p.err);
  assert.match(p.out, /launch=personal\s*$/m);
  assert.equal(run("current").out.trim(), "personal");
});

test("launcher e2e (S29): email is hidden by default, show persists it, list ignores the settings file", () => {
  const { agentDir, run } = sandbox();
  const h = run("email");
  assert.equal(h.code, 0, h.err);
  assert.equal(h.out, "Email display: hidden (masked in the status bar)\n");
  const s = run("email", "show");
  assert.equal(s.code, 0, s.err);
  assert.equal(s.out, "Email display set to shown. The status bar shows the full email.\n");
  assert.equal(run("email").out, "Email display: shown (full email in the status bar)\n");
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "settings.json"), "utf8")), { showEmail: true });
  const u = run("email", "x");
  assert.equal(u.code, 1);
  assert.equal(u.err, "Usage: gentle-accounts email [show|hide]\n");
  assert.equal(run("create", "work").code, 0);
  assert.equal(run("list").out, "  work\n");
});
