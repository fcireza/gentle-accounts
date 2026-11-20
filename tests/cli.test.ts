import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile, LAUNCH_PROFILE_ENV } from "../src/auth-sync.ts";
import { runCli, windowsShellArgs, type CliDeps, type SpawnCall } from "../src/cli.ts";
import { SESSION_CURRENT, SESSION_MARKER, buildSessionHome, readSessionMarker } from "../src/session-home.ts";
import { chmodSync, mkdirSync } from "node:fs";

function setup(platform: NodeJS.Platform = "linux") {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-cli-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  const out: string[] = [];
  const err: string[] = [];
  const spawns: SpawnCall[] = [];
  /** What gentle-shell saw in its home while it ran (the home is removed afterwards). */
  const homes: { home: string; auth: unknown; current: string; marker: unknown }[] = [];
  const env: Record<string, string | undefined> = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: agentDir };
  const sessionBaseDir = join(agentDir, "session-homes");
  const deps: CliDeps = {
    store,
    liveAuthPath,
    env,
    platform,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    sessionBaseDir,
    spawn: (call) => {
      spawns.push(call);
      if (call.command === "gentle-shell") {
        const home = call.args[1];
        homes.push({ home, auth: readAuthFile(join(home, "auth.json")), current: readFileSync(join(home, SESSION_CURRENT), "utf8"), marker: readSessionMarker(home) });
      }
      return 0;
    },
  };
  const canonical = new ProfileStore(realpathSync(agentDir));
  return { agentDir, store, canonical, liveAuthPath, env, out, err, spawns, homes, deps, sessionBaseDir };
}

test("S30: gentle-accounts <name> runs gentle-shell --home <private home> without switching the global profile", async () => {
  const { agentDir, store, canonical, liveAuthPath, out, err, spawns, homes, deps, sessionBaseDir } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "w" }, other: 1 });
  writeAuthFile(store.authPath("personal"), { "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 } });
  const liveBefore = readFileSync(liveAuthPath, "utf8");
  const workBefore = readFileSync(store.authPath("work"), "utf8");

  const code = await runCli(["personal", "--flag", "x"], deps);

  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, []);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "gentle-shell");
  assert.equal(spawns[0].args[0], "--home");
  assert.equal(spawns[0].args[1].startsWith(sessionBaseDir), true);
  assert.deepEqual(spawns[0].args.slice(2), ["--flag", "x"]);
  assert.equal(spawns[0].env.CLAUDE_CONFIG_DIR, canonical.claudeDir("personal"));
  assert.equal(spawns[0].env.GENTLE_SHELL_NO_AUTO_SETUP, "1");
  assert.equal(spawns[0].env[LAUNCH_PROFILE_ENV], "personal");
  assert.equal("PI_CODING_AGENT_DIR" in spawns[0].env, false);
  assert.equal(spawns[0].env.PATH, "/usr/bin");
  assert.equal(spawns[0].shell, false);
  assert.deepEqual(homes[0].auth, { "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 }, other: 1 });
  assert.equal(homes[0].current, "personal\n");
  assert.equal((homes[0].marker as { profile: string; sharedAgentDir: string; pid: number }).profile, "personal");
  assert.equal((homes[0].marker as { sharedAgentDir: string }).sharedAgentDir, realpathSync(agentDir));
  assert.equal((homes[0].marker as { pid: number }).pid, process.pid);
  // Global state untouched; the home is removed after gentle-shell exits.
  assert.equal(store.current(), "work");
  assert.equal(readFileSync(liveAuthPath, "utf8"), liveBefore);
  assert.equal(readFileSync(store.authPath("work"), "utf8"), workBefore);
  assert.equal(existsSync(spawns[0].args[1]), false);
  assert.deepEqual(readdirSync(sessionBaseDir), []);
});

test("S30: first launch with no active profile keeps the live login in a default profile and leaves it global current", async () => {
  const { store, liveAuthPath, spawns, homes, deps } = setup();
  store.create("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "live" } });
  assert.equal(await runCli(["work"], deps), 0);
  assert.equal(spawns.length, 1);
  assert.deepEqual(store.list(), ["default", "work"]);
  assert.equal(store.current(), "default");
  assert.deepEqual(readAuthFile(store.authPath("default")), { anthropic: { type: "api_key", key: "live" } });
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: { type: "api_key", key: "live" } });
  assert.deepEqual(homes[0].auth, {});
});

