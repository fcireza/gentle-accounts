import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ProfileStore } from "../src/store.ts";
import { resolveContext } from "../src/session-home.ts";
import { settingsPath } from "../src/settings.ts";
import { claudeLoginCommand, loginHint } from "../src/login.ts";
import { COMMAND_FLOWS, switchFlow } from "../src/index.ts";
import { OVERLAY_OPTIONS, loginProviders, menuAvailable, menuOverlayOptions, runAccountsMenu, sidebarRightMargin } from "../src/menu/run.ts";
import type { AccountsMenuPanel, MenuAction } from "../src/menu/panel.ts";
import { identityTheme } from "../src/menu/view.ts";
import type { OpenTabResult, TabCommand } from "../src/terminal.ts";

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-run-"));
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  return { agentDir, store };
}

/** Fake `ctx.ui.custom`: renders each opened panel and returns the next scripted action (or undefined). */
function fakeCtx(script: (MenuAction | undefined)[], o: { idle?: boolean; confirm?: boolean; input?: string; hasUI?: boolean; mode?: string; select?: string; terminal?: unknown } = {}) {
  const frames: string[] = [];
  const notes: { message: string; type?: string }[] = [];
  const options: unknown[] = [];
  let editor: string | undefined;
  let refreshed = 0;
  const selects: { title: string; options: string[] }[] = [];
  const prompts: { title: string; placeholder?: string }[] = [];
  const ctx = {
    hasUI: o.hasUI ?? true,
    mode: o.mode ?? "tui",
    isIdle: () => o.idle ?? true,
    modelRegistry: { refresh: async () => void refreshed++ },
    ui: {
      notify: (message: string, type?: string) => notes.push({ message, type }),
      confirm: async () => o.confirm ?? false,
      input: async (title: string, placeholder?: string) => (prompts.push({ title, placeholder }), o.input),
      select: async (title: string, options: string[]) => (selects.push({ title, options }), o.select),
      setEditorText: (t: string) => void (editor = t),
      custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (a: MenuAction) => void) => AccountsMenuPanel, opts: unknown) => {
        options.push(opts);
        let result: MenuAction | undefined;
        const panel = factory({ requestRender() {}, terminal: o.terminal }, identityTheme, {}, (a) => (result = a));
        frames.push(panel.render(120).join("\n"));
        return script.length ? script.shift() : result;
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, frames, notes, options, editor: () => editor, refreshed: () => refreshed, selects: () => selects, prompts };
}

function deps(agentDir: string, statusLog: string[] = []) {
  return {
    context: () => resolveContext(agentDir),
    refreshStatus: async (_c: unknown, s: ProfileStore) => void statusLog.push(s.current() ?? "none"),
    activeClaude: () => undefined,
    flows: {
      ...COMMAND_FLOWS,
      switchTo: (ctx: ExtensionCommandContext, s: ProfileStore, live: string, target: string, report: (m: string, t?: "info" | "warning" | "error") => void) =>
        switchFlow({ ctx, store: s, liveAuthPath: live, target, report, refreshStatus: async () => void statusLog.push(s.current() ?? "none") }),
    },
    homeDir: agentDir,
    platform: "linux" as NodeJS.Platform,
  };
}

const feedbackOf = (frame: string) => frame.split("\n").filter((l) => !/[╭╰]/.test(l)).map((l) => l.slice(2, -2).trimEnd()).join("\n");

