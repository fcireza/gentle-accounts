import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, validateProfileName, INVALID_NAME_MESSAGE, writeFileAtomic } from "../src/store.ts";

function tempStore(): { store: ProfileStore; agentDir: string } {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-"));
  return { store: new ProfileStore(agentDir), agentDir };
}

test("validateProfileName accepts lowercase names with digits, dash and underscore", () => {
  for (const name of ["work", "personal", "a", "w0rk-2_x", "a".repeat(32)]) {
    assert.equal(validateProfileName(name), null, name);
  }
});

test("validateProfileName rejects invalid names with the exact message", () => {
  for (const name of ["", "Work", "-work", "wo rk", "a".repeat(33), "../x", "wörk"]) {
    assert.equal(validateProfileName(name), INVALID_NAME_MESSAGE(name), JSON.stringify(name));
  }
  assert.equal(
    INVALID_NAME_MESSAGE("Work"),
    'Invalid profile name "Work": use lowercase letters, digits, "-" or "_" (max 32 chars).',
  );
});

test("paths follow the <agentDir>/profiles/<name>/ layout", () => {
  const { store, agentDir } = tempStore();
  assert.equal(store.profilesDir, join(agentDir, "profiles"));
  assert.equal(store.profileDir("work"), join(agentDir, "profiles", "work"));
  assert.equal(store.claudeDir("work"), join(agentDir, "profiles", "work", "claude"));
  assert.equal(store.authPath("work"), join(agentDir, "profiles", "work", "auth.json"));
  assert.equal(store.currentPath, join(agentDir, "profiles", "current"));
});

test("claudeDir honours a claude-dir override file written by create", () => {
  const { store, agentDir } = tempStore();
  store.create("legacy", { claudeDir: join(agentDir, "elsewhere") });
  assert.equal(store.claudeDirPath("legacy"), join(agentDir, "profiles", "legacy", "claude-dir"));
  assert.equal(store.claudeDir("legacy"), join(agentDir, "elsewhere"));
  assert.equal(existsSync(join(agentDir, "profiles", "legacy", "claude")), false);
});

test("list is empty and current is null on a fresh agent dir", () => {
  const { store } = tempStore();
  assert.deepEqual(store.list(), []);
  assert.equal(store.current(), null);
});

test("create makes the profile dir, claude dir and an empty auth.json", () => {
  const { store } = tempStore();
  store.create("work");
  assert.ok(existsSync(store.claudeDir("work")));
  assert.deepEqual(JSON.parse(readFileSync(store.authPath("work"), "utf8")), {});
  assert.deepEqual(store.list(), ["work"]);
  assert.equal(store.exists("work"), true);
  assert.equal(store.exists("personal"), false);
});

test("create rejects an invalid name and an existing profile without changing anything", () => {
  const { store } = tempStore();
  assert.throws(() => store.create("Work"), { message: INVALID_NAME_MESSAGE("Work") });
  assert.deepEqual(store.list(), []);
  store.create("work");
  assert.throws(() => store.create("work"), { message: 'Profile "work" already exists.' });
  assert.deepEqual(store.list(), ["work"]);
});

test("list is sorted and ignores stray files in the profiles dir", () => {
  const { store } = tempStore();
  store.create("work");
  store.create("personal");
  writeFileSync(join(store.profilesDir, "notes.txt"), "x");
  assert.deepEqual(store.list(), ["personal", "work"]);
});

test("setCurrent writes the current file and current reads it back", () => {
  const { store } = tempStore();
  store.create("work");
  store.setCurrent("work");
  assert.equal(readFileSync(store.currentPath, "utf8"), "work\n");
  assert.equal(store.current(), "work");
});

test("setCurrent rejects a profile that does not exist", () => {
  const { store } = tempStore();
  assert.throws(() => store.setCurrent("ghost"), { message: 'Profile "ghost" does not exist.' });
  assert.equal(store.current(), null);
});

test("current returns null when the current file names a deleted or invalid profile", () => {
  const { store } = tempStore();
  mkdirSync(store.profilesDir, { recursive: true });
  writeFileSync(store.currentPath, "ghost\n");
  assert.equal(store.current(), null);
  writeFileSync(store.currentPath, "../etc\n");
  assert.equal(store.current(), null);
});