test("S30: --home, --link and --isolated are rejected before anything is built", async () => {
  for (const flag of ["--home", "--link", "--isolated", "--home=/x"]) {
    const { store, err, spawns, deps, sessionBaseDir } = setup();
    store.create("work");
    assert.equal(await runCli(["work", "--x", flag], deps), 1, flag);
    assert.deepEqual(err, ["gentle-accounts manages the agent home; do not pass --home, --link or --isolated."]);
    assert.deepEqual(spawns, []);
    assert.equal(existsSync(sessionBaseDir), false);
    assert.equal(store.current(), null);
    assert.deepEqual(store.list(), ["work"]);
  }
});

test("S30: credentials written by gentle-shell are copied back to the profile snapshot after it exits", async () => {
  const { store, liveAuthPath, deps, sessionBaseDir } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "w" } });
  const rotated = { "openai-codex": { type: "oauth", access: "rot", refresh: "rot", expires: 5 } };
  deps.spawn = (call) => {
    writeAuthFile(join(call.args[1], "auth.json"), rotated);
    return 7;
  };
  assert.equal(await runCli(["personal"], deps), 7);
  assert.deepEqual(readAuthFile(store.authPath("personal")), rotated);
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: { type: "api_key", key: "w" } });
  assert.deepEqual(readdirSync(sessionBaseDir), []);
});

test("S30: a spawn error still finishes the home; an async spawn result is awaited", async () => {
  const { store, deps, sessionBaseDir } = setup();
  store.create("work");
  deps.spawn = () => {
    throw new Error("spawn gentle-shell ENOENT");
  };
  const err: string[] = [];
  deps.stderr = (l) => err.push(l);
  assert.equal(await runCli(["work"], deps), 1);
  assert.deepEqual(err, ["Cannot run gentle-shell: spawn gentle-shell ENOENT"]);
  assert.deepEqual(readdirSync(sessionBaseDir), []);
  deps.spawn = async () => 4;
  assert.equal(await runCli(["work"], deps), 4);
  assert.deepEqual(readdirSync(sessionBaseDir), []);
});

test("S30: the launcher sweeps dead-pid homes before building and registers an exit cleanup", async () => {
  const { agentDir, store, deps, sessionBaseDir } = setup();
  store.create("work");
  store.create("personal");
  const dead = buildSessionHome({ sharedAgentDir: agentDir, profile: "personal", baseDir: sessionBaseDir, pid: 999_999_1 });
  const alive = buildSessionHome({ sharedAgentDir: agentDir, profile: "personal", baseDir: sessionBaseDir, pid: process.pid });
  const late = { "openai-codex": { type: "oauth", access: "late", refresh: "late", expires: 6 } };
  writeAuthFile(join(dead.home, "auth.json"), late);
  const exitHooks: (() => void)[] = [];
  deps.onExit = (fn) => exitHooks.push(fn);
  let during: string[] = [];
  deps.spawn = (call) => {
    during = readdirSync(sessionBaseDir).sort();
    exitHooks[0](); // a signal-driven exit while gentle-shell runs still finishes the home once
    return existsSync(call.args[1]) ? 9 : 0;
  };
  assert.equal(await runCli(["work"], deps), 0);
  assert.equal(during.includes(dead.home.split(/[\\/]/).pop()!), false);
  assert.equal(existsSync(alive.home), true);
  assert.deepEqual(readAuthFile(store.authPath("personal")), late);
  assert.deepEqual(readdirSync(sessionBaseDir), [alive.home.split(/[\\/]/).pop()]);
  assert.equal(existsSync(join(alive.home, SESSION_MARKER)), true);
});

test("launching the active profile still execs gentle-shell and returns its exit code", async () => {
  const { store, canonical, spawns, deps } = setup();
  store.create("work");
  store.setCurrent("work");
  deps.spawn = (call) => {
    spawns.push(call);
    return 3;
  };
  assert.equal(await runCli(["work"], deps), 3);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].env.CLAUDE_CONFIG_DIR, canonical.claudeDir("work"));
});

test("on Windows gentle-shell is spawned through the shell so .cmd shims resolve", async () => {
  const { store, spawns, deps } = setup("win32");
  store.create("work");
  assert.equal(await runCli(["work"], deps), 0);
  assert.equal(spawns[0].shell, true);
});

test("a missing profile prints the exact message, exits 1 and spawns nothing", () => {
  const { store, err, spawns, deps } = setup();
  store.create("work");
  store.setCurrent("work");
  assert.equal(runCli(["ghost"], deps), 1);
  assert.deepEqual(err, ['Profile "ghost" does not exist. Create it with: gentle-accounts create <name>']);
  assert.deepEqual(spawns, []);
  assert.equal(store.current(), "work");
});

