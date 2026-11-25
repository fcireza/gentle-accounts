import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import gentleProfiles from "../src/index.ts";
import { ProfileStore } from "../src/store.ts";
import { runCli, USAGE as CLI_USAGE, type CliDeps } from "../src/cli.ts";
import { getUsageBox, setUsageBox, settingsPath } from "../src/settings.ts";
import { readUsage, usagePath } from "../src/usage.ts";
import { buildSessionHome } from "../src/session-home.ts";
import { resolveContext } from "../src/session-home.ts";
import { runAccountsMenu } from "../src/menu/run.ts";
import { COMMAND_FLOWS, switchFlow } from "../src/index.ts";
import { openNativeUsage } from "../src/usage-chain.ts";
import { AccountsMenuPanel, type MenuAction } from "../src/menu/panel.ts";
import { identityTheme, menuSpans, renderMenu, visibleWidth, type MenuModel } from "../src/menu/view.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const HEADERS = { "anthropic-ratelimit-unified-5h-utilization": "0.5", "anthropic-ratelimit-unified-5h-reset": "1700003600", authorization: "Bearer SECRET" };

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function fakePi() {
  const commands = new Map<string, { handler: Handler }>();
  const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const calls: string[] = [];
  const pi = {
    registerCommand: (name: string, options: { handler: Handler }) => commands.set(name, options),
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => events.set(event, handler),
    events: { emit: (name: string) => calls.push(`emit:${name}`), on: (name: string) => calls.push(`on:${name}`) },
    registerTool: () => calls.push("registerTool"),
    registerMessageRenderer: () => calls.push("registerMessageRenderer"),
  } as unknown as ExtensionAPI;
  return { pi, commands, events, calls };
}

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-int-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const { pi, commands, events, calls } = fakePi();
  gentleProfiles(pi, { runClaudeStatus: async () => "", setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("home");
  store.setCurrent("work");
  return { agentDir, store, handler: commands.get("gentle:accounts")!.handler, events, calls, settings: settingsPath(agentDir) };
}

function fakeCtx(o: { tui?: boolean } = {}) {
  const notes: { message: string; type?: string }[] = [];
  const widgets: unknown[] = [];
  const frames: string[] = [];
  const opened: unknown[] = [];
  const ctx = {
    hasUI: o.tui ?? false,
    mode: o.tui ? "tui" : "print",
    isIdle: () => true,
    modelRegistry: { refresh: async () => {}, getAll: () => [], getProvider: () => undefined },
    ui: {
      notify: (message: string, type?: string) => notes.push({ message, type }),
      setStatus: () => {},
      setWidget: (...a: unknown[]) => widgets.push(a),
      custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (v?: unknown) => void) => { render(w: number): string[] }, options: unknown) => {
        opened.push(options);
        frames.push(factory({ requestRender() {} }, identityTheme, {}, () => {}).render(80).join("\n"));
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notes, widgets, frames, opened };
}

test("S1 extension: after_provider_response records the numbers under the current profile and never the headers", async () => {
  const { store, events } = setup();
  const handler = events.get("after_provider_response");
  assert.equal(typeof handler, "function");
  await handler!({ type: "after_provider_response", status: 200, headers: HEADERS }, { model: { provider: "anthropic" } });
  const snapshots = readUsage(store, "work");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].provider, "anthropic");
  assert.equal(snapshots[0].windows[0].usedPercent, 50);
  assert.doesNotMatch(readFileSync(usagePath(store, "work"), "utf8"), /SECRET|authorization/i);
  assert.deepEqual(readUsage(store, "home"), []);
  // A response with no usage headers, or no event context, never throws.
  await handler!({ headers: { "content-type": "x" } }, undefined);
  await handler!({ headers: HEADERS }, undefined);
  await handler!({}, undefined);
});

test("S1 extension: in a session home the snapshot goes to the session's own current profile", async () => {
  const { agentDir, store, events } = setup();
  const base = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-homes-"));
  after(() => rmSync(base, { recursive: true, force: true }));
  const { home } = buildSessionHome({ sharedAgentDir: agentDir, profile: "home", baseDir: base });
  process.env.PI_CODING_AGENT_DIR = home;
  await events.get("after_provider_response")!({ headers: HEADERS }, { model: { provider: "anthropic" } });
  assert.equal(readUsage(store, "home").length, 1);
  assert.deepEqual(readUsage(store, "work"), []);
});

