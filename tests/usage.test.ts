import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, RESERVED_NAMES } from "../src/store.ts";
import { renameProfile } from "../src/rename.ts";
import { getUsageBox, runUsageCommand, setUsageBox, settingsPath } from "../src/settings.ts";
import { captureUsage, parseUsageHeaders, readUsage, recordUsage, usagePath, windowLabel, formatReset } from "../src/usage.ts";

function tmp() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("home");
  store.setCurrent("work");
  return { agentDir, store, settings: settingsPath(agentDir) };
}

const NOW = 1_700_000_000_000;
const ANTHROPIC = {
  "anthropic-ratelimit-unified-5h-utilization": "0.42",
  "anthropic-ratelimit-unified-5h-reset": "1700003600",
  "anthropic-ratelimit-unified-7d-utilization": "0.1",
  "anthropic-ratelimit-unified-7d-reset": "1700500000",
  authorization: "Bearer SECRET-TOKEN",
};
const CODEX = {
  "x-codex-primary-used-percent": "12.5",
  "x-codex-primary-window-minutes": "300",
  "x-codex-primary-reset-at": "1700003600",
  "x-codex-secondary-used-percent": "30",
  "x-codex-secondary-window-minutes": "10080",
  "x-codex-secondary-reset-at": "1700500000",
};

test("S1 parse: Anthropic headers are fractions with reset in epoch seconds", () => {
  const parsed = parseUsageHeaders(ANTHROPIC, NOW)!;
  assert.equal(parsed.provider, "anthropic");
  assert.equal(parsed.fetchedAt, NOW);
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].label, "5h");
  assert.ok(Math.abs(parsed.windows[0].usedPercent - 42) < 1e-9);
  assert.equal(parsed.windows[0].resetAt, 1_700_003_600_000);
  assert.equal(parsed.windows[1].label, "week");
  assert.ok(Math.abs(parsed.windows[1].usedPercent - 10) < 1e-9);
});

test("S1 parse: Codex headers are percents with a window in minutes", () => {
  const parsed = parseUsageHeaders(CODEX, NOW)!;
  assert.equal(parsed.provider, "openai-codex");
  assert.deepEqual(parsed.windows, [
    { label: "5h", usedPercent: 12.5, resetAt: 1_700_003_600_000 },
    { label: "week", usedPercent: 30, resetAt: 1_700_500_000_000 },
  ]);
});

test("S1 parse: a missing reset is null, a Codex window without minutes is dropped, nothing useful is undefined", () => {
  const one = parseUsageHeaders({ "anthropic-ratelimit-unified-5h-utilization": "0.5" }, NOW)!;
  assert.deepEqual(one.windows, [{ label: "5h", usedPercent: 50, resetAt: null }]);
  assert.equal(parseUsageHeaders({ "x-codex-primary-used-percent": "5" }, NOW), undefined);
  assert.equal(parseUsageHeaders({ "content-type": "json" }, NOW), undefined);
  assert.equal(parseUsageHeaders({ "anthropic-ratelimit-unified-5h-utilization": "abc" }, NOW), undefined);
});

test("S1 parse: header names are matched case-insensitively", () => {
  const parsed = parseUsageHeaders({ "Anthropic-RateLimit-Unified-5h-Utilization": "0.25" }, NOW)!;
  assert.equal(parsed.windows[0].usedPercent, 25);
});

test("S1 labels: windowLabel and formatReset copy Gentle Shell's semantics", () => {
  assert.equal(windowLabel(604_800), "week");
  assert.equal(windowLabel(18_000), "5h");
  assert.equal(windowLabel(172_800), "2d");
  assert.equal(windowLabel(1800), "30m");
  assert.equal(formatReset(null, NOW), "");
  assert.equal(formatReset(NOW - 1, NOW), "resets now");
  assert.equal(formatReset(NOW + 90_000, NOW), "resets in 2m");
  assert.equal(formatReset(NOW + 3_660_000, NOW), "resets in 1h 1m");
  assert.equal(formatReset(NOW + 90_000_000, NOW), "resets in 1d 1h");
});

