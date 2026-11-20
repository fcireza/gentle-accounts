import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getShowEmail, readSettings, runEmailCommand, setShowEmail, settingsPath } from "../src/settings.ts";

function tmp() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-settings-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  return { agentDir, path: settingsPath(agentDir) };
}

test("S29: settings path is <agentDir>/profiles/settings.json", () => {
  const { agentDir, path } = tmp();
  assert.equal(path, join(agentDir, "profiles", "settings.json"));
});

test("S29: a missing file means hidden and is not created on read", () => {
  const { path } = tmp();
  assert.deepEqual(readSettings(path), {});
  assert.equal(getShowEmail(path), false);
  assert.equal(existsSync(path), false);
});

test("S29: empty, invalid, array or non-object JSON means hidden and the file is untouched", () => {
  const { agentDir, path } = tmp();
  mkdirSync(join(agentDir, "profiles"));
  for (const content of ["", "{bad", "[true]", "true", "null", '"x"']) {
    writeFileSync(path, content);
    assert.deepEqual(readSettings(path), {});
    assert.equal(getShowEmail(path), false);
    assert.equal(readFileSync(path, "utf8"), content);
  }
});

test("S29: only a literal true counts as shown", () => {
  const { agentDir, path } = tmp();
  mkdirSync(join(agentDir, "profiles"));
  for (const value of ['"true"', "1", "\"yes\"", "false", "null"]) {
    writeFileSync(path, `{"showEmail": ${value}}`);
    assert.equal(getShowEmail(path), false, value);
  }
  writeFileSync(path, '{"showEmail": true}');
  assert.equal(getShowEmail(path), true);
});

test("S29: set creates the folder, preserves other keys, writes atomically with mode 0600", () => {
  const { agentDir, path } = tmp();
  setShowEmail(path, true);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { showEmail: true });
  writeFileSync(path, JSON.stringify({ other: { a: 1 }, showEmail: true }));
  setShowEmail(path, false);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { other: { a: 1 }, showEmail: false });
  assert.deepEqual(readdirSync(join(agentDir, "profiles")), ["settings.json"]);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("S29: runEmailCommand shows, sets and rejects with the exact messages", () => {
  const { path } = tmp();
  assert.deepEqual(runEmailCommand("", path, "/gentle:accounts"), { message: "Email display: hidden (not shown in the status bar)", type: "info", changed: false });
  assert.equal(existsSync(path), false);
  assert.deepEqual(runEmailCommand("show", path, "/gentle:accounts"), { message: "Email display set to shown. The status bar shows the full email.", type: "info", changed: true });
  assert.deepEqual(runEmailCommand("", path, "/gentle:accounts"), { message: "Email display: shown (full email in the status bar)", type: "info", changed: false });
  assert.deepEqual(runEmailCommand("hide", path, "/gentle:accounts"), { message: "Email display set to hidden. The status bar does not show the email.", type: "info", changed: true });
  assert.equal(getShowEmail(path), false);
  const before = readFileSync(path, "utf8");
  assert.deepEqual(runEmailCommand("maybe", path, "/gentle:accounts"), { message: "Usage: /gentle:accounts email [show|hide]", type: "warning", changed: false });
  assert.deepEqual(runEmailCommand("on", path, "gentle-accounts"), { message: "Usage: gentle-accounts email [show|hide]", type: "warning", changed: false });
  assert.equal(readFileSync(path, "utf8"), before);
});

test("S30: setShowEmail uses a unique temp name, so a stale settings.json.tmp never collides", () => {
  const { agentDir, path } = tmp();
  mkdirSync(join(agentDir, "profiles"));
  mkdirSync(`${path}.tmp`);
  setShowEmail(path, true);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { showEmail: true });
  assert.deepEqual(readdirSync(join(agentDir, "profiles")).sort(), ["settings.json", "settings.json.tmp"]);
});

test("T22: runEmailCommand rejects extra words after a valid mode with the usage and writes nothing", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gentle-accounts-settings-")), "settings.json");
  assert.deepEqual(runEmailCommand("show extra words", path, "/gentle:accounts"), { message: "Usage: /gentle:accounts email [show|hide]", type: "warning", changed: false });
  assert.deepEqual(runEmailCommand("hide x", path, "gentle-accounts"), { message: "Usage: gentle-accounts email [show|hide]", type: "warning", changed: false });
  assert.equal(existsSync(path), false);
  assert.deepEqual(runEmailCommand("show", path, "/gentle:accounts"), { message: "Email display set to shown. The status bar shows the full email.", type: "info", changed: true });
});

test("T22: an unwritable settings location returns an error message instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gentle-accounts-settings-"));
  writeFileSync(join(dir, "blocker"), "");
  const path = join(dir, "blocker", "settings.json");
  const result = runEmailCommand("show", path, "/gentle:accounts");
  // The code depends on the platform (EEXIST on macOS, ENOTDIR on Linux).
  assert.match(result.message, /^Could not save the email display setting \(E[A-Z]+\)\.$/);
  assert.deepEqual({ type: result.type, changed: result.changed }, { type: "error", changed: false });
  assert.doesNotMatch(result.message, /\n|at /);
});