test("S3 extension: disabled means no capture", async () => {
  const { store, events, settings } = setup();
  setUsageBox(settings, false);
  await events.get("after_provider_response")!({ headers: HEADERS }, { model: { provider: "anthropic" } });
  assert.equal(existsSync(usagePath(store, "work")), false);
});

test("S3 command: usage off, on and the disabled warning have fixed messages", async () => {
  const { handler, settings } = setup();
  const c = fakeCtx({ tui: true });
  await handler("usage off", c.ctx);
  assert.equal(getUsageBox(settings), false);
  await handler("usage", c.ctx);
  await handler("usage on", c.ctx);
  assert.equal(getUsageBox(settings), true);
  await handler("usage maybe", c.ctx);
  assert.deepEqual(c.notes, [
    { message: "Account usage box disabled. The native Gentle Shell usage is unchanged.", type: "info" },
    { message: "Account usage box is disabled. Enable it with /gentle:accounts usage on.", type: "warning" },
    { message: "Account usage box enabled.", type: "info" },
    { message: "Usage: /gentle:accounts usage [on|off]", type: "warning" },
  ]);
  assert.equal(c.opened.length, 0);
});

test("S2 command: usage opens the overlay with the menu's overlay options", async () => {
  const { handler, store } = setup();
  writeFileSync(usagePath(store, "work"), JSON.stringify({ anthropic: { provider: "anthropic", fetchedAt: Date.now(), windows: [{ label: "5h", usedPercent: 50, resetAt: null }] } }));
  const c = fakeCtx({ tui: true });
  await handler("usage", c.ctx);
  assert.equal(c.opened.length, 1);
  const opened = c.opened[0] as { overlay: boolean; overlayOptions: () => { anchor: string; width: string } };
  assert.equal(opened.overlay, true);
  assert.equal(opened.overlayOptions().anchor, "center");
  assert.match(c.frames[0], /Account Usage/);
  assert.match(c.frames[0], /● work/);
  assert.match(c.frames[0], /Anthropic · updated just now/);
  assert.match(c.frames[0], /no usage seen yet/);
  assert.deepEqual(c.notes, []);
});

test("S2 command: without the TUI, usage prints the same box as plain text", async () => {
  const { handler } = setup();
  const c = fakeCtx();
  await handler("usage", c.ctx);
  assert.equal(c.opened.length, 0);
  assert.equal(c.notes.length, 1);
  assert.match(c.notes[0].message, /Account Usage/);
  assert.match(c.notes[0].message, /no usage seen yet/);
});

test("S4 extension: it registers no usage source, emits no usage event and only ever sets the gentle-accounts widget", async () => {
  const { handler, events, calls } = setup();
  const c = fakeCtx({ tui: true });
  await events.get("after_provider_response")!({ headers: HEADERS }, { model: { provider: "anthropic" } });
  await handler("usage", c.ctx);
  await handler("usage off", c.ctx);
  await handler("usage on", c.ctx);
  assert.deepEqual([...events.keys()].filter((name) => /usage/.test(name)), []);
  assert.deepEqual(calls.filter((call) => /usage/.test(call)), []);
  assert.equal(calls.some((call) => call.startsWith("emit:")), false);
  assert.ok(c.widgets.length > 0);
  for (const w of c.widgets as unknown[][]) assert.equal(w[0], "gentle-accounts");
});

test("S3 widget: registered below the editor on session_start with UI, removed when the box is off, never without UI", async () => {
  const { handler, events, settings } = setup();
  const none = fakeCtx();
  await events.get("session_start")!({ reason: "startup" }, none.ctx);
  assert.deepEqual(none.widgets, []);
  const c = fakeCtx({ tui: true });
  await events.get("session_start")!({ reason: "startup" }, c.ctx);
  const first = c.widgets[c.widgets.length - 1] as [string, unknown, { placement: string }];
  assert.equal(first[0], "gentle-accounts");
  assert.equal(typeof first[1], "function");
  assert.equal(first[2].placement, "belowEditor");
  const comp = (first[1] as (t: unknown, th: unknown) => { render(w: number): string[] })({ requestRender() {} }, identityTheme);
  assert.match(comp.render(60).join("\n"), /Gentle Accounts/);
  await handler("usage off", c.ctx);
  assert.deepEqual(c.widgets[c.widgets.length - 1], ["gentle-accounts", undefined]);
  await handler("usage on", c.ctx);
  assert.equal(typeof (c.widgets[c.widgets.length - 1] as unknown[])[1], "function");
  setUsageBox(settings, false);
  await events.get("agent_end")!({}, c.ctx);
  assert.deepEqual(c.widgets[c.widgets.length - 1], ["gentle-accounts", undefined]);
});

