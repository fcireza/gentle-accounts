import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { runClaudeLoginHere, type InheritResult, type InheritSpawn } from "../login-runner.ts";
import { openInNewTab, type OpenTabResult, type TabCommand, type TabSpawn } from "../terminal.ts";
import { PROVIDER_LABELS, type ClaudeAccount } from "../account.ts";
import { claudeLoginCommand, loginHint } from "../login.ts";
import { getShowEmail, runEmailCommand, settingsPath } from "../settings.ts";
import type { AgentContext } from "../session-home.ts";
import { runStartupCommand, type ProfileStore } from "../store.ts";
import { AccountsMenuPanel, type MenuAction } from "./panel.ts";
import { adoptLogin } from "../adopt.ts";
import { detectLogins } from "../detect.ts";
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
  loginHere?: (ctx: ExtensionCommandContext, claudeDir: string | undefined) => Promise<InheritResult>;
}

export const CLAUDE_LOGIN_CHOICES = ["In a new terminal tab", "In this terminal", "Show the command"] as const;

const defaultOpenTab = (platform: NodeJS.Platform) => (cwd: string, command: TabCommand) =>
  openInNewTab({ env: process.env, platform, cwd, command, spawn: nodeSpawn as unknown as TabSpawn });

const defaultLoginHere = (platform: NodeJS.Platform) => (ctx: ExtensionCommandContext, claudeDir: string | undefined) =>
  runClaudeLoginHere(ctx as never, claudeDir, { spawn: nodeSpawn as unknown as InheritSpawn, signals: process, env: process.env, platform });

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
  const cwd = deps.cwd ?? (ctx as { cwd?: string }).cwd ?? process.cwd();
  for (;;) {
    const { store: s, liveAuthPath, sharedDir, session } = deps.context();
    const path = settingsPath(sharedDir);
    const model = buildMenuModel({
      store: s,
      liveAuthPath,
      showEmail: getShowEmail(path),
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
        case "login": {
          if (action.provider === "claude") {
            const dir = s.claudeConfigEnv(action.profile);
            const hint = loginHint(action.profile, claudeLoginCommand(dir, platform), platform);
            // The printed command is truncated in the panel: notify shows it in full.
            const print = (prefix = "") => {
              set(prefix + hint);
              ctx.ui.notify(hint, "info");
            };
            const choice = await ctx.ui.select(`Log profile "${action.profile}" into Claude Code`, [...CLAUDE_LOGIN_CHOICES]);
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
          const active = s.current();
          if (active !== action.profile) {
            set(`/login signs in the active profile. Switch to "${action.profile}" first, then log ${label} in.`, "warning");
            break;
          }
          ctx.ui.setEditorText("/login");
          ctx.ui.notify(`Press Enter to run /login and choose ${label} for profile "${action.profile}".`, "info");
          return;
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