test("S36 run: menu opens as a centered panel of about 60% of the terminal and ends on close", async () => {
  const { agentDir } = setup();
  const c = fakeCtx([{ type: "close" }]);
  await runAccountsMenu(c.ctx, deps(agentDir));
  assert.equal(c.frames.length, 1);
  assert.equal(c.options.length, 1);
  const opened = c.options[0] as { overlay: boolean; overlayOptions: () => ReturnType<typeof menuOverlayOptions> };
  assert.equal(opened.overlay, true);
  assert.equal(typeof opened.overlayOptions, "function", "options are resolved at show time so the margin can follow the sidebar");
  const resolved = opened.overlayOptions();
  assert.deepEqual({ anchor: resolved.anchor, width: resolved.width, minWidth: resolved.minWidth, maxHeight: resolved.maxHeight, margin: resolved.margin }, OVERLAY_OPTIONS);
  assert.deepEqual(OVERLAY_OPTIONS, { anchor: "center", width: "60%", minWidth: 60, maxHeight: "90%", margin: 1 });
  assert.match(c.frames[0], /▸ ● work/);
  const undef = fakeCtx([undefined]);
  await runAccountsMenu(undef.ctx, deps(agentDir));
  assert.equal(undef.frames.length, 1, "no custom result also ends the loop");
});

test("S31 run: switch (idle) uses the command's messages, refreshes the registry and the status", async () => {
  const { agentDir, store } = setup();
  const log: string[] = [];
  const c = fakeCtx([{ type: "switch", profile: "personal", row: 0 }, { type: "switch", profile: "personal", row: 0 }, { type: "close" }]);
  await runAccountsMenu(c.ctx, deps(agentDir, log));
  assert.equal(store.current(), "personal");
  assert.equal(readFileSync(join(agentDir, "profiles", "current"), "utf8"), "personal\n");
  assert.match(feedbackOf(c.frames[1]), new RegExp(`Switched to profile "personal"\\. Claude Code dir: `));
  assert.match(feedbackOf(c.frames[2]), /Already on profile "personal"\./);
  assert.equal(c.refreshed(), 1);
  assert.deepEqual(log, ["personal"]);
  assert.deepEqual(c.notes, [], "feedback stays in the panel");
});

test("S31 run: switch while busy refuses and changes nothing", async () => {
  const { agentDir, store } = setup();
  const c = fakeCtx([{ type: "switch", profile: "personal", row: 0 }, { type: "close" }], { idle: false });
  await runAccountsMenu(c.ctx, deps(agentDir));
  assert.equal(store.current(), "work");
  assert.match(feedbackOf(c.frames[1]), /Wait for the current turn to finish before switching profiles\./);
});

test("S31 run: create valid, invalid, duplicate and cancelled", async () => {
  const { agentDir, store } = setup();
  const ok = fakeCtx([{ type: "create", profile: "work", row: 0 }, { type: "close" }], { input: "side" });
  await runAccountsMenu(ok.ctx, deps(agentDir));
  assert.ok(store.exists("side"));
  assert.match(feedbackOf(ok.frames[1]), /Created profile "side"\. Switch with \/gentle:accounts side/);
  assert.match(ok.frames[1], /▸ ○ side/, "selects the new profile");
  const bad = fakeCtx([{ type: "create", row: 0 }, { type: "close" }], { input: "Bad Name" });
  await runAccountsMenu(bad.ctx, deps(agentDir));
  assert.match(feedbackOf(bad.frames[1]), /Invalid profile name "Bad Name": use lowercase letters/);
  const dup = fakeCtx([{ type: "create", row: 0 }, { type: "close" }], { input: "work" });
  await runAccountsMenu(dup.ctx, deps(agentDir));
  assert.match(feedbackOf(dup.frames[1]), /Profile "work" already exists\./);
  const reserved = fakeCtx([{ type: "create", row: 0 }, { type: "close" }], { input: "email" });
  await runAccountsMenu(reserved.ctx, deps(agentDir));
  assert.match(feedbackOf(reserved.frames[1]), /"email" is a reserved word \(it is a subcommand\)\. Pick another profile name\./);
  const none = fakeCtx([{ type: "create", row: 0 }, { type: "close" }], { input: undefined });
  await runAccountsMenu(none.ctx, deps(agentDir));
  assert.deepEqual(store.list(), ["personal", "side", "work"]);
});