test("list, create and current mirror the slash command without a UI", () => {
  const { store, out, err, deps } = setup();
  assert.equal(runCli(["list"], deps), 0);
  assert.deepEqual(out, ["No profiles. Create one with: gentle-accounts create <name>"]);
  out.length = 0;
  assert.equal(runCli(["create", "work"], deps), 0);
  assert.equal(runCli(["create", "personal"], deps), 0);
  assert.deepEqual(out, ['Created profile "work".', 'Created profile "personal".']);
  out.length = 0;
  assert.equal(runCli(["create", "Bad Name"], deps), 1);
  assert.deepEqual(err, ['Invalid profile name "Bad Name": use lowercase letters, digits, "-" or "_" (max 32 chars).']);
  err.length = 0;
  assert.equal(runCli(["current"], deps), 0);
  assert.deepEqual(out, ["No active profile."]);
  out.length = 0;
  store.setCurrent("work");
  assert.equal(runCli(["list"], deps), 0);
  assert.deepEqual(out, ["  personal", "* work"]);
  out.length = 0;
  assert.equal(runCli(["current"], deps), 0);
  assert.deepEqual(out, ["work"]);
});

test("login <name> runs claude auth login with the profile's CLAUDE_CONFIG_DIR", () => {
  const { store, spawns, deps } = setup();
  store.create("work");
  assert.equal(runCli(["login", "work"], deps), 0);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "claude");
  assert.deepEqual(spawns[0].args, ["auth", "login"]);
  assert.equal(spawns[0].env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
});

test("no args or --help prints usage; --help exits 0, no args exits 1", () => {
  const { out, err, deps } = setup();
  assert.equal(runCli(["--help"], deps), 0);
  assert.match(out.join("\n"), /gentle-accounts <name> \[gentle-shell args\.\.\.\]/);
  assert.equal(runCli([], deps), 1);
  assert.match(err.join("\n"), /gentle-accounts <name>/);
});

