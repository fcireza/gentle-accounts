import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after } from "node:test";
import { buildSessionHome } from "../src/session-home.ts";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/gentle-accounts.mjs", import.meta.url));
const isWin = process.platform === "win32";

/** Real launcher + a fake `gentle-shell` on PATH (a .cmd shim on Windows) inside an isolated agent dir. */
/**
 * Node prints runtime warnings on stderr (for example DEP0190 on Windows with Node 24, because the launcher starts
 * the .cmd shim of gentle-shell with `shell: true`). They are not product output: keep them out of exact stderr checks.
 * Follow-up: start gentle-shell on Windows through an explicit cmd.exe invocation with proper quoting.
 */
function stripNodeWarnings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\(node:\d+\) /.test(line) && !/^\(Use `node /.test(line))
    .join("\n");
}

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-e2e-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const binDir = join(root, "bin");
  const tmp = join(root, "tmp");
  mkdirSync(agentDir);
  mkdirSync(binDir);
  mkdirSync(tmp);
  if (isWin) {
    writeFileSync(
      join(binDir, "gentle-shell.cmd"),
      "@echo off\r\necho GS args=%* dir=%CLAUDE_CONFIG_DIR% launch=%GENTLE_ACCOUNTS_LAUNCH_PROFILE% noauto=%GENTLE_SHELL_NO_AUTO_SETUP%\r\nif defined FAKE_AUTH echo %FAKE_AUTH%> \"%2\\auth.json\"\r\nif defined FAKE_EXIT exit /b %FAKE_EXIT%\r\n",
    );
  } else {
    // Fake gentle-shell: prints what it got, optionally sleeps until SIGTERM, then rewrites its auth.json in place.
    const shim = join(binDir, "gentle-shell");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        'echo "GS args=$* dir=$CLAUDE_CONFIG_DIR launch=$GENTLE_ACCOUNTS_LAUNCH_PROFILE noauto=$GENTLE_SHELL_NO_AUTO_SETUP"',
        'if [ -n "$FAKE_SLEEP" ]; then',
        '  trap \'printf "%s" "$FAKE_AUTH" > "$2/auth.json"; exit 143\' TERM',
        '  echo "READY $$"',
        "  while :; do sleep 0.1; done",
        "fi",
        // The launcher records the child pid right after the spawn: wait (bounded) for it instead of racing it.
        'if [ -n "$FAKE_MARKER" ]; then i=0; while ! grep -q childPid "$2/.gentle-accounts-session.json" && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i+1)); done; echo "PID=$$"; printf "MARKER=%s\\n" "$(tr -d "\\n " < "$2/.gentle-accounts-session.json")"; fi',
        'if [ -n "$FAKE_CAT" ]; then printf "AUTH=%s\\n" "$(tr -d "\\n " < "$2/auth.json")"; fi',
        'if [ -n "$FAKE_AUTH" ]; then printf "%s" "$FAKE_AUTH" > "$2/auth.json"; fi',
        "exit ${FAKE_EXIT:-0}",
        "",
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  }
  // Session homes go under <os.tmpdir()>/gentle-accounts: keep them inside the sandbox.
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, HOME: root, USERPROFILE: root, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.GENTLE_ACCOUNTS_LAUNCH_PROFILE;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${binDir}${delimiter}${env[pathKey] ?? ""}`;
  const run = (...args: string[]) => runWith({}, ...args);
  const runWith = (extra: NodeJS.ProcessEnv, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "").replaceAll("\r\n", "\n"), err: stripNodeWarnings((r.stderr ?? "").replaceAll("\r\n", "\n")) };
  };
  const homesDir = join(tmp, isWin ? "gentle-accounts" : `gentle-accounts-${process.getuid!()}`);
  const homes = () => (existsSync(homesDir) ? readdirSync(homesDir) : []);
  return { root, agentDir, env, run, runWith, homes, homesDir, live: join(agentDir, "auth.json") };
}