test("S31 run: delete confirm yes/no and the active and startup refusals", async () => {
  const { agentDir, store } = setup();
  store.create("old");
  store.setStartup("personal");
  const c = fakeCtx([{ type: "delete", profile: "work", row: 0 }, { type: "delete", profile: "personal", row: 0 }, { type: "delete", profile: "old", row: 0 }, { type: "close" }], { confirm: false });
  await runAccountsMenu(c.ctx, deps(agentDir));
  assert.match(feedbackOf(c.frames[1]), /Cannot delete the active profile "work"\. Switch to another profile first\./);
  assert.match(feedbackOf(c.frames[2]), /Cannot delete the session profile "personal"/);
  assert.match(feedbackOf(c.frames[3]), /Delete cancelled\./);
  assert.ok(store.exists("old"));
  const yes = fakeCtx([{ type: "delete", profile: "old", row: 0 }, { type: "close" }], { confirm: true });
  await runAccountsMenu(yes.ctx, deps(agentDir));
  assert.match(feedbackOf(yes.frames[1]), /Deleted profile "old"\./);
  assert.equal(store.exists("old"), false);
});

test("S31 run: startup toggles set and clear; email toggles and refreshes the status", async () => {
  const { agentDir, store } = setup();
  const log: string[] = [];
  const c = fakeCtx([{ type: "startup", profile: "personal", row: 0 }, { type: "startup", profile: "personal", row: 0 }, { type: "email", row: 0 }, { type: "email", row: 0 }, { type: "close" }]);
  await runAccountsMenu(c.ctx, deps(agentDir, log));
  assert.match(feedbackOf(c.frames[1]), /Session profile set to "personal"\. New sessions start on it\./);
  assert.match(c.frames[1], /personal ★/);
  assert.match(feedbackOf(c.frames[2]), /Session profile cleared\. New sessions start on the last used profile\./);
  assert.equal(store.startup(), null);
  assert.match(feedbackOf(c.frames[3]), /Email display set to shown\. The status bar shows the full email\./);
  assert.doesNotMatch(c.frames[3], /Session:/, "global mode: no session account");
  assert.equal(JSON.parse(readFileSync(settingsPath(agentDir), "utf8")).showEmail, false);
  assert.match(feedbackOf(c.frames[4]), /Email display set to hidden/);
  assert.deepEqual(log, ["work", "work"]);
});

test("S31 run: a failing write shows feedback in the panel instead of aborting the loop", { skip: process.platform === "win32" }, async () => {
  const { agentDir, store } = setup();
  const profilesDir = join(agentDir, "profiles");
  chmodSync(profilesDir, 0o500); // the startup file cannot be written
  try {
    const c = fakeCtx([{ type: "startup", profile: "personal", row: 0 }, { type: "close" }]);
    await runAccountsMenu(c.ctx, deps(agentDir));
    assert.equal(c.frames.length, 2, "the menu reopened with the error instead of closing");
    assert.match(feedbackOf(c.frames[1]), /EACCES|permission denied/i);
    assert.equal(store.startup(), null);
  } finally {
    chmodSync(profilesDir, 0o700);
  }
});

test("S31 run: /login prefill for the pi providers on the active profile only", async () => {
  const { agentDir } = setup();
  const c = fakeCtx([{ type: "login", profile: "personal", provider: "anthropic", row: 3 }, { type: "login", profile: "work", provider: "openai-codex", row: 2 }]);
  await runAccountsMenu(c.ctx, deps(agentDir));
  assert.match(feedbackOf(c.frames[1]), /Switch to "personal" first/);
  assert.equal(c.frames.length, 2, "the /login prefill closes the panel");
  assert.equal(c.editor(), "/login");
  assert.deepEqual(c.notes, [{ message: 'Press Enter to run /login and choose Codex for profile "work".', type: "info" }]);
});

