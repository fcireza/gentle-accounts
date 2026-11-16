import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { readAuthFile, writeAuthFile } from "../src/auth-sync.ts";
import { runCli, type CliDeps, type SpawnCall } from "../src/cli.ts";

function setup(platform: NodeJS.Platform = "linux") {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-profiles-cli-"));
  const store = new ProfileStore(agentDir);
  const liveAuthPath = join(agentDir, "auth.json");
  const out: string[] = [];
  const err: string[] = [];
  const spawns: SpawnCall[] = [];
  const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
  const deps: CliDeps = {
    store,
    liveAuthPath,
    env,
    platform,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    spawn: (call) => {
      spawns.push(call);
      return 0;
    },
  };
  return { store, liveAuthPath, env, out, err, spawns, deps };
}

test("gentle-profiles <name> syncs credentials, sets CLAUDE_CONFIG_DIR and execs gentle-shell with the rest", () => {
  const { store, liveAuthPath, out, err, spawns, deps } = setup();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "w" }, other: 1 });
  writeAuthFile(store.authPath("personal"), { "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 } });

  const code = runCli(["personal", "--isolated"], deps);

  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, []);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "gentle-shell");
  assert.deepEqual(spawns[0].args, ["--isolated"]);
  assert.equal(spawns[0].env.CLAUDE_CONFIG_DIR, store.claudeDir("personal"));
  assert.equal(spawns[0].env.PATH, "/usr/bin");
  assert.equal(spawns[0].shell, false);
  assert.equal(store.current(), "personal");
  assert.deepEqual(readAuthFile(liveAuthPath), { "openai-codex": { type: "oauth", access: "p", refresh: "p", expires: 1 }, other: 1 });
  assert.deepEqual(readAuthFile(store.authPath("work")), { anthropic: { type: "api_key", key: "w" } });
});

test("first launch with no active profile keeps the live login in a default profile", () => {
  const { store, liveAuthPath, spawns, deps } = setup();
  store.create("work");
  writeAuthFile(liveAuthPath, { anthropic: { type: "api_key", key: "live" } });
  assert.equal(runCli(["work"], deps), 0);
  assert.equal(spawns.length, 1);
  assert.deepEqual(store.list(), ["default", "work"]);
  assert.equal(store.current(), "work");
  assert.deepEqual(readAuthFile(store.authPath("default")), { anthropic: { type: "api_key", key: "live" } });
  assert.deepEqual(readAuthFile(liveAuthPath), {});
});

test("launching the active profile still execs gentle-shell and returns its exit code", () => {
  const { store, spawns, deps } = setup();
  store.create("work");
  store.setCurrent("work");
  deps.spawn = (call) => {
    spawns.push(call);
    return 3;
  };
  assert.equal(runCli(["work"], deps), 3);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].env.CLAUDE_CONFIG_DIR, store.claudeDir("work"));
});

test("on Windows gentle-shell is spawned through the shell so .cmd shims resolve", () => {
  const { store, spawns, deps } = setup("win32");
  store.create("work");
  assert.equal(runCli(["work"], deps), 0);
  assert.equal(spawns[0].shell, true);
});

test("a missing profile prints the exact message, exits 1 and spawns nothing", () => {
  const { store, err, spawns, deps } = setup();
  store.create("work");
  store.setCurrent("work");
  assert.equal(runCli(["ghost"], deps), 1);
  assert.deepEqual(err, ['Profile "ghost" does not exist. Create it with: gentle-profiles create <name>']);
  assert.deepEqual(spawns, []);
  assert.equal(store.current(), "work");
});

test("list, create and current mirror the slash command without a UI", () => {
  const { store, out, err, deps } = setup();
  assert.equal(runCli(["list"], deps), 0);
  assert.deepEqual(out, ["No profiles. Create one with: gentle-profiles create <name>"]);
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
  assert.match(out.join("\n"), /gentle-profiles <name> \[gentle-shell args\.\.\.\]/);
  assert.equal(runCli([], deps), 1);
  assert.match(err.join("\n"), /gentle-profiles <name>/);
});