test("S3 command: usage and its help line are in the slash USAGE and the CLI USAGE", async () => {
  const { handler } = setup();
  const c = fakeCtx();
  await handler("help", c.ctx);
  assert.match(c.notes[0].message, /\/gentle:accounts usage \[on\|off\]/);
  assert.match(CLI_USAGE, /gentle-accounts usage \[on\|off\]/);
});

function cli() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-cli-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const deps = { store: new ProfileStore(agentDir), liveAuthPath: join(agentDir, "auth.json"), env: {}, platform: "linux", stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l), spawn: () => 0 } as CliDeps;
  return { agentDir, deps, out, err, settings: settingsPath(agentDir) };
}

test("S3 cli: usage prints the setting, on and off change it with the fixed messages", () => {
  const { deps, out, err, settings } = cli();
  assert.equal(runCli(["usage"], deps), 0);
  assert.equal(runCli(["usage", "off"], deps), 0);
  assert.equal(getUsageBox(settings), false);
  assert.equal(runCli(["usage"], deps), 0);
  assert.equal(runCli(["usage", "on"], deps), 0);
  assert.equal(getUsageBox(settings), true);
  assert.deepEqual(out, ["Account usage box: enabled", "Account usage box disabled. The native Gentle Shell usage is unchanged.", "Account usage box: disabled", "Account usage box enabled."]);
  assert.deepEqual(err, []);
});

test("S3 cli: a bad argument prints the usage line on stderr and exits 1, changing nothing", () => {
  const { deps, out, err, settings } = cli();
  assert.equal(runCli(["usage", "maybe"], deps), 1);
  assert.equal(runCli(["usage", "off", "now"], deps), 1);
  assert.deepEqual(err, ["Usage: gentle-accounts usage [on|off]", "Usage: gentle-accounts usage [on|off]"]);
  assert.deepEqual(out, []);
  assert.equal(getUsageBox(settings), true);
});

// ---- menu ----

const menuModel = (usageBox?: boolean): MenuModel => ({
  title: "gentle-accounts",
  showEmail: false,
  sessionName: "work",
  usageBox,
  profiles: [{ name: "work", active: true, startup: false, providers: [{ provider: "claude", label: "Claude Bridge", loggedIn: false }] }],
  selected: 0,
  row: 0,
});

test("S2 menu: g usage is a hint (all layouts, fitting every width) and a clickable span only while the box is enabled", () => {
  for (const width of [30, 40, 49, 50, 60, 70, 100, 200]) {
    const visible = width >= 40; // the compact layout cuts its hint rows below 40 columns, as it did before
    const on = renderMenu(menuModel(true), width, identityTheme);
    const off = renderMenu(menuModel(false), width, identityTheme);
    for (const line of on) assert.ok(visibleWidth(line) <= width, `width ${width}`);
    if (visible) assert.match(on.map(strip).join("\n"), /g usage/, `width ${width}`);
    assert.doesNotMatch(off.map(strip).join("\n"), /g usage/, `width ${width}`);
    assert.ok(menuSpans(menuModel(true), width).some((s) => "key" in s.target && s.target.key === "char:g"), `span ${width}`);
    assert.ok(!menuSpans(menuModel(false), width).some((s) => "key" in s.target && s.target.key === "char:g"));
    assert.ok(!menuSpans(menuModel(undefined), width).some((s) => "key" in s.target && s.target.key === "char:g"));
  }
});

test("S2 menu: g usage is next to the email hint on the commands line, and lit on hover", () => {
  const wide = renderMenu(menuModel(true), 200, identityTheme).map(strip);
  assert.ok(wide.some((l) => /e email {2}g usage {2}a all usage {2}esc close/.test(l)));
  const lit = renderMenu({ ...menuModel(true), hover: "char:g" }, 200, { fg: (_c, t) => t, bold: (t) => `*${t}` }).join("\n");
  assert.match(lit, /\*g \*usage/);
});