function runners(o: { tab?: OpenTabResult; here?: unknown } = {}) {
  const tabs: { cwd: string; command: TabCommand }[] = [];
  const heres: (string | undefined)[] = [];
  return {
    tabs,
    heres,
    openTab: async (cwd: string, command: TabCommand) => (tabs.push({ cwd, command }), o.tab ?? { ok: false }),
    loginHere: async (_ctx: unknown, dir: string | undefined) => (heres.push(dir), (o.here ?? { code: 0, signal: null }) as never),
  };
}

const CLAUDE = { type: "login", profile: "personal", provider: "claude", row: 1 } as const;

test("S32 run: Enter on Claude asks where; Show the command prints the S22 hint in the panel and in full through notify", async () => {
  const { agentDir, store } = setup();
  const r = runners();
  const c = fakeCtx([CLAUDE, { type: "close" }], { select: "Show the command" });
  await runAccountsMenu(c.ctx, { ...deps(agentDir), ...r, cwd: "/proj" });
  assert.deepEqual(c.selects(), [{ title: 'Log profile "personal" into Claude Code', options: ["In a new terminal tab", "In this terminal", "Show the command"] }]);
  const hint = loginHint("personal", claudeLoginCommand(store.claudeConfigEnv("personal"), "linux"), "linux");
  for (const line of hint.split("\n").filter(Boolean)) assert.ok(feedbackOf(c.frames[1]).includes(line.trimEnd().slice(0, 100)), line);
  assert.deepEqual(c.notes, [{ message: hint, type: "info" }]);
  assert.equal(r.tabs.length + r.heres.length, 0);
});

test("S32 run: cancelling the choice does nothing", async () => {
  const { agentDir } = setup();
  const r = runners();
  const c = fakeCtx([CLAUDE, { type: "close" }], { select: undefined });
  await runAccountsMenu(c.ctx, { ...deps(agentDir), ...r });
  assert.equal(c.frames.length, 2);
  assert.equal(feedbackOf(c.frames[1]).includes("claude auth login"), false);
  assert.deepEqual(c.notes, []);
  assert.equal(r.tabs.length + r.heres.length, 0);
});

test("S32 run: new terminal tab opens claude auth login with the profile dir in the cwd; failure prints the command", async () => {
  const { agentDir, store } = setup();
  const ok = runners({ tab: { ok: true, terminal: "tmux" } });
  const c = fakeCtx([CLAUDE, { type: "close" }], { select: "In a new terminal tab" });
  await runAccountsMenu(c.ctx, { ...deps(agentDir), ...ok, cwd: "/my proj" });
  assert.deepEqual(ok.tabs, [{ cwd: "/my proj", command: { argv: ["claude", "auth", "login"], env: { CLAUDE_CONFIG_DIR: store.claudeConfigEnv("personal") } } }]);
  assert.match(feedbackOf(c.frames[1]), /Opened a new terminal tab \(tmux\) to log profile "personal" into Claude Code\./);
  assert.deepEqual(c.notes, []);

  const fail = runners({ tab: { ok: false } });
  const f = fakeCtx([CLAUDE, { type: "close" }], { select: "In a new terminal tab" });
  await runAccountsMenu(f.ctx, { ...deps(agentDir), ...fail, cwd: "/p" });
  const hint = loginHint("personal", claudeLoginCommand(store.claudeConfigEnv("personal"), "linux"), "linux");
  assert.match(feedbackOf(f.frames[1]), /Could not open a new terminal tab\./);
  assert.deepEqual(f.notes, [{ message: hint, type: "info" }]);
});

test("S32 run: the default profile opens the tab with CLAUDE_CONFIG_DIR unset", async () => {
  const { agentDir, store } = setup();
  store.create("default");
  writeFileSync(join(agentDir, "profiles", "default", "claude-default"), "");
  const r = runners({ tab: { ok: true, terminal: "kitty" } });
  const c = fakeCtx([{ type: "login", profile: "default", provider: "claude", row: 1 }, { type: "close" }], { select: "In a new terminal tab" });
  await runAccountsMenu(c.ctx, { ...deps(agentDir), ...r, cwd: "/p" });
  assert.deepEqual(r.tabs[0].command.env, { CLAUDE_CONFIG_DIR: null });
});

