import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loginEnv, runClaudeLoginHere, runCommandHere, type InheritResult, type InheritSpawn } from "../login-runner.ts";
import { openInNewTab, type OpenTabResult, type TabCommand, type TabSpawn } from "../terminal.ts";
import { PROVIDER_LABELS, runClaudeAuthLogout, type ClaudeAccount } from "../account.ts";
import { claudeLoginCommand, loginHint } from "../login.ts";
import { getShowEmail, getUsageBox, runEmailCommand, settingsPath } from "../settings.ts";
import type { AgentContext } from "../session-home.ts";
import { runStartupCommand, type ProfileStore } from "../store.ts";
import { AccountsMenuPanel, type MenuAction } from "./panel.ts";
import { adoptLogin } from "../adopt.ts";
import { logoutProvider } from "../logout.ts";
import { runOauthLogin, type OauthProvider, type LoginUi } from "../oauth-login.ts";
import { readAuthFile, writeAuthFile } from "../auth-sync.ts";
import { isAuthLinked } from "../auth-link.ts";
import { detectLogins } from "../detect.ts";
import { UsageBoxPanel } from "../usage-panel.ts";
import { buildUsageModel } from "../usage-view.ts";
import { buildMenuModel, type Feedback, type FeedbackType } from "./view.ts";

/**
 * The providers `/login` offers (those with an OAuth method), logged in or not. pi has no public list, so they come
 * from the model registry: every provider that has models, kept when it has OAuth. Never throws.
 */