test("S1 record: the snapshot lives in the profile folder as usage.json (0600), only numbers and labels", () => {
  const { store } = tmp();
  const parsed = parseUsageHeaders(ANTHROPIC, NOW)!;
  recordUsage(store, "work", parsed);
  const path = usagePath(store, "work");
  assert.equal(path, join(store.profileDir("work"), "usage.json"));
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  const raw = readFileSync(path, "utf8");
  assert.doesNotMatch(raw, /SECRET|authorization|Bearer|anthropic-ratelimit/i);
  assert.deepEqual(readUsage(store, "work"), [parsed]);
  assert.deepEqual(readUsage(store, "home"), []);
});

test("S1 record: a new snapshot of the same provider replaces the old one; other providers are kept", () => {
  const { store } = tmp();
  recordUsage(store, "work", parseUsageHeaders(ANTHROPIC, NOW)!);
  recordUsage(store, "work", parseUsageHeaders(CODEX, NOW + 1)!);
  recordUsage(store, "work", parseUsageHeaders({ "anthropic-ratelimit-unified-5h-utilization": "0.9" }, NOW + 2)!);
  const all = readUsage(store, "work");
  assert.deepEqual(all.map((s) => s.provider).sort(), ["anthropic", "openai-codex"]);
  assert.equal(all.find((s) => s.provider === "anthropic")!.windows[0].usedPercent, 90);
});

test("S1 read: a missing, corrupt or malformed usage.json reads as empty and never throws", () => {
  const { store } = tmp();
  const path = usagePath(store, "work");
  for (const content of ["", "{bad", "[1]", "null", '{"anthropic":{"provider":"anthropic","windows":"x","fetchedAt":1}}', '{"anthropic":5}']) {
    writeFileSync(path, content);
    assert.deepEqual(readUsage(store, "work"), [], content);
  }
  assert.deepEqual(readUsage(store, "nope"), []);
  // A corrupt file does not block a new snapshot.
  writeFileSync(path, "{bad");
  recordUsage(store, "work", parseUsageHeaders(ANTHROPIC, NOW)!);
  assert.equal(readUsage(store, "work").length, 1);
});

test("S1 record: a profile that does not exist is not created by a snapshot", () => {
  const { store } = tmp();
  recordUsage(store, "ghost", parseUsageHeaders(ANTHROPIC, NOW)!);
  assert.equal(existsSync(store.profileDir("ghost")), false);
});

test("S1 capture: records under the current profile, under the serving provider when given", () => {
  const { store, settings } = tmp();
  assert.equal(captureUsage({ store, settingsFile: settings, headers: ANTHROPIC, servedProvider: "claude", now: NOW }), true);
  assert.deepEqual(readUsage(store, "work").map((s) => s.provider), ["claude"]);
  assert.deepEqual(readUsage(store, "home"), []);
  captureUsage({ store, settingsFile: settings, headers: CODEX, now: NOW });
  assert.deepEqual(readUsage(store, "work").map((s) => s.provider).sort(), ["claude", "openai-codex"]);
});

test("S1 capture: headers without usage, or without a current profile, record nothing", () => {
  const { store, settings, agentDir } = tmp();
  assert.equal(captureUsage({ store, settingsFile: settings, headers: { a: "b" }, now: NOW }), false);
  assert.equal(existsSync(usagePath(store, "work")), false);
  const bare = new ProfileStore(mkdtempSync(join(tmpdir(), "gentle-accounts-usage-")));
  after(() => rmSync(bare.agentDir, { recursive: true, force: true }));
  assert.equal(captureUsage({ store: bare, settingsFile: settingsPath(bare.agentDir), headers: ANTHROPIC, now: NOW }), false);
  assert.ok(agentDir);
});