test("S32 run: In this terminal hands over, then refreshes the registry and the status; failures are feedback", async () => {
  const { agentDir, store } = setup();
  const log: string[] = [];
  const r = runners({ here: { code: 0, signal: null } });
  const c = fakeCtx([CLAUDE, { type: "close" }], { select: "In this terminal" });
  await runAccountsMenu(c.ctx, { ...deps(agentDir, log), ...r });
  assert.deepEqual(r.heres, [store.claudeConfigEnv("personal")]);
  assert.match(feedbackOf(c.frames[1]), /Claude Code login finished for profile "personal"\./);
  assert.equal(c.refreshed(), 1);
  assert.deepEqual(log, ["work"]);
  for (const [here, re] of [[{ code: 1, signal: null }, /claude auth login exited with code 1\./], [{ code: null, signal: "SIGTERM" }, /claude auth login was stopped by SIGTERM\./], [{ error: new Error("spawn claude ENOENT") }, /Could not run claude auth login: spawn claude ENOENT/]] as const) {
    const rr = runners({ here });
    const cc = fakeCtx([CLAUDE, { type: "close" }], { select: "In this terminal" });
    await runAccountsMenu(cc.ctx, { ...deps(agentDir), ...rr });
    assert.match(feedbackOf(cc.frames[1]), re);
    assert.equal(cc.refreshed(), 1);
  }
});

test("S32 run: o opens gentle-accounts <profile> in a new tab in the cwd, falling back to the printed command", async () => {
  const { agentDir } = setup();
  const ok = runners({ tab: { ok: true, terminal: "Terminal.app" } });
  const c = fakeCtx([{ type: "open", profile: "personal", row: 0 }, { type: "close" }]);
  await runAccountsMenu(c.ctx, { ...deps(agentDir), ...ok, cwd: "/my proj" });
  assert.deepEqual(ok.tabs, [{ cwd: "/my proj", command: { argv: ["gentle-accounts", "personal"], env: {} } }]);
  assert.match(feedbackOf(c.frames[1]), /Opened "personal" in a new terminal tab \(Terminal\.app\): gentle-accounts personal/);
  const fail = runners();
  const f = fakeCtx([{ type: "open", profile: "personal", row: 0 }, { type: "close" }]);
  await runAccountsMenu(f.ctx, { ...deps(agentDir), ...fail, cwd: "/p" });
  assert.match(feedbackOf(f.frames[1]), /Open this project with "personal" in a new terminal: gentle-accounts personal/);
  assert.deepEqual(f.notes, [{ message: 'Open this project with "personal" in a new terminal: gentle-accounts personal', type: "info" }]);
});

test("S31 run: the menu is available only with UI in tui mode", () => {
  assert.equal(menuAvailable({ hasUI: true, mode: "tui" }), true);
  assert.equal(menuAvailable({ hasUI: false, mode: "tui" }), false);
  assert.equal(menuAvailable({ hasUI: true, mode: "rpc" }), false);
  assert.equal(menuAvailable({ hasUI: true }), false);
});

// -- S39: centered on the chat column when the Gentle Shell sidebar is painting ---------------------------------

const SIDEBAR = Symbol.for("gentle-pi.experimental-sidebar.state");
const withSidebar = (state: unknown) => ({ [SIDEBAR]: state }) as object;
const owning = { active: true, ownsHost: () => true, railColumns: 53 };

