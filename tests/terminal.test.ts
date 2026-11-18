import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { openInNewTab, planNewTab, posixScript, powershellScript, type TabCommand } from "../src/terminal.ts";

const CWD = "/tmp/my proj/it's";
const DIR = "/tmp/a b/it's dir";
const login: TabCommand = { argv: ["claude", "auth", "login"], env: { CLAUDE_CONFIG_DIR: DIR } };
const unset: TabCommand = { argv: ["claude", "auth", "login"], env: { CLAUDE_CONFIG_DIR: null } };

test("S32 posixScript quotes the cwd, env values and argv; null unsets", () => {
  assert.equal(posixScript(CWD, login), `cd -- '/tmp/my proj/it'\\''s' && env CLAUDE_CONFIG_DIR='/tmp/a b/it'\\''s dir' 'claude' 'auth' 'login'`);
  assert.equal(posixScript(CWD, unset), `cd -- '/tmp/my proj/it'\\''s' && env -u CLAUDE_CONFIG_DIR 'claude' 'auth' 'login'`);
});

test("S32 posixScript survives a real sh round trip with spaces and a single quote", { skip: process.platform === "win32" }, () => {
  // A harmless probe command that echoes the env value and the args.
  const probe = posixScript("/", { argv: ["sh", "-c", 'printf "%s|%s|%s" "$X_GA" "$0" "$1"', "a b", "it's"], env: { X_GA: "v 'q'" } });
  assert.equal(execFileSync("sh", ["-c", probe], { encoding: "utf8" }), "v 'q'|a b|it's");
});

test("S32 powershellScript uses literal single-quoted strings", () => {
  assert.equal(powershellScript("C:\\my proj\\it's", { argv: ["claude", "auth", "login"], env: { CLAUDE_CONFIG_DIR: "C:\\a b\\it's" } }),
    "Set-Location -LiteralPath 'C:\\my proj\\it''s'\n$env:CLAUDE_CONFIG_DIR = 'C:\\a b\\it''s'\n& 'claude' 'auth' 'login'");
  assert.equal(powershellScript("C:\\p", unset), "Set-Location -LiteralPath 'C:\\p'\nRemove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue\n& 'claude' 'auth' 'login'");
});

test("S32 macOS: Terminal.app and iTerm2 by TERM_PROGRAM, script passed as an argv item (no AppleScript interpolation)", () => {
  const script = posixScript(CWD, login);
  const apple = planNewTab({ TERM_PROGRAM: "Apple_Terminal" }, "darwin", CWD, login);
  assert.equal(apple?.file, "osascript");
  assert.equal(apple?.args.at(-1), script);
  assert.equal(apple?.args.at(-2), "--");
  assert.ok(apple?.args.join(" ").includes('application "Terminal"'));
  assert.ok(!apple?.args.slice(0, -1).some((a) => a.includes("it'")), "the paths only travel as argv");
  const iterm = planNewTab({ TERM_PROGRAM: "iTerm.app" }, "darwin", CWD, login);
  assert.equal(iterm?.file, "osascript");
  assert.ok(iterm?.args.join(" ").includes('application "iTerm2"'));
  assert.equal(iterm?.args.at(-1), script);
  assert.equal(planNewTab({ TERM_PROGRAM: "vscode" }, "darwin", CWD, login), null);
  assert.equal(planNewTab({}, "darwin", CWD, login), null);
});

test("S32 macOS: tmux wins over the terminal app", () => {
  const plan = planNewTab({ TMUX: "/tmp/tmux-1/default,1,0", TERM_PROGRAM: "iTerm.app" }, "darwin", CWD, login);
  assert.equal(plan?.file, "tmux");
});

test("S32 Windows: wt -w 0 nt with an encoded PowerShell command", () => {
  const plan = planNewTab({}, "win32", "C:\\my proj", { argv: ["gentle-accounts", "work"], env: {} });
  assert.equal(plan?.file, "wt");
  assert.deepEqual(plan?.args.slice(0, 6), ["-w", "0", "nt", "powershell", "-NoExit", "-EncodedCommand"]);
  const decoded = Buffer.from(plan!.args[6], "base64").toString("utf16le");
  assert.equal(decoded, "Set-Location -LiteralPath 'C:\\my proj'\n& 'gentle-accounts' 'work'");
  assert.ok(!plan!.args.some((a) => a.includes(";")), "no wt command separator");
});