test("a corrupt target with no active profile fails without creating default or setting current", async () => {
  const { store, liveAuthPath, err, spawns, deps } = setup();
  store.create("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "live" } });
  writeFileSync(store.authPath("work"), "{bad");
  assert.equal(await runCli(["work"], deps), 1);
  assert.match(err.join("\n"), /Cannot parse .*auth\.json/);
  assert.deepEqual(spawns, []);
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(store.current(), null);
  assert.deepEqual(readAuthFile(liveAuthPath), { anthropic: { type: "api_key", key: "live" } });
});

test("S16: launching the system-default profile builds a child env without CLAUDE_CONFIG_DIR", async () => {
  const { store, spawns, deps, env } = setup();
  store.create("default", { claudeDefault: true });
  store.create("work");
  store.setCurrent("work");
  env.CLAUDE_CONFIG_DIR = "/from/user";
  assert.equal(await runCli(["default"], deps), 0);
  assert.equal(spawns.length, 1);
  assert.equal("CLAUDE_CONFIG_DIR" in spawns[0].env, false);
  assert.equal(spawns[0].env.PATH, "/usr/bin");
});

test("S16: login for the system-default profile runs claude auth login without CLAUDE_CONFIG_DIR", () => {
  const { store, spawns, deps, env } = setup();
  store.create("default", { claudeDefault: true });
  env.CLAUDE_CONFIG_DIR = "/from/user";
  assert.equal(runCli(["login", "default"], deps), 0);
  assert.deepEqual(spawns[0].args, ["auth", "login"]);
  assert.equal("CLAUDE_CONFIG_DIR" in spawns[0].env, false);
});

test("S27: gentle-accounts startup shows, sets and clears the session profile", () => {
  const { store, out, err, spawns, deps } = setup();
  assert.equal(runCli(["startup"], deps), 0);
  assert.deepEqual(out.splice(0), ["Session profile: none (new sessions start on the last used profile: none)"]);
  store.create("work");
  store.setCurrent("work");
  assert.equal(runCli(["startup"], deps), 0);
  assert.deepEqual(out.splice(0), ["Session profile: none (new sessions start on the last used profile: work)"]);
  assert.equal(runCli(["startup", "work"], deps), 0);
  assert.deepEqual(out.splice(0), ['Session profile set to "work". New sessions start on it.']);
  assert.equal(store.startup(), "work");
  assert.equal(runCli(["startup"], deps), 0);
  assert.deepEqual(out.splice(0), ["Session profile: work"]);
  assert.equal(runCli(["startup", "last"], deps), 0);
  assert.deepEqual(out.splice(0), ["Session profile cleared. New sessions start on the last used profile."]);
  assert.equal(store.startup(), null);
  assert.deepEqual(err, []);
  assert.deepEqual(spawns, []);
});

test("S27: gentle-accounts startup rejects invalid and unknown names with exit 1", () => {
  const { store, out, err, deps } = setup();
  store.create("work");
  store.setStartup("work");
  assert.equal(runCli(["startup", "Bad"], deps), 1);
  assert.equal(runCli(["startup", "ghost"], deps), 1);
  assert.deepEqual(err, [
    'Invalid profile name "Bad": use lowercase letters, digits, "-" or "_" (max 32 chars).',
    'Profile "ghost" does not exist.',
  ]);
  assert.deepEqual(out, []);
  assert.equal(store.startup(), "work");
});

test("session and its alias startup give identical output and effect in the CLI", () => {
  const run = (word: string) => {
    const { out, err, store, deps } = setup();
    store.create("work");
    const log: unknown[] = [];
    for (const args of [[word], [word, "work"], [word], [word, "last"], [word], [word, "ghost"]]) {
      log.push(runCli(args, deps), out.splice(0), err.splice(0), store.startup());
    }
    return log;
  };
  assert.deepEqual(run("startup"), run("session"));
});

test("S27: usage lists the startup command", () => {
  const { out, deps } = setup();
  assert.equal(runCli(["--help"], deps), 0);
  assert.match(out.join("\n"), /gentle-accounts session \[<name>\|last\] +.*\(alias: startup\)/);
});

test("S27: the <name> launch exports GENTLE_ACCOUNTS_LAUNCH_PROFILE; login, list and startup do not", async () => {
  const { store, spawns, deps } = setup();
  assert.equal(LAUNCH_PROFILE_ENV, "GENTLE_ACCOUNTS_LAUNCH_PROFILE");
  store.create("work");
  store.create("personal");
  store.setStartup("work");
  assert.equal(runCli(["list"], deps), 0);
  assert.equal(runCli(["startup"], deps), 0);
  assert.equal(spawns.length, 0);
  assert.equal(runCli(["login", "personal"], deps), 0);
  assert.equal(LAUNCH_PROFILE_ENV in spawns[0].env, false);
  assert.equal(await runCli(["personal", "--x"], deps), 0);
  assert.equal(spawns[1].command, "gentle-shell");
  assert.equal(spawns[1].env[LAUNCH_PROFILE_ENV], "personal");
  assert.equal(LAUNCH_PROFILE_ENV in deps.env, false);
});

test("S29: gentle-accounts email shows, sets and rejects with exit codes", () => {
  const { store, out, err, deps } = setup();
  const path = join(store.profilesDir, "settings.json");
  assert.equal(runCli(["email"], deps), 0);
  assert.equal(runCli(["email", "show"], deps), 0);
  assert.equal(runCli(["email"], deps), 0);
  assert.equal(runCli(["email", "hide"], deps), 0);
  assert.deepEqual(out, [
    "Email display: hidden (not shown in the status bar)",
    "Email display set to shown. The status bar shows the full email.",
    "Email display: shown (full email in the status bar)",
    "Email display set to hidden. The status bar does not show the email.",
  ]);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { showEmail: false });
  assert.deepEqual(err, []);
  assert.equal(runCli(["email", "maybe"], deps), 1);
  assert.deepEqual(err, ["Usage: gentle-accounts email [show|hide]"]);
  const help: string[] = [];
  runCli(["--help"], { ...deps, stdout: (l) => help.push(l) });
  assert.match(help[0], /^  gentle-accounts email \[show\|hide\] +show or set whether the status bar shows the full email/m);
});

test("S30: the launcher records the spawned gentle-shell pid in the session marker", async () => {
  const { store, deps } = setup();
  store.create("work");
  let seen: unknown;
  deps.spawn = (call) => {
    call.onSpawn?.(31337);
    seen = readSessionMarker(call.args[1])?.childPid;
    return 0;
  };
  assert.equal(await runCli(["work"], deps), 0);
  assert.equal(seen, 31337);
});