test("S39 margin: the sidebar rail plus one column of padding, 0 for anything else", () => {
  assert.equal(sidebarRightMargin(withSidebar(owning)), 54);
  assert.equal(sidebarRightMargin(withSidebar({ ...owning, railColumns: 20 })), 21);
  for (const bad of [undefined, null, "terminal", 5, {}, withSidebar(undefined), withSidebar(null), withSidebar("x")]) assert.equal(sidebarRightMargin(bad), 0, JSON.stringify(bad));
  assert.equal(sidebarRightMargin(withSidebar({ ...owning, active: false })), 0, "not painting");
  assert.equal(sidebarRightMargin(withSidebar({ ...owning, ownsHost: () => false })), 0, "the sidebar does not own this host");
  assert.equal(sidebarRightMargin(withSidebar({ ...owning, ownsHost: undefined })), 0);
  for (const rail of [0, -3, 1.5, "53", undefined, NaN]) assert.equal(sidebarRightMargin(withSidebar({ ...owning, railColumns: rail })), 0, String(rail));
  assert.equal(sidebarRightMargin(withSidebar({ ...owning, ownsHost: () => { throw new Error("boom"); } })), 0, "never throws");
});

test("S39 margin: the overlay margin is live, so the panel follows the sidebar while the menu stays open", () => {
  let terminal: unknown = undefined;
  const options = menuOverlayOptions(() => terminal);
  assert.equal(options.margin, 1, "no sidebar: the plain margin");
  terminal = withSidebar(owning);
  assert.equal(options.visible(), true);
  assert.deepEqual(options.margin, { top: 1, right: 54, bottom: 1, left: 1 }, "confined to the chat column");
  terminal = withSidebar({ ...owning, active: false });
  options.visible();
  assert.equal(options.margin, 1, "the sidebar went away (a resize across its breakpoint)");
  assert.equal(options.width, "60%");
  assert.equal(options.anchor, "center");
});

test("S39 run: the menu hands pi the terminal it is shown on, so the margin reads the real sidebar", async () => {
  const { agentDir } = setup();
  const c = fakeCtx([{ type: "close" }], { terminal: withSidebar(owning) });
  await runAccountsMenu(c.ctx, deps(agentDir));
  const opened = c.options[0] as { overlayOptions: () => ReturnType<typeof menuOverlayOptions> };
  assert.deepEqual(opened.overlayOptions().margin, { top: 1, right: 54, bottom: 1, left: 1 });
  const plain = fakeCtx([{ type: "close" }]);
  await runAccountsMenu(plain.ctx, deps(agentDir));
  assert.equal((plain.options[0] as { overlayOptions: () => ReturnType<typeof menuOverlayOptions> }).overlayOptions().margin, 1);
});

test("S42 margin: it is read when the layout asks, so the first layout never sees a stale value", () => {
  let terminal: unknown = undefined; // pi may resolve the options before the terminal exists
  const options = menuOverlayOptions(() => terminal);
  const first = options.margin;
  terminal = withSidebar(owning);
  assert.equal(first, 1);
  assert.deepEqual(options.margin, { top: 1, right: 54, bottom: 1, left: 1 }, "no visible() call needed in between");
});

// -- S10: rename from the menu ----------------------------------------------------------------------------------

test("S10 run: r prompts with the old name prefilled, renames, reselects the new name and refreshes the status", async () => {
  const { agentDir, store } = setup();
  const log: string[] = [];
  const c = fakeCtx([{ type: "rename", profile: "work", row: 0 }, { type: "close" }], { input: "  office  " });
  await runAccountsMenu(c.ctx, deps(agentDir, log));
  assert.deepEqual(c.prompts, [{ title: 'Rename profile "work" to', placeholder: "work" }]);
  assert.deepEqual(store.list(), ["office", "personal"]);
  assert.match(feedbackOf(c.frames[1]), /Renamed profile "work" to "office"\. Other open sessions that use it keep the old path until they switch or restart\./);
  assert.match(c.frames[1], /▸ ● office/, "the renamed profile stays selected and active");
  assert.ok(log.includes("office"), "the status bar was refreshed after the rename");
});