const auth = { "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 }, other: { type: "api_key", key: "u" } };

test("launcher e2e (S30): launches run on private homes, never switch the global profile, and copy credentials back", () => {
  const { agentDir, run, runWith, live, homes } = sandbox();
  writeFileSync(live, JSON.stringify(auth));

  assert.equal(run("create", "work").code, 0);
  assert.equal(run("create", "personal").code, 0);

  const w = run("work", "--flag");
  assert.equal(w.code, 0, w.err);
  assert.match(w.out, /^GS args=--home \S+gentle-accounts\S+ --flag dir=.*work.claude launch=work noauto=1$/m);
  assert.equal(readFileSync(live, "utf8"), JSON.stringify(auth), "the shared auth.json is untouched");
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "default", "auth.json"), "utf8")), { "openai-codex": auth["openai-codex"] });
  assert.equal(run("current").out.trim(), "default");

  const rotated = { "openai-codex": { type: "oauth", access: "p2", refresh: "p2", expires: 9 } };
  const p = runWith({ FAKE_AUTH: JSON.stringify({ ...rotated, other: auth.other }), FAKE_EXIT: "5" }, "personal");
  assert.equal(p.code, 5, p.err);
  assert.equal(p.err, "");
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "personal", "auth.json"), "utf8")), rotated);
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "work", "auth.json"), "utf8")), {});
  assert.equal(readFileSync(live, "utf8"), JSON.stringify(auth));
  assert.equal(run("current").out.trim(), "default");
  assert.equal(run("list").out, "* default\n  personal\n  work\n");
  assert.deepEqual(homes(), []);
});

test("launcher e2e (S30): --home, --link and --isolated are refused and nothing is built", () => {
  const { run, homes } = sandbox();
  run("create", "work");
  for (const flag of ["--home", "--link", "--isolated"]) {
    const r = run("work", flag, "x");
    assert.equal(r.code, 1);
    assert.equal(r.err, "gentle-accounts manages the agent home; do not pass --home, --link or --isolated.\n");
    assert.equal(r.out, "");
  }
  assert.deepEqual(homes(), []);
  assert.equal(run("current").out.trim(), "No active profile.");
});

test("launcher e2e (S30): the sweeper finishes a home left by a dead launcher", () => {
  const { agentDir, run, homes, homesDir } = sandbox();
  run("create", "work");
  run("create", "personal");
  const late = { anthropic: { type: "oauth", access: "late", refresh: "late", expires: 3 } };
  const { home } = buildSessionHome({ sharedAgentDir: agentDir, profile: "personal", baseDir: homesDir, pid: 9_999_991 });
  writeFileSync(join(home, "auth.json"), JSON.stringify(late));
  const r = run("work");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(homes(), []);
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "personal", "auth.json"), "utf8")), late);
});