test("T22: gentle-accounts create refuses a reserved name; create work still works", () => {
  const { store, out, err, deps } = setup();
  assert.equal(runCli(["create", "startup"], deps), 1);
  assert.deepEqual(err, ['"startup" is a reserved word (it is a subcommand). Pick another profile name.']);
  assert.deepEqual(store.list(), []);
  assert.equal(runCli(["create", "work"], deps), 0);
  assert.deepEqual(out, ['Created profile "work".']);
});

test("T22: gentle-accounts email with extra words prints the usage and changes nothing", () => {
  const { store, out, err, deps } = setup();
  const path = join(store.profilesDir, "settings.json");
  assert.equal(runCli(["email", "show", "now"], deps), 1);
  assert.deepEqual(err, ["Usage: gentle-accounts email [show|hide]"]);
  assert.deepEqual(out, []);
  assert.equal(existsSync(path), false);
  assert.equal(runCli(["email", "show"], deps), 0);
  assert.deepEqual(out, ["Email display set to shown. The status bar shows the full email."]);
});

test("T22 win32: windowsShellArgs quotes arguments with spaces or tabs and keeps the others", () => {
  assert.deepEqual(windowsShellArgs(["--home", "C:\\Users\\a b\\h", "x", "tab\there", ""]), ["--home", '"C:\\Users\\a b\\h"', "x", '"tab\there"', '""']);
  for (const bad of ["a&b", "a|b", "a<b", "a>b", "a^b", 'a"b', "%PATH%", "a\nb", "a\rb"]) {
    assert.throws(() => windowsShellArgs([bad]), { message: `gentle-accounts: argument "${bad}" contains characters that cmd.exe would interpret (& | < > ^ " %); pass it another way.` }, bad);
  }
});

test("T22 win32: the launch passes quoted args to the shell spawn", async () => {
  const { store, spawns, deps } = setup("win32");
  store.create("work");
  assert.equal(await runCli(["work", "--prompt", "hello world"], deps), 0);
  assert.equal(spawns[0].shell, true);
  assert.deepEqual(spawns[0].args.slice(2), ["--prompt", '"hello world"']);
  assert.equal(spawns[0].args[0], "--home");
});

test("T22 win32: a cmd metacharacter is rejected before any home or default profile is built", async () => {
  const { store, err, spawns, deps, sessionBaseDir } = setup("win32");
  store.create("work");
  assert.equal(await runCli(["work", "a&calc"], deps), 1);
  assert.deepEqual(err, ['gentle-accounts: argument "a&calc" contains characters that cmd.exe would interpret (& | < > ^ " %); pass it another way.']);
  assert.deepEqual(spawns, []);
  assert.equal(existsSync(sessionBaseDir), false);
  assert.deepEqual(store.list(), ["work"]);
});

test("T22 posix: user args with spaces and metacharacters reach the spawn unchanged (no shell)", async () => {
  const { store, spawns, deps } = setup("linux");
  store.create("work");
  assert.equal(await runCli(["work", "hello world", "a&b", 'q"'], deps), 0);
  assert.equal(spawns[0].shell, false);
  assert.deepEqual(spawns[0].args.slice(2), ["hello world", "a&b", 'q"']);
});

test("T22: a refused base dir is reported once and creates no default profile", { skip: process.platform === "win32" }, async () => {
  const { store, liveAuthPath, err, spawns, deps, sessionBaseDir } = setup();
  store.create("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "live" } });
  mkdirSync(sessionBaseDir, { mode: 0o700 });
  chmodSync(sessionBaseDir, 0o777);
  assert.equal(await runCli(["work"], deps), 1);
  assert.deepEqual(err, [`gentle-accounts: refusing to use ${sessionBaseDir}: it is group or world writable`]);
  assert.deepEqual(spawns, []);
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(store.current(), null);
});

test("T22: a corrupt profile auth.json at launch is reported with the gentle-accounts: prefix", async () => {
  const { store, err, deps } = setup();
  store.create("work");
  writeFileSync(store.authPath("work"), "{bad");
  assert.equal(await runCli(["work"], deps), 1);
  assert.equal(err.length, 1);
  assert.match(err[0], /^gentle-accounts: Cannot parse .*auth\.json/);
});

test("T22 win32: windowsShellArgs doubles a trailing backslash of a quoted argument and quotes an empty one", () => {
  assert.deepEqual(windowsShellArgs(["C:\\a b\\", "C:\\a b\\\\", "C:\\ab\\", ""]), ['"C:\\a b\\\\"', '"C:\\a b\\\\\\\\"', "C:\\ab\\", '""']);
});