test("S10 run: an empty, unchanged or cancelled answer does nothing and never calls the flow", async () => {
  const { agentDir, store } = setup();
  let calls = 0;
  const spy = { ...deps(agentDir), flows: { ...deps(agentDir).flows, rename: () => (calls++, { message: "x", type: "info" as const }) } };
  for (const input of ["", "   ", "work", undefined]) {
    const c = fakeCtx([{ type: "rename", profile: "work", row: 0 }, { type: "close" }], { input });
    await runAccountsMenu(c.ctx, spy);
    assert.doesNotMatch(c.frames[1], /Renamed|x$/m, JSON.stringify(input));
  }
  assert.equal(calls, 0);
  assert.deepEqual(store.list(), ["personal", "work"]);
});

test("S10 run: a refusal is shown as feedback and the selection stays on the old name", async () => {
  const { agentDir, store } = setup();
  const log: string[] = [];
  for (const [input, message] of [
    ["personal", /Profile "personal" already exists\./],
    ["Bad Name", /Invalid profile name "Bad Name": use lowercase letters/],
    ["rename", /"rename" is a reserved word/],
  ] as const) {
    const c = fakeCtx([{ type: "rename", profile: "work", row: 0 }, { type: "close" }], { input });
    await runAccountsMenu(c.ctx, deps(agentDir, log));
    assert.match(feedbackOf(c.frames[1]), message, input);
    assert.match(c.frames[1], /▸ ● work/, input);
  }
  assert.deepEqual(store.list(), ["personal", "work"]);
  assert.equal(log.length, 0, "no status refresh for a rename that did not happen");
});

test("S10 run: a profile that is not the current one gets the plain message", async () => {
  const { agentDir, store } = setup();
  const c = fakeCtx([{ type: "rename", profile: "personal", row: 0 }, { type: "close" }], { input: "home" });
  await runAccountsMenu(c.ctx, deps(agentDir));
  assert.match(feedbackOf(c.frames[1]), /^Renamed profile "personal" to "home"\.$/m);
  assert.deepEqual(store.list(), ["home", "work"]);
});

test("adopt: a live login of another account becomes a new profile, and a cancelled name does nothing", async () => {
  const { agentDir, store } = setup();
  const codex = (accountId: string) => ({ type: "oauth", access: "a", refresh: "r", expires: 1, accountId });
  writeFileSync(store.authPath("work"), JSON.stringify({ "openai-codex": codex("A") }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": codex("B") }));
  const none = fakeCtx([{ type: "adopt", row: 0 }, { type: "close" }], { input: undefined });
  await runAccountsMenu(none.ctx, deps(agentDir));
  assert.equal(store.exists("second"), false);
  assert.match(none.frames[0], /Detected login: Codex/);
  const ok = fakeCtx([{ type: "adopt", row: 0 }, { type: "close" }], { input: "second" });
  await runAccountsMenu(ok.ctx, deps(agentDir));
  assert.match(feedbackOf(ok.frames[1]), /Adopted the detected login as profile "second"\./);
  assert.equal(store.current(), "second");
  assert.deepEqual(JSON.parse(readFileSync(store.authPath("work"), "utf8"))["openai-codex"], codex("A"), "work keeps its own account");
  assert.doesNotMatch(ok.frames[1], /Detected login/, "nothing left to adopt");
});

test("loginProviders keeps the registry providers that have an OAuth method and never throws", () => {
  const registry = {
    getAll: () => [{ provider: "github-copilot" }, { provider: "github-copilot" }, { provider: "google" }, { provider: "openai-codex" }],
    getProvider: (id: string) => ({ google: { auth: { apiKey: {} } }, "github-copilot": { name: "GitHub Copilot", auth: { oauth: {} } }, "openai-codex": { auth: { oauth: {} } } } as Record<string, unknown>)[id],
  };
  assert.deepEqual(loginProviders({ modelRegistry: registry } as never), [{ id: "github-copilot", name: "GitHub Copilot" }, { id: "openai-codex", name: "openai-codex" }]);
  assert.deepEqual(loginProviders({} as never), []);
});