test("S2 menu: the g key ends the panel with a usage action only while enabled; a click on the hint presses it", () => {
  const press = (usageBox: boolean | undefined, input: string) => {
    const actions: MenuAction[] = [];
    new AccountsMenuPanel(menuModel(usageBox), identityTheme, (a) => actions.push(a)).handleInput(input);
    return actions;
  };
  assert.deepEqual(press(true, "g"), [{ type: "usage", profile: "work", row: 0 }]);
  assert.deepEqual(press(false, "g"), []);
  assert.deepEqual(press(undefined, "g"), []);
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(menuModel(true), identityTheme, (a) => actions.push(a));
  const span = menuSpans(menuModel(true), 100).find((s) => "key" in s.target && s.target.key === "char:g")!;
  panel.handleMouse({ type: "click", button: "left", x: span.from, y: span.line, width: 100 });
  assert.deepEqual(actions, [{ type: "usage", profile: "work", row: 0 }]);
});

test("S2 menu run: the usage action opens the usage overlay, then the menu again; the setting hides the hint", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-run-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.HOME = agentDir;
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.setCurrent("work");
  const frames: string[] = [];
  const options: unknown[] = [];
  const script: (MenuAction | undefined)[] = [{ type: "usage", profile: "work", row: 0 }, undefined, { type: "close" }];
  const ctx = {
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    modelRegistry: { getAll: () => [], getProvider: () => undefined },
    ui: {
      notify: () => {},
      custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (a: unknown) => void) => { render(w: number): string[] }, opts: unknown) => {
        options.push(opts);
        frames.push(factory({ requestRender() {} }, identityTheme, {}, () => {}).render(120).join("\n"));
        return script.shift();
      },
    },
  } as unknown as ExtensionCommandContext;
  const deps = {
    context: () => resolveContext(agentDir),
    refreshStatus: async () => {},
    activeClaude: () => undefined,
    flows: { ...COMMAND_FLOWS, switchTo: (c: ExtensionCommandContext, s: ProfileStore, live: string, target: string, report: (m: string, t?: "info" | "warning" | "error") => void) => switchFlow({ ctx: c, store: s, liveAuthPath: live, target, report, refreshStatus: async () => {} }) },
    homeDir: agentDir,
    platform: "linux" as NodeJS.Platform,
  };
  await runAccountsMenu(ctx, deps);
  assert.equal(frames.length, 3);
  assert.match(frames[0], /g usage/);
  assert.match(frames[1], /Account Usage/);
  assert.match(frames[2], /Gentle Accounts/);
  assert.equal((options[1] as { overlay: boolean }).overlay, true);
  setUsageBox(settingsPath(agentDir), false);
  frames.length = 0;
  script.push({ type: "close" });
  await runAccountsMenu(ctx, deps);
  assert.doesNotMatch(frames[0], /g usage/);
});

// ---- usage all: native usage first, then ours ----

function chainPi(opts: { names?: string[]; fail?: boolean; log: string[] }) {
  const { pi, commands } = fakePi();
  const extra = pi as unknown as Record<string, unknown>;
  extra.getCommands = () => (opts.names ?? ["gentle:usage"]).map((name) => ({ name }));
  extra.sendUserMessage = async (text: string, o: unknown) => {
    opts.log.push(`send:${text}:${JSON.stringify(o)}`);
    if (opts.fail) throw new Error("boom");
  };
  return { pi, commands };
}

test("S1 openNativeUsage: opened after the command runs; unavailable when absent or failing; accepts the slash form; never throws", async () => {
  const log: string[] = [];
  assert.equal(await openNativeUsage(chainPi({ log }).pi), "opened");
  assert.deepEqual(log, ['send:/gentle:usage:{"expandPromptTemplates":true}']);
  assert.equal(await openNativeUsage(chainPi({ log: [], names: ["/gentle:usage"] }).pi), "opened");
  const none: string[] = [];
  assert.equal(await openNativeUsage(chainPi({ log: none, names: ["other"] }).pi), "unavailable");
  assert.deepEqual(none, []);
  assert.equal(await openNativeUsage(chainPi({ log: [], fail: true }).pi), "unavailable");
  const broken = { getCommands: () => { throw new Error("x"); }, sendUserMessage: async () => {} };
  assert.equal(await openNativeUsage(broken as never), "unavailable");
});