const plan = (...a: Parameters<typeof planNewTab>) => { const p = planNewTab(...a); return p && { file: p.file, args: p.args }; };

test("S32 Linux: detection order tmux, gnome-terminal, konsole, kitty, wezterm; argv only", () => {
  const all = { TMUX: "x", GNOME_TERMINAL_SCREEN: "x", KONSOLE_VERSION: "1", KITTY_WINDOW_ID: "1", WEZTERM_PANE: "1" };
  const envTail = ["env", `CLAUDE_CONFIG_DIR=${DIR}`, "claude", "auth", "login"];
  assert.deepEqual(plan(all, "linux", CWD, login), { file: "tmux", args: ["new-window", "-c", CWD, ...envTail] });
  const { TMUX: _t, ...g } = all;
  assert.deepEqual(plan(g, "linux", CWD, login), { file: "gnome-terminal", args: ["--tab", `--working-directory=${CWD}`, "--", ...envTail] });
  const { GNOME_TERMINAL_SCREEN: _g, ...k } = g;
  assert.deepEqual(plan(k, "linux", CWD, login), { file: "konsole", args: ["--new-tab", "--workdir", CWD, "-e", ...envTail] });
  const { KONSOLE_VERSION: _k, ...ki } = k;
  assert.deepEqual(plan(ki, "linux", CWD, login), { file: "kitty", args: ["@", "launch", "--type=tab", `--cwd=${CWD}`, ...envTail] });
  const { KITTY_WINDOW_ID: _ki, ...w } = ki;
  assert.deepEqual(plan(w, "linux", CWD, login), { file: "wezterm", args: ["cli", "spawn", "--cwd", CWD, "--", ...envTail] });
  assert.equal(plan({}, "linux", CWD, login), null);
  assert.deepEqual(plan({ GNOME_TERMINAL_SERVICE: ":1.2" }, "linux", CWD, unset)?.args.slice(-6), ["env", "-u", "CLAUDE_CONFIG_DIR", "claude", "auth", "login"]);
  assert.deepEqual(plan({ TERM_PROGRAM: "WezTerm" }, "linux", CWD, login)?.file, "wezterm");
});

function fakeSpawn(outcome: { code?: number; error?: Error; throws?: Error }) {
  const calls: { file: string; args: string[]; opts: unknown }[] = [];
  const spawn = (file: string, args: readonly string[], opts: unknown) => {
    calls.push({ file, args: [...args], opts });
    if (outcome.throws) throw outcome.throws;
    const child = new EventEmitter() as EventEmitter & { unref?: () => void };
    child.unref = () => {};
    setImmediate(() => (outcome.error ? child.emit("error", outcome.error) : child.emit("close", outcome.code ?? 0, null)));
    return child as never;
  };
  return { spawn, calls };
}

test("S32 openInNewTab runs the plan with the injected spawn and reports ok", async () => {
  const f = fakeSpawn({ code: 0 });
  const r = await openInNewTab({ env: { TMUX: "x" }, platform: "linux", cwd: CWD, command: login, spawn: f.spawn });
  assert.deepEqual(r, { ok: true, terminal: "tmux" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].file, "tmux");
  assert.equal((f.calls[0].opts as { shell?: boolean }).shell, undefined, "never through a shell");
});

test("S32 openInNewTab reports not available: no plan, spawn error, throw, non-zero exit", async () => {
  const none = fakeSpawn({});
  assert.deepEqual(await openInNewTab({ env: {}, platform: "linux", cwd: CWD, command: login, spawn: none.spawn }), { ok: false });
  assert.equal(none.calls.length, 0);
  for (const outcome of [{ error: new Error("spawn ENOENT") }, { throws: new Error("boom") }, { code: 1 }]) {
    const f = fakeSpawn(outcome);
    const r = await openInNewTab({ env: { KITTY_WINDOW_ID: "1" }, platform: "linux", cwd: CWD, command: login, spawn: f.spawn });
    assert.equal(r.ok, false, JSON.stringify(outcome));
  }
});