export function loginProviders(ctx: ExtensionCommandContext): { id: string; name: string }[] {
  try {
    const registry = ctx.modelRegistry;
    const ids = [...new Set(registry.getAll().map((model) => model.provider))];
    const found: { id: string; name: string }[] = [];
    for (const id of ids) {
      const provider = registry.getProvider(id);
      if (provider?.auth?.oauth) found.push({ id, name: provider.name ?? id });
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * Saves a fresh credential into the live auth.json and the profile's own copy. Both files are read and both new
 * contents built before anything is written; if the second write fails the first is put back, so the two never disagree.
 */
export function saveCredential(livePath: string, snapshotPath: string, provider: string, credential: unknown): void {
  if (isAuthLinked(livePath)) {
    // S5: the live file is a profile's own file, so there is one copy to write: the profile's. Writing through the
    // link could land in another profile's file.
    writeAuthFile(snapshotPath, { ...readAuthFile(snapshotPath), [provider]: credential });
    return;
  }
  const live = readAuthFile(livePath);
  const snapshot = readAuthFile(snapshotPath);
  const nextLive = { ...live, [provider]: credential };
  const nextSnapshot = { ...snapshot, [provider]: credential };
  writeAuthFile(snapshotPath, nextSnapshot);
  try {
    writeAuthFile(livePath, nextLive);
  } catch (error) {
    try {
      writeAuthFile(snapshotPath, snapshot);
    } catch {
      // the original error is the one to report
    }
    throw error;
  }
}

export type Report = (message: string, type?: FeedbackType) => void;

/** The command's own flows (they live in src/index.ts with its messages), reused here so nothing is duplicated. */
export interface MenuFlows {
  switchTo: (ctx: ExtensionCommandContext, store: ProfileStore, liveAuthPath: string, target: string, report: Report) => Promise<void>;
  create: (store: ProfileStore, name: string) => Feedback;
  remove: (ctx: ExtensionCommandContext, store: ProfileStore, name: string) => Promise<Feedback>;
  rename: (store: ProfileStore, from: string, to: string) => Feedback;
}

/** The custom overlay needs the interactive TUI; RPC, print and json modes keep the select picker. */
export function menuAvailable(ctx: { hasUI?: boolean; mode?: string }): boolean {
  return ctx.hasUI === true && ctx.mode === "tui";
}

export interface MenuDeps {
  context: () => AgentContext;
  refreshStatus: (ctx: ExtensionCommandContext, store: ProfileStore) => Promise<void>;
  /** Cached `claude auth status` result of the active profile (undefined: nothing cached). */
  activeClaude: (store: ProfileStore) => ClaudeAccount | null | undefined;
  flows: MenuFlows;
  homeDir?: string;
  platform?: NodeJS.Platform;
  /** Working directory for the new tabs (default: the session cwd). */
  cwd?: string;
  /** S32 runners, injectable for tests (defaults spawn real processes). */
  openTab?: (cwd: string, command: TabCommand) => Promise<OpenTabResult>;
  /** Runs the provider's OAuth login and returns the credential (default: the real flow with the command's UI). */
  oauthLogin?: (provider: OauthProvider, ui: LoginUi) => Promise<Record<string, unknown>>;
  /** Runs `claude auth logout` with the profile's env (default: the real CLI). */
  claudeLogout?: (env: NodeJS.ProcessEnv) => Promise<{ ok: boolean; message: string }>;
  loginHere?: (ctx: ExtensionCommandContext, claudeDir: string | undefined) => Promise<InheritResult>;
  /** Runs `gentle-accounts <profile> --session <file>` in this terminal (default: the real launcher). */
  relaunch?: (ctx: ExtensionCommandContext, args: string[]) => Promise<InheritResult>;
}

export const CLAUDE_LOGIN_CHOICES = ["In a new terminal tab", "In this terminal", "Show the command"] as const;
const RECOMMENDED = " (recommended)";

/** Asks where to log in, marking the recommended choice; resolves to the plain choice label (undefined when cancelled). */
async function askLoginChoice(ctx: ExtensionCommandContext, title: string, recommended: number): Promise<string | undefined> {
  const picked = await ctx.ui.select(title, CLAUDE_LOGIN_CHOICES.map((label, i) => (i === recommended ? label + RECOMMENDED : label)));
  return picked?.endsWith(RECOMMENDED) ? picked.slice(0, -RECOMMENDED.length) : picked;
}

const defaultOpenTab = (platform: NodeJS.Platform) => (cwd: string, command: TabCommand) =>
  openInNewTab({ env: process.env, platform, cwd, command, spawn: nodeSpawn as unknown as TabSpawn });

const defaultLoginHere = (platform: NodeJS.Platform) => (ctx: ExtensionCommandContext, claudeDir: string | undefined) =>
  runClaudeLoginHere(ctx as never, claudeDir, { spawn: nodeSpawn as unknown as InheritSpawn, signals: process, env: process.env, platform });

const defaultRelaunch = (platform: NodeJS.Platform) => (ctx: ExtensionCommandContext, args: string[]) =>
  runCommandHere(ctx as never, "gentle-accounts", args, { spawn: nodeSpawn as unknown as InheritSpawn, signals: process, env: process.env, platform });

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The panel: centered, about 60% of the available width (the chat column when the sidebar paints), at most 90% of
 * the height, one cell of margin. `minWidth` (columns) keeps it readable before the compact layout takes over.
 */
export const OVERLAY_OPTIONS = { anchor: "center", width: "60%", minWidth: 60, maxHeight: "90%", margin: 1 } as const;

/**
 * Where Gentle Shell publishes its fullscreen sidebar state on the terminal. This is the contract its own overlays
 * read (gentle-pi `lib/shell-sidebar.ts`, `SidebarState`: `active`, `ownsHost()`, `railColumns`). It is experimental
 * and not ours: when it is missing or changes shape the margin falls back to 0 and the panel centers on the terminal.
 */
const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
const SIDEBAR_PADDING = 1;

/**
 * Right margin that keeps the panel inside the chat column: the columns the Gentle Shell sidebar rail reserves
 * (`railColumns`, rail plus gap) plus one of padding while the rail paints. It is 0 without the sidebar and for
 * any absent, malformed or non-owning state; it never throws, so the menu always opens.
 */
export function sidebarRightMargin(terminal: unknown): number {
  if (typeof terminal !== "object" || terminal === null) return 0;
  const state = (terminal as Record<symbol, unknown>)[SIDEBAR_STATE] as { active?: unknown; ownsHost?: () => unknown; railColumns?: unknown } | undefined;
  if (typeof state !== "object" || state === null) return 0;
  if (state.active !== true || typeof state.ownsHost !== "function") return 0;
  const rail = state.railColumns;
  if (typeof rail !== "number" || !Number.isInteger(rail) || rail <= 0) return 0;
  try {
    return state.ownsHost() === true ? rail + SIDEBAR_PADDING : 0;
  } catch {
    return 0;
  }
}

/**
 * The overlay options with a live right margin: pi-tui re-reads `margin` on every layout, so the panel follows the
 * sidebar when the terminal is resized across its breakpoint while the menu stays open.
 */
export function menuOverlayOptions(getTerminal: () => unknown) {
  return {
    ...OVERLAY_OPTIONS,
    // Read at use time, so the first layout never sees a stale value (the terminal may not exist yet when pi resolves
    // the options) and a resize across the sidebar breakpoint is followed while the menu stays open.
    get margin() {
      const right = sidebarRightMargin(getTerminal());
      return right > 0 ? { top: 1, right, bottom: 1, left: 1 } : OVERLAY_OPTIONS.margin;
    },
    visible: () => true,
  };
}

/** Opens the "Account Usage" overlay (read-only, files only) and resolves when it closes. */
export async function showUsageBox(ctx: ExtensionCommandContext, store: ProfileStore, now: number = Date.now()): Promise<void> {
  let tuiRef: { terminal?: unknown } | undefined;
  const model = buildUsageModel(store, now);
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      tuiRef = tui as { terminal?: unknown } | undefined;
      return new UsageBoxPanel(model, theme, () => done(), { requestRender: () => (tui as { requestRender?: () => void } | undefined)?.requestRender?.() });
    },
    { overlay: true, overlayOptions: () => menuOverlayOptions(() => tuiRef?.terminal) },
  );
}

/**
 * Caller loop: opens the panel, executes the tagged action with the existing store functions and reopens
 * the panel with a feedback line (notifications are hidden behind the overlay). Ends on close.
 */
export async function runAccountsMenu(ctx: ExtensionCommandContext, deps: MenuDeps): Promise<void> {
  let selectedName: string | null | undefined;
  let row = 0;
  let feedback: Feedback | undefined;
  const platform = deps.platform ?? process.platform;
  const openTab = deps.openTab ?? defaultOpenTab(platform);
  const loginHere = deps.loginHere ?? defaultLoginHere(platform);
  const relaunch = deps.relaunch ?? defaultRelaunch(platform);
  const cwd = deps.cwd ?? (ctx as { cwd?: string }).cwd ?? process.cwd();
  for (;;) {
    const { store: s, liveAuthPath, sharedDir, session } = deps.context();
    const path = settingsPath(sharedDir);
    const model = buildMenuModel({
      store: s,
      liveAuthPath,
      showEmail: getShowEmail(path),
      usageBox: getUsageBox(path),
      sessionMode: session !== null,
      // Detection is for the global layout: a session home's auth.json is a private copy.
      loginProviders: loginProviders(ctx),
      detected: session === null ? detectLogins({ store: s, liveAuthPath, homeDir: deps.homeDir ?? homedir() }) : [],
      homeDir: deps.homeDir ?? homedir(),
      activeClaude: deps.activeClaude(s),
      selectedName,
      row,
      feedback,
    });
    let tuiRef: { terminal?: unknown } | undefined;
    const action = await ctx.ui.custom<MenuAction>(
      (tui, theme, _keybindings, done) => {
        tuiRef = tui as { terminal?: unknown } | undefined;
        return new AccountsMenuPanel(model, theme, done, { requestRender: () => (tui as { requestRender?: () => void } | undefined)?.requestRender?.() });
      },
      { overlay: true, overlayOptions: () => menuOverlayOptions(() => tuiRef?.terminal) },
    );
    if (!action || action.type === "close") return;
    selectedName = ("profile" in action ? action.profile : undefined) ?? selectedName;
    row = action.row;
    feedback = undefined;
    const set = (message: string, type: FeedbackType = "info") => {
      feedback = { message, type };
    };
    try {
      switch (action.type) {
        case "switch":
          await deps.flows.switchTo(ctx, s, liveAuthPath, action.profile, set);
          break;
        case "use": {
          // Already in a private session home: the switch is this session's own.
          if (session !== null) {
            await deps.flows.switchTo(ctx, s, liveAuthPath, action.profile, set);
            break;
          }
          if (platform === "win32") {
            set(`Using a profile for this session only is not supported on Windows yet. Open it in a new tab with o: gentle-accounts ${action.profile}`, "warning");
            break;
          }
          if (!ctx.isIdle()) {
            set("Wait for the current turn to finish before moving this chat to its own account.", "warning");
            break;
          }
          // pi's agent dir is fixed when it starts: the chat continues in a launcher session (private home) on the profile.
          const sessionFile = (ctx as { sessionManager?: { getSessionFile?: () => string | undefined } }).sessionManager?.getSessionFile?.();
          // Without a session file (an ephemeral chat) the conversation could not follow: refuse instead of losing it.
          if (!sessionFile) {
            set(`This chat has no session file, so it cannot continue on another account. Open the project with "${action.profile}" in a new tab with o: gentle-accounts ${action.profile}`, "warning");
            break;
          }
          const result = await relaunch(ctx, [action.profile, "--session", sessionFile]);
          if ("error" in result) {
            set(`Could not start gentle-accounts: ${errorText(result.error)}. Is it on your PATH?`, "error");
            break;
          }
          // A launcher that failed (unknown profile, killed) did not take the chat: keep this window and say so.
          if (result.code !== 0) {
            set(`gentle-accounts ended ${result.code === null ? `by ${result.signal ?? "a signal"}` : `with code ${result.code}`}; this window keeps its current account.`, "error");
            break;
          }
          // The chat lived on in the private session; this window still points at the shared account, so it ends with it.
          ctx.shutdown();
          return;
        }
        case "create": {
          const name = (await ctx.ui.input("New profile name", "work"))?.trim();
          if (!name) break;
          feedback = deps.flows.create(s, name);
          if (feedback.type === "info") {
            selectedName = name;
            row = 0;
          }
          break;
        }
        case "delete":
          feedback = await deps.flows.remove(ctx, s, action.profile);
          break;
        case "rename": {
          // The old name is prefilled: an empty, unchanged or cancelled answer is not a rename.
          const name = (await ctx.ui.input(`Rename profile "${action.profile}" to`, action.profile))?.trim();
          if (!name || name === action.profile) break;
          feedback = deps.flows.rename(s, action.profile, name);
          if (feedback.type === "info") {
            selectedName = name;
            await deps.refreshStatus(ctx, s);
          }
          break;
        }
        case "adopt": {
          const login = model.detected?.[0];
          if (!login) break;
          const suggestion = login.kind === "claude" ? "claude-home" : login.providers[0].replace(/^openai-/, "");
          const name = (await ctx.ui.input("Name for the detected login", suggestion))?.trim();
          if (!name) break;
          const result = adoptLogin({ store: s, liveAuthPath, env: process.env, login, name });
          set(result.message, result.ok ? "info" : "error");
          if (result.ok) {
            selectedName = name;
            row = 0;
            await deps.refreshStatus(ctx, s);
          }
          break;
        }
        case "logout": {
          if (action.provider === "claude") {
            const dir = s.claudeConfigEnv(action.profile);
            // On Claude Code's default folder every profile that uses it loses its login too: name them.
            const defaultDir = resolve(join(deps.homeDir ?? homedir(), ".claude"));
            const sharing = s.list().filter((name) => name !== action.profile && (s.claudeConfigEnv(name) === undefined || resolve(s.claudeConfigEnv(name) as string) === defaultDir));
            const shared = dir === undefined ? ` It uses Claude Code's default folder, so ${sharing.length ? `these profiles are logged out too: ${sharing.join(", ")}` : "every profile on it is logged out too"}.` : "";
            if (!(await ctx.ui.confirm("Log out", `Log Claude Code out of profile "${action.profile}" (claude auth logout)?${shared}`))) break;
            const result = await (deps.claudeLogout ?? runClaudeAuthLogout)(loginEnv(process.env, dir));
            set(result.ok ? `Logged Claude Code out of profile "${action.profile}".` : result.message, result.ok ? "info" : "error");
            if (result.ok) await deps.refreshStatus(ctx, s);
            break;
          }
          const ok = await ctx.ui.confirm("Log out", `Log "${action.provider}" out of profile "${action.profile}"? Its token is only forgotten on this machine.`);
          if (!ok) break;
          const result = logoutProvider({ store: s, liveAuthPath, profile: action.profile, provider: action.provider });
          set(result.message, result.ok ? "info" : "error");
          if (result.ok) await deps.refreshStatus(ctx, s);
          break;
        }
        case "startup": {
          const result = runStartupCommand(s, s.startup() === action.profile ? "last" : action.profile);
          set(result.message, result.ok ? "info" : "error");
          break;
        }
        case "email": {
          // Only the fixed S29 messages: the email itself is never echoed.
          const result = runEmailCommand(getShowEmail(path) ? "hide" : "show", path, "/gentle:accounts");
          set(result.message, result.type);
          if (result.changed) await deps.refreshStatus(ctx, s);
          break;
        }
        case "usage":
          // Only what was already seen; closing it reopens the menu on the same selection.
          if (getUsageBox(path)) await showUsageBox(ctx, s);
          break;
        case "login": {
          if (action.provider === "claude") {
            const dir = s.claudeConfigEnv(action.profile);
            const hint = loginHint(action.profile, claudeLoginCommand(dir, platform), platform);
            // The printed command is truncated in the panel: notify shows it in full.
            const print = (prefix = "") => {
              set(prefix + hint);
              ctx.ui.notify(hint, "info");
            };
            const choice = await askLoginChoice(ctx, `Log profile "${action.profile}" into Claude Code`, 0);
            if (choice === CLAUDE_LOGIN_CHOICES[0]) {
              const opened = await openTab(cwd, { argv: ["claude", "auth", "login"], env: { CLAUDE_CONFIG_DIR: dir ?? null } });
              if (opened.ok) {
                set(`Opened a new terminal tab (${opened.terminal}) to log profile "${action.profile}" into Claude Code. When it finishes, run /gentle:accounts current to see the account.`);
              } else print("Could not open a new terminal tab.\n");
            } else if (choice === CLAUDE_LOGIN_CHOICES[1]) {
              const result = await loginHere(ctx, dir);
              if ("error" in result) set(`Could not run claude auth login: ${errorText(result.error)}`, "error");
              else if (result.code === 0) set(`Claude Code login finished for profile "${action.profile}".`);
              else if (result.code === null) set(`claude auth login was stopped by ${result.signal ?? "a signal"}.`, "error");
              else set(`claude auth login exited with code ${result.code}.`, "error");
              await ctx.modelRegistry.refresh();
              await deps.refreshStatus(ctx, s);
            } else if (choice === CLAUDE_LOGIN_CHOICES[2]) print();
            break;
          }
          const label = PROVIDER_LABELS[action.provider] ?? action.provider;
          const oauth = (ctx.modelRegistry.getProvider(action.provider) as { auth?: { oauth?: OauthProvider } } | undefined)?.auth?.oauth;
          if (!oauth) {
            set(`${label} has no OAuth login here: run /login and choose it for the active profile.`, "warning");
            break;
          }
          // The same three choices as Claude Code: a new tab, this terminal, or the command to run by hand.
          const choice = await askLoginChoice(ctx, `Log profile "${action.profile}" into ${label}`, 1);
          if (choice === CLAUDE_LOGIN_CHOICES[0] || choice === CLAUDE_LOGIN_CHOICES[2]) {
            // Both start a session on the profile; its /login saves into that profile (the session home syncs it back).
            const hint = `Run this in ANOTHER terminal, then type /login and choose ${label}:\n\n  ${platform === "win32" ? "PS> " : "$ "}gentle-accounts ${action.profile}\n\nWhen it ends, the login stays in profile "${action.profile}".`;
            if (choice === CLAUDE_LOGIN_CHOICES[0]) {
              const opened = await openTab(cwd, { argv: ["gentle-accounts", action.profile], env: {} });
              if (opened.ok) set(`Opened "${action.profile}" in a new terminal tab (${opened.terminal}): type /login there and choose ${label}.`);
              else {
                set(`Could not open a new terminal tab.\n${hint}`);
                ctx.ui.notify(hint, "info");
              }
            } else {
              set(hint);
              ctx.ui.notify(hint, "info");
            }
            break;
          }
          if (choice !== CLAUDE_LOGIN_CHOICES[1]) break;
          // In this terminal: /login signs in the active profile, so make this one active first (the same switch the menu does).
          if (s.current() !== action.profile) {
            await deps.flows.switchTo(ctx, s, liveAuthPath, action.profile, set);
            if (s.current() !== action.profile) break;
          }
          try {
            const credential = await (deps.oauthLogin ?? runOauthLogin)(oauth, ctx.ui);
            saveCredential(liveAuthPath, s.authPath(action.profile), action.provider, credential);
            await ctx.modelRegistry.refresh();
            await deps.refreshStatus(ctx, s);
            set(`Logged ${label} into profile "${action.profile}".`);
          } catch (error) {
            set(`Could not log ${label} in: ${errorText(error)}`, "error");
          }
          break;
        }
        case "open": {
          const opened = await openTab(cwd, { argv: ["gentle-accounts", action.profile], env: {} });
          if (opened.ok) {
            set(`Opened "${action.profile}" in a new terminal tab (${opened.terminal}): gentle-accounts ${action.profile}`);
            break;
          }
          const message = `Open this project with "${action.profile}" in a new terminal: gentle-accounts ${action.profile}`;
          set(message);
          ctx.ui.notify(message, "info");
          break;
        }
      }
    } catch (error) {
      // A failing write (read-only folder, full disk...) is feedback inside the panel, never an aborted menu.
      set((error as Error).message || String(error), "error");
    }
  }
}
