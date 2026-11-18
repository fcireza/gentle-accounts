import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { PROVIDER_LABELS, type ClaudeAccount } from "../account.ts";
import { claudeLoginCommand, loginHint } from "../login.ts";
import { getShowEmail, runEmailCommand, settingsPath } from "../settings.ts";
import type { AgentContext } from "../session-home.ts";
import { runStartupCommand, type ProfileStore } from "../store.ts";
import { AccountsMenuPanel, type MenuAction } from "./panel.ts";
import { buildMenuModel, type Feedback, type FeedbackType } from "./view.ts";

export type Report = (message: string, type?: FeedbackType) => void;

/** The command's own flows (they live in src/index.ts with its messages), reused here so nothing is duplicated. */
export interface MenuFlows {
  switchTo: (ctx: ExtensionCommandContext, store: ProfileStore, liveAuthPath: string, target: string, report: Report) => Promise<void>;
  create: (store: ProfileStore, name: string) => Feedback;
  remove: (ctx: ExtensionCommandContext, store: ProfileStore, name: string) => Promise<Feedback>;
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
}

export const OVERLAY_OPTIONS = { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } as const;

/**
 * Caller loop: opens the panel, executes the tagged action with the existing store functions and reopens
 * the panel with a feedback line (notifications are hidden behind the overlay). Ends on close.
 */
export async function runAccountsMenu(ctx: ExtensionCommandContext, deps: MenuDeps): Promise<void> {
  let selectedName: string | null | undefined;
  let row = 0;
  let feedback: Feedback | undefined;
  for (;;) {
    const { store: s, liveAuthPath, session, sharedDir } = deps.context();
    const path = settingsPath(sharedDir);
    const model = buildMenuModel({
      store: s,
      liveAuthPath,
      session: session !== null,
      showEmail: getShowEmail(path),
      homeDir: deps.homeDir ?? homedir(),
      activeClaude: deps.activeClaude(s),
      selectedName,
      row,
      feedback,
    });
    const action = await ctx.ui.custom<MenuAction>(
      (tui, theme, _keybindings, done) =>
        new AccountsMenuPanel(model, theme, done, { requestRender: () => (tui as { requestRender?: () => void } | undefined)?.requestRender?.() }),
      { overlay: true, overlayOptions: { ...OVERLAY_OPTIONS } },
    );
    if (!action || action.type === "close") return;
    selectedName = action.profile ?? selectedName;
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
          // T21 replaces these stubs with real runners (S32).
          if (action.provider === "claude") {
            set(loginHint(action.profile, claudeLoginCommand(s.claudeConfigEnv(action.profile), deps.platform), deps.platform));
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
        case "open":
          set(`Open this project with "${action.profile}" in a new terminal: gentle-accounts ${action.profile}`);
          break;
      }
    } catch (error) {
      // A failing write (read-only folder, full disk...) is feedback inside the panel, never an aborted menu.
      set((error as Error).message || String(error), "error");
    }
  }
}