test("launcher e2e (S30): SIGTERM to the launcher stops gentle-shell, copies its credentials back and removes the home", { skip: isWin }, async () => {
  const { agentDir, env, homes } = sandbox();
  spawnSync(process.execPath, [BIN, "create", "work"], { env });
  const rotated = { anthropic: { type: "oauth", access: "sigterm", refresh: "sigterm", expires: 4 } };
  const child = spawn(process.execPath, [BIN, "work"], { env: { ...env, FAKE_SLEEP: "1", FAKE_AUTH: JSON.stringify(rotated) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const ready = new Promise<void>((resolve) => child.stdout.on("data", (d) => ((out += d), out.includes("READY") && resolve())));
  const closed = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  await ready;
  const during = homes().length;
  child.kill("SIGTERM"); // before any assertion, so a failure never leaves the launcher running
  const code = await closed;
  assert.equal(during, 1);
  assert.equal(code, 143, err);
  assert.equal(err, "");
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "work", "auth.json"), "utf8")), rotated);
  assert.deepEqual(homes(), []);
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
  assert.match(d.out, /^GS args=--home \S+ dir= launch=default noauto=1\s*$/m);
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
  assert.match(p.out, /GS args=--home \S+ dir=.*personal.claude/);
  assert.equal(run("current").out.trim(), "default", "S30: the launch no longer switches the global profile");
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
  assert.match(p.out, /launch=personal noauto=1\s*$/m);
  assert.equal(run("current").out.trim(), "default", "S30: the launch no longer switches the global profile");
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

test("launcher e2e (S30): a token rotated in a session reaches the next launch of the global current profile", { skip: isWin }, () => {
  const { agentDir, run, runWith, live } = sandbox();
  const old = { type: "oauth", access: "old", refresh: "old", expires: 1 };
  writeFileSync(live, JSON.stringify({ anthropic: old }));
  assert.equal(run("create", "work").code, 0);
  writeFileSync(join(agentDir, "profiles", "work", "auth.json"), JSON.stringify({ anthropic: old }));
  writeFileSync(join(agentDir, "profiles", "current"), "work\n");
  const rotated = { type: "oauth", access: "new", refresh: "new", expires: 2 };
  const first = runWith({ FAKE_AUTH: JSON.stringify({ anthropic: rotated }) }, "work");
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(JSON.parse(readFileSync(live, "utf8")), { anthropic: old }, "the shared live file is never written");
  const second = runWith({ FAKE_CAT: "1" }, "work");
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /^AUTH=\{"anthropic":\{"type":"oauth","access":"new","refresh":"new","expires":2\}\}$/m);
  assert.equal(run("current").out.trim(), "work");
});

test("launcher e2e (S30): the marker holds the gentle-shell pid while it runs", { skip: isWin }, () => {
  const { run, runWith } = sandbox();
  run("create", "work");
  const r = runWith({ FAKE_MARKER: "1" }, "work");
  assert.equal(r.code, 0, r.err);
  const pid = /^PID=(\d+)$/m.exec(r.out)?.[1];
  assert.ok(pid);
  assert.match(r.out, new RegExp(`^MARKER=.*"childPid":${pid}\\}$`, "m"));
});

test("launcher e2e (S30): after kill -9 of the launcher the orphaned gentle-shell keeps its home until it dies", { skip: isWin }, async () => {
  const { agentDir, env, run, homes } = sandbox();
  run("create", "work");
  run("create", "personal");
  const rotated = { anthropic: { type: "oauth", access: "orphan", refresh: "orphan", expires: 8 } };
  const launcher = spawn(process.execPath, [BIN, "work"], { env: { ...env, FAKE_SLEEP: "1", FAKE_AUTH: JSON.stringify(rotated) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const childPid = await new Promise<number>((resolve) =>
    launcher.stdout.on("data", (d) => {
      out += d;
      const m = /READY (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    }),
  );
  const launcherGone = new Promise((r) => launcher.on("exit", r)); // "close" waits for the orphan holding stdout
  launcher.kill("SIGKILL");
  await launcherGone;
  launcher.stdout.destroy();
  launcher.stderr.destroy();
  try {
    assert.equal(homes().length, 1);
    const kept = homes()[0];
    const r = run("personal");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(homes(), [kept], "the orphan's home is in use and kept");
    assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "work", "auth.json"), "utf8")), {});
    process.kill(childPid, "SIGTERM"); // the fake writes its rotated token, then exits
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(childPid, 0);
        await new Promise((res) => setTimeout(res, 100));
      } catch {
        break;
      }
    }
    const s = run("personal");
    assert.equal(s.code, 0, s.err);
    assert.deepEqual(homes(), []);
    assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "profiles", "work", "auth.json"), "utf8")), rotated);
  } finally {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {}
  }
});

test("launcher e2e (S30): invalid JSON in the shared settings.json fails before building anything", () => {
  const { agentDir, run, homes } = sandbox();
  run("create", "work");
  writeFileSync(join(agentDir, "settings.json"), "{bad");
  const before = run("current").out;
  const r = run("work");
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.match(r.err, new RegExp(`^gentle-accounts: cannot read ${join(realpathSync(agentDir), "settings.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .+\n$`));
  assert.deepEqual(homes(), []);
  assert.equal(run("current").out, before);
  assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), "{bad");
});