test("delete removes the profile dir, refuses the active one and a missing one", () => {
  const { store } = tempStore();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  assert.throws(() => store.delete("work"), {
    message: 'Cannot delete the active profile "work". Switch to another profile first.',
  });
  assert.ok(existsSync(store.profileDir("work")));
  assert.throws(() => store.delete("ghost"), { message: 'Profile "ghost" does not exist.' });
  store.delete("personal");
  assert.equal(existsSync(store.profileDir("personal")), false);
  assert.deepEqual(store.list(), ["work"]);
});

test("S16: a profile created with claudeDefault writes the marker and leaves CLAUDE_CONFIG_DIR unset", () => {
  const { store } = tempStore();
  store.create("default", { claudeDefault: true });
  assert.ok(existsSync(join(store.profileDir("default"), "claude-default")));
  assert.equal(existsSync(store.claudeDirPath("default")), false);
  assert.equal(existsSync(join(store.profileDir("default"), "claude")), false);
  assert.equal(store.claudeConfigEnv("default"), undefined);
});

test("S16: a legacy claude-dir equal to <home>/.claude is treated as the system default", () => {
  const { store, agentDir } = tempStore();
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  try {
    store.create("default", { claudeDir: join(agentDir, ".claude") });
    assert.equal(store.claudeConfigEnv("default"), undefined);
    store.create("custom", { claudeDir: join(agentDir, ".claude-custom") });
    assert.equal(store.claudeConfigEnv("custom"), join(agentDir, ".claude-custom"));
    store.create("work");
    assert.equal(store.claudeConfigEnv("work"), join(store.profileDir("work"), "claude"));
    assert.equal(store.claudeDir("work"), join(store.profileDir("work"), "claude"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("S27: startup profile get/set/clear under <profilesDir>/startup", () => {
  const { store, agentDir } = tempStore();
  assert.equal(store.startupPath, join(agentDir, "profiles", "startup"));
  assert.equal(store.startup(), null);
  store.create("work");
  store.setStartup("work");
  assert.equal(readFileSync(store.startupPath, "utf8"), "work\n");
  assert.equal(store.startup(), "work");
  if (process.platform !== "win32") assert.equal(statSync(store.startupPath).mode & 0o777, 0o600);
  store.clearStartup();
  assert.equal(existsSync(store.startupPath), false);
  assert.equal(store.startup(), null);
  store.clearStartup(); // absent: no error
});

test("S27: setStartup refuses unknown profiles and leaves no file", () => {
  const { store } = tempStore();
  assert.throws(() => store.setStartup("ghost"), { message: 'Profile "ghost" does not exist.' });
  assert.equal(existsSync(store.startupPath), false);
});

test("S27: startup() is null for empty, invalid or deleted-profile content", () => {
  const { store } = tempStore();
  store.create("work");
  for (const content of ["", "\n", "Bad Name\n", "../x\n", "ghost\n"]) {
    writeFileSync(store.startupPath, content);
    assert.equal(store.startup(), null, JSON.stringify(content));
  }
});

test("S27: delete refuses the startup profile after the missing and active checks", () => {
  const { store } = tempStore();
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  store.setStartup("work");
  assert.throws(() => store.delete("ghost"), { message: 'Profile "ghost" does not exist.' });
  assert.throws(() => store.delete("work"), { message: 'Cannot delete the active profile "work". Switch to another profile first.' });
  store.setCurrent("personal");
  assert.throws(() => store.delete("work"), {
    message: 'Cannot delete the startup profile "work". Set another one or clear it with "startup last" first.',
  });
  assert.deepEqual(store.list(), ["personal", "work"]);
  store.clearStartup();
  store.delete("work");
  assert.deepEqual(store.list(), ["personal"]);
});

test("S27: startupRaw returns the trimmed stored name even when the profile is missing", () => {
  const { store } = tempStore();
  assert.equal(store.startupRaw(), null);
  mkdirSync(store.profilesDir, { recursive: true });
  writeFileSync(store.startupPath, "  ghost\n");
  assert.equal(store.startupRaw(), "ghost");
  assert.equal(store.startup(), null);
  writeFileSync(store.startupPath, "\n");
  assert.equal(store.startupRaw(), null);
});

test("S30: currentPath option keeps the current profile outside profiles/ while the rest stays shared", () => {
  const { agentDir } = tempStore();
  const sessionCurrent = join(agentDir, "session-current");
  const global = new ProfileStore(agentDir);
  global.create("work");
  global.create("personal");
  global.setCurrent("work");
  const session = new ProfileStore(agentDir, { currentPath: sessionCurrent });
  assert.equal(session.currentPath, sessionCurrent);
  assert.equal(session.current(), null);
  session.setCurrent("personal");
  assert.equal(readFileSync(sessionCurrent, "utf8"), "personal\n");
  assert.equal(global.current(), "work");
  assert.equal(session.authPath("work"), global.authPath("work"));
  assert.equal(session.claudeDir("work"), global.claudeDir("work"));
  assert.equal(session.startupPath, global.startupPath);
});

test("S30: current and startup writes use a unique temp name (a stale <path>.tmp never collides)", () => {
  const { store } = tempStore();
  store.create("work");
  mkdirSync(`${store.currentPath}.tmp`);
  mkdirSync(`${store.startupPath}.tmp`);
  store.setCurrent("work");
  store.setStartup("work");
  assert.equal(readFileSync(store.currentPath, "utf8"), "work\n");
  assert.equal(readFileSync(store.startupPath, "utf8"), "work\n");
  assert.deepEqual(readdirSync(store.profilesDir).filter((n) => n.endsWith(".tmp") && !statSync(join(store.profilesDir, n)).isDirectory()), []);
});

test("S30: writeFileAtomic writes with mode 0600 through <path>.<pid>.<random>.tmp and leaves no temp", () => {
  const { agentDir } = tempStore();
  const p = join(agentDir, "f");
  writeFileAtomic(p, "a\n");
  writeFileAtomic(p, "b\n");
  assert.equal(readFileSync(p, "utf8"), "b\n");
  if (process.platform !== "win32") assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(agentDir), ["f"]);
});

test("S30: create reports an existing profile created by another session in between", () => {
  const { agentDir } = tempStore();
  const other = new ProfileStore(agentDir);
  // This session checked exists() before the other one finished creating the profile.
  let first = true;
  const racing = new ProfileStore(agentDir);
  racing.exists = (name: string) => {
    if (first) {
      first = false;
      other.create(name);
      writeFileSync(other.authPath(name), '{"anthropic":{"type":"api_key","key":"theirs"}}\n');
      return false;
    }
    return ProfileStore.prototype.exists.call(racing, name);
  };
  assert.throws(() => racing.create("default"), /Profile "default" already exists\./);
  assert.equal(readFileSync(other.authPath("default"), "utf8"), '{"anthropic":{"type":"api_key","key":"theirs"}}\n');
});

test("T22: create refuses subcommand names with the reserved-word message and creates nothing", () => {
  const store = new ProfileStore(mkdtempSync(join(tmpdir(), "gentle-accounts-store-")));
  for (const name of ["menu", "list", "current", "create", "delete", "login", "startup", "email", "help"]) {
    assert.throws(() => store.create(name), { message: `"${name}" is a reserved word (it is a subcommand). Pick another profile name.` });
    assert.equal(existsSync(store.profileDir(name)), false);
  }
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.create("Bad Name"), { message: INVALID_NAME_MESSAGE("Bad Name") });
  store.create("work");
  assert.deepEqual(store.list(), ["work"]);
});

test("T22: an existing profile with a reserved name keeps working", () => {
  const store = new ProfileStore(mkdtempSync(join(tmpdir(), "gentle-accounts-store-")));
  mkdirSync(store.profileDir("menu"), { recursive: true });
  writeFileSync(store.authPath("menu"), "{}\n");
  assert.equal(store.exists("menu"), true);
  assert.deepEqual(store.list(), ["menu"]);
  store.setCurrent("menu");
  assert.equal(store.current(), "menu");
});