function chainSetup(opts: { names?: string[]; fail?: boolean } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-chain-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.HOME = agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  const log: string[] = [];
  const { pi, commands } = chainPi({ ...opts, log });
  gentleProfiles(pi, { runClaudeStatus: async () => "", setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.setCurrent("work");
  return { log, handler: commands.get("gentle:accounts")!.handler, settings: settingsPath(agentDir) };
}

test("S2 command: usage all opens the native usage, then ours", async () => {
  const { handler, log } = chainSetup();
  const c = fakeCtx({ tui: true });
  const order: string[] = [];
  const custom = c.ctx.ui.custom.bind(c.ctx.ui);
  (c.ctx.ui as { custom: unknown }).custom = (...a: unknown[]) => (order.push(`ours:${log.length}`), (custom as (...x: unknown[]) => unknown)(...a));
  await handler("usage all", c.ctx);
  assert.equal(log.length, 1);
  assert.deepEqual(order, ["ours:1"]);
  assert.equal(c.opened.length, 1);
  assert.match(c.frames[0], /Account Usage/);
  assert.deepEqual(c.notes, []);
});

test("S2 command: usage all without native opens only ours and notifies; disabled opens nothing; plain usage is unchanged", async () => {
  const off = chainSetup({ names: [] });
  const c = fakeCtx({ tui: true });
  await off.handler("usage all", c.ctx);
  assert.deepEqual(off.log, []);
  assert.equal(c.opened.length, 1);
  assert.deepEqual(c.notes, [{ message: "Native Gentle Shell usage is not available; showing the account usage only.", type: "info" }]);

  const d = chainSetup();
  setUsageBox(d.settings, false);
  const c2 = fakeCtx({ tui: true });
  await d.handler("usage all", c2.ctx);
  assert.deepEqual(d.log, []);
  assert.equal(c2.opened.length, 0);
  assert.deepEqual(c2.notes, [{ message: "Account usage box is disabled. Enable it with /gentle:accounts usage on.", type: "warning" }]);

  const p = chainSetup();
  const c3 = fakeCtx({ tui: true });
  await p.handler("usage", c3.ctx);
  assert.deepEqual(p.log, []);
  assert.equal(c3.opened.length, 1);
});

test("S3 menu: a all usage hint, short label, key and click only while enabled", () => {
  const text = (u: boolean | undefined, w: number) => renderMenu(menuModel(u), w, identityTheme).map(strip).join("\n");
  assert.match(text(true, 200), /a all usage/);
  assert.match(text(true, 45), /a usage\+/);
  assert.doesNotMatch(text(false, 200), /a all usage|a usage\+/);
  for (const w of [40, 50, 70, 100, 200]) for (const line of renderMenu(menuModel(true), w, identityTheme)) assert.ok(visibleWidth(line) <= w);
  assert.ok(menuSpans(menuModel(true), 100).some((s) => "key" in s.target && s.target.key === "char:a"));
  assert.ok(!menuSpans(menuModel(false), 100).some((s) => "key" in s.target && s.target.key === "char:a"));
  const press = (u: boolean | undefined) => {
    const actions: MenuAction[] = [];
    new AccountsMenuPanel(menuModel(u), identityTheme, (a) => actions.push(a)).handleInput("a");
    return actions;
  };
  assert.deepEqual(press(true), [{ type: "usageAll", profile: "work", row: 0 }]);
  assert.deepEqual(press(false), []);
  const lit = renderMenu({ ...menuModel(true), hover: "char:a" }, 200, { fg: (_c, t) => t, bold: (t) => `*${t}` }).join("\n");
  assert.match(lit, /\*a \*all usage/);
});

test("S3 menu run: usageAll ends the menu (no reopen) and hands over", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-all-run-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.HOME = agentDir;
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.setCurrent("work");
  let opens = 0;
  const handed: number[] = [];
  const ctx = {
    hasUI: true, mode: "tui", isIdle: () => true,
    modelRegistry: { getAll: () => [], getProvider: () => undefined },
    ui: { notify: () => {}, custom: async () => (opens++, { type: "usageAll", profile: "work", row: 0 }) },
  } as unknown as ExtensionCommandContext;
  const deps = {
    context: () => resolveContext(agentDir), refreshStatus: async () => {}, activeClaude: () => undefined,
    flows: { ...COMMAND_FLOWS, switchTo: (c: ExtensionCommandContext, s: ProfileStore, live: string, target: string, report: (m: string, t?: "info" | "warning" | "error") => void) => switchFlow({ ctx: c, store: s, liveAuthPath: live, target, report, refreshStatus: async () => {} }) },
    homeDir: agentDir, platform: "linux" as NodeJS.Platform,
    openUsageAll: async () => void handed.push(opens),
  };
  await runAccountsMenu(ctx, deps);
  assert.equal(opens, 1);
  assert.deepEqual(handed, [1]);
});