test("S1 capture: never throws when the profile folder cannot be written", () => {
  const { store, settings } = tmp();
  mkdirSync(usagePath(store, "work")); // a directory where the file should go
  assert.equal(captureUsage({ store, settingsFile: settings, headers: ANTHROPIC, now: NOW }), false);
});

test("S3 capture: with the box disabled nothing is recorded", () => {
  const { store, settings } = tmp();
  setUsageBox(settings, false);
  assert.equal(captureUsage({ store, settingsFile: settings, headers: ANTHROPIC, now: NOW }), false);
  assert.equal(existsSync(usagePath(store, "work")), false);
});

test("S1 profiles: usage.json moves with a rename and disappears with a delete", () => {
  const { store, agentDir } = tmp();
  recordUsage(store, "home", parseUsageHeaders(ANTHROPIC, NOW)!);
  const result = renameProfile(store, "home", "house", { baseDir: join(agentDir, "homes") });
  assert.equal(result.ok, true, result.message);
  assert.equal(existsSync(usagePath(store, "home")), false);
  assert.equal(readUsage(store, "house").length, 1);
  store.delete("house");
  assert.equal(existsSync(store.profileDir("house")), false);
  assert.deepEqual(readUsage(store, "house"), []);
});

test("S3 settings: usageBox is enabled by default and only a literal false disables it", () => {
  const { agentDir, settings } = tmp();
  assert.equal(getUsageBox(settings), true);
  mkdirSync(join(agentDir, "profiles"), { recursive: true });
  for (const content of ["", "{bad", '{"usageBox":"false"}', '{"usageBox":0}', '{"usageBox":null}', '{"usageBox":true}']) {
    writeFileSync(settings, content);
    assert.equal(getUsageBox(settings), true, content);
  }
  writeFileSync(settings, '{"usageBox":false}');
  assert.equal(getUsageBox(settings), false);
});

test("S3 settings: setUsageBox keeps other keys and writes atomically", () => {
  const { settings } = tmp();
  writeFileSync(settings, '{"showEmail":true}');
  setUsageBox(settings, false);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), { showEmail: true, usageBox: false });
  setUsageBox(settings, true);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), { showEmail: true, usageBox: true });
});

test("S3 command: on, off, status and usage errors have fixed messages", () => {
  const { settings } = tmp();
  assert.deepEqual(runUsageCommand("", settings, "gentle-accounts"), { message: "Account usage box: enabled", type: "info", changed: false });
  assert.deepEqual(runUsageCommand("off", settings, "gentle-accounts"), {
    message: "Account usage box disabled. The native Gentle Shell usage is unchanged.",
    type: "info",
    changed: true,
  });
  assert.equal(getUsageBox(settings), false);
  assert.equal(runUsageCommand("", settings, "gentle-accounts").message, "Account usage box: disabled");
  assert.deepEqual(runUsageCommand("on", settings, "gentle-accounts"), { message: "Account usage box enabled.", type: "info", changed: true });
  assert.equal(getUsageBox(settings), true);
  const bad = runUsageCommand("maybe", settings, "/gentle:accounts");
  assert.deepEqual(bad, { message: "Usage: /gentle:accounts usage [on|off]", type: "warning", changed: false });
  assert.equal(runUsageCommand("off now", settings, "/gentle:accounts").type, "warning");
  assert.equal(getUsageBox(settings), true);
});

test("S3 command: a settings file that cannot be written is an error and changes nothing", () => {
  const { agentDir, settings } = tmp();
  mkdirSync(settings, { recursive: true }); // a directory where the file should go
  const result = runUsageCommand("off", settings, "gentle-accounts");
  assert.equal(result.type, "error");
  assert.equal(result.changed, false);
  assert.match(result.message, /^Could not save the account usage setting \(/);
  assert.ok(agentDir);
});

test("S1 reserved: usage is a subcommand, so it is a reserved profile name", () => {
  assert.ok(RESERVED_NAMES.includes("usage"));
});
