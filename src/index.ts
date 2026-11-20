import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PLUGIN_LABEL, type ClaudeStatusRunner } from "./account.ts";
import { createStatusBar, type TimerHandle } from "./status-bar.ts";
import { ProfileStore, MISSING_PROFILE_MESSAGE, SESSION_PROFILE_DELETE_MESSAGE, runStartupCommand, validateProfileName } from "./store.ts";
import { LAUNCH_PROFILE_ENV, applyCurrentProfileEnv, applyStartupProfile, assertProfileReadable, ensureDefaultProfile, switchProfile } from "./auth-sync.ts";
import { menuAvailable, runAccountsMenu, type MenuFlows, type Report } from "./menu/run.ts";
import type { Feedback } from "./menu/view.ts";
import { claudeLoginCommand, loginHint } from "./login.ts";
import { getShowEmail, runEmailCommand, settingsPath } from "./settings.ts";
import { resolveContext } from "./session-home.ts";

const USAGE = [
  "/gentle:accounts                 open the accounts menu (picker without the TUI)",
  "/gentle:accounts menu            open the accounts menu",
  "/gentle:accounts <name>          switch to <name>",
  "/gentle:accounts list            list profiles (* marks the active one)",
  "/gentle:accounts current         show the active profile",
  "/gentle:accounts create <name>   create an empty profile",
  "/gentle:accounts delete <name>   delete a profile (asks for confirmation)",
  "/gentle:accounts login claude    show the command that logs the active profile into Claude Code",
  "/gentle:accounts session [<name>|last]  show, set or clear the profile new sessions start on (alias: startup)",
  "/gentle:accounts email [show|hide]      show or set whether the status bar shows the full email",
].join("\n");

const SUBCOMMANDS = ["menu", "list", "current", "create", "delete", "login", "session", "startup", "email"];

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  ctx.ui.notify(message, type);
}

const UNSET_DIR = "(unset: Claude Code default)";

/** Test seams; pi calls the factory with the API only. */
export interface ExtensionDeps {
  runClaudeStatus?: ClaudeStatusRunner;
  setInterval?: (fn: () => void, ms: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}

function displayDir(store: ProfileStore, name: string): string {
  return store.claudeConfigEnv(name) ?? UNSET_DIR;
}

export interface SwitchFlowOptions {
  ctx: ExtensionCommandContext;
  store: ProfileStore;
  liveAuthPath: string;
  target: string;
  report: Report;
  refreshStatus: () => Promise<void>;
}

/**
 * The one safe switch of `/gentle:accounts <name>` and the menu: name and existence checks, the idle rule,
 * an atomic readability check, the default-profile guard, the switch, the model registry and status refresh.
 */
export async function switchFlow({ ctx, store: s, liveAuthPath, target, report, refreshStatus }: SwitchFlowOptions): Promise<void> {
  const invalid = validateProfileName(target);
  if (invalid) return report(invalid, "error");
  if (!s.exists(target)) return report(MISSING_PROFILE_MESSAGE(target), "error");
  if (!ctx.isIdle()) return report("Wait for the current turn to finish before switching profiles.", "warning");
  try {
    assertProfileReadable(s, target); // atomic: nothing is created if the target is corrupt
    // Never drop a live login that no profile holds yet (same rule as the launcher).
    ensureDefaultProfile({ store: s, liveAuthPath, env: process.env });
    const result = switchProfile({ store: s, liveAuthPath, env: process.env, to: target });
    if (result.status === "noop") return report(`Already on profile "${target}".`);
    await ctx.modelRegistry.refresh();
    report(`Switched to profile "${target}". Claude Code dir: ${displayDir(s, target)}`);
    await refreshStatus();
  } catch (error) {
    report((error as Error).message, "error");
  }
}

/** `create <name>`: the same messages for the command and the menu. */
export function createFlow(s: ProfileStore, name: string): Feedback {
  try {
    s.create(name);
    return {
      message: `Created profile "${name}". Switch with /gentle:accounts ${name}, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.`,
      type: "info",
    };
  } catch (error) {
    return { message: (error as Error).message, type: "error" };
  }
}

/** `delete <name>`: refusals, confirmation and removal, shared by the command and the menu. */
export async function deleteFlow(ctx: ExtensionCommandContext, s: ProfileStore, name: string): Promise<Feedback> {
  if (!s.exists(name)) return { message: MISSING_PROFILE_MESSAGE(name), type: "error" };
  if (s.current() === name) return { message: `Cannot delete the active profile "${name}". Switch to another profile first.`, type: "error" };
  if (s.startup() === name) return { message: SESSION_PROFILE_DELETE_MESSAGE(name), type: "error" };
  if (!ctx.hasUI) return { message: "Deleting needs a confirmation dialog; run it from the TUI.", type: "error" };
  const ok = await ctx.ui.confirm("Delete profile", `Delete profile "${name}" and its Claude login and credentials? This cannot be undone.`);
  if (!ok) return { message: "Delete cancelled.", type: "info" };
  try {
    s.delete(name);
    return { message: `Deleted profile "${name}".`, type: "info" };
  } catch (error) {
    return { message: (error as Error).message, type: "error" };
  }
}

export const COMMAND_FLOWS = {
  create: createFlow,
  remove: deleteFlow,
} as const;

export default function gentleProfiles(pi: ExtensionAPI, deps: ExtensionDeps = {}): void {
  // S30: in a launcher session home the profiles stay shared while auth.json and the current profile are private.
  const context = () => resolveContext(getAgentDir());
  const store = () => context().store;
  const liveAuthPath = () => context().liveAuthPath;
  const showEmail = () => getShowEmail(settingsPath(context().sharedDir));
  const startTimer = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopTimer = deps.clearInterval ?? ((handle: TimerHandle) => clearInterval(handle as ReturnType<typeof setInterval>));

  const statusBar = createStatusBar({ store, showEmail, runClaudeStatus: deps.runClaudeStatus, startTimer, stopTimer });
  const updateStatus = statusBar.update;

  pi.on("session_start", async (event, ctx) => {
    const { store: s, session } = context();
    try {
      if (ensureDefaultProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env }) === null) {
        applyCurrentProfileEnv(s, process.env);
      }
    } catch (error) {
      // A corrupt auth.json must not break session start; the user still gets a clear message.
      ctx.ui.notify(`${PLUGIN_LABEL}: ${(error as Error).message}`, "error");
      return;
    }
    try {
      // An explicit `gentle-accounts <name>` launch already switched: it wins over the startup profile.
      // Only the process start applies it: /new, /resume, /fork and /reload keep a profile the user switched to by hand.
      const reason = (event as { reason?: string } | undefined)?.reason;
      // A session home (S30) never applies it: the launcher already chose the profile of that session.
      if (!session && !process.env[LAUNCH_PROFILE_ENV] && (reason === undefined || reason === "startup")) {
        // The env of the last used profile is already applied; a switch replaces it (set or delete).
        const started = applyStartupProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env });
        if (started.status === "switched") ctx.ui.notify(`Started on profile "${started.to}" (session profile).`, "info");
        if (started.status === "missing") {
          ctx.ui.notify(`Session profile "${started.to}" does not exist; starting on the last used profile.`, "warning");
        }
      }
    } catch (error) {
      // A corrupt startup profile leaves everything as it was; the session keeps the last used one.
      ctx.ui.notify(`${PLUGIN_LABEL}: ${(error as Error).message}`, "error");
    }
    statusBar.start();
    await updateStatus(ctx, s);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await updateStatus(ctx, store());
  });

  pi.on("session_shutdown", () => {
    statusBar.stop();
  });

  pi.registerCommand("gentle:accounts", {
    description: "gentle-accounts: switch between account profiles (claude-bridge, openai-codex, anthropic)",
    getArgumentCompletions: (prefix) => {
      const names = [...SUBCOMMANDS, ...store().list()].filter((n) => n.startsWith(prefix));
      return names.length ? names.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const s = store();
      const [sub = "", arg = ""] = args.trim().split(/\s+/);

      if (sub === "list") {
        const current = s.current();
        const names = s.list();
        notify(ctx, names.length ? names.map((n) => `${n === current ? "* " : "  "}${n}`).join("\n") : "No profiles. Create one with /gentle:accounts create <name>");
        return;
      }
      if (sub === "current") {
        const current = s.current();
        notify(ctx, current ? `Active profile: ${current} (CLAUDE_CONFIG_DIR=${displayDir(s, current)})` : "No active profile.");
        await updateStatus(ctx, s);
        return;
      }
      if (sub === "create") {
        if (!arg) return notify(ctx, USAGE, "warning");
        const result = createFlow(s, arg);
        return notify(ctx, result.message, result.type);
      }
      if (sub === "delete") {
        if (!arg) return notify(ctx, USAGE, "warning");
        const result = await deleteFlow(ctx, s, arg);
        return notify(ctx, result.message, result.type);
      }
      if (sub === "login") {
        if (arg !== "claude") return notify(ctx, USAGE, "warning");
        const current = s.current();
        if (!current) return notify(ctx, "No active profile.", "error");
        notify(ctx, loginHint(current, claudeLoginCommand(s.claudeConfigEnv(current))));
        return;
      }
      if (sub === "session" || sub === "startup") {
        const result = runStartupCommand(s, arg);
        return notify(ctx, result.message, result.ok ? "info" : "error");
      }
      if (sub === "email") {
        // Never echoes the email: only the fixed S29 messages.
        const result = runEmailCommand(args.trim().split(/\s+/).slice(1).join(" "), settingsPath(context().sharedDir), "/gentle:accounts");
        notify(ctx, result.message, result.type);
        if (result.changed) await updateStatus(ctx, s);
        return;
      }
      if (sub === "help" || sub === "--help") return notify(ctx, USAGE);

      if (sub === "menu" || !sub) {
        if (menuAvailable(ctx)) {
          return runAccountsMenu(ctx, {
            context,
            flows: {
              ...COMMAND_FLOWS,
              switchTo: (c, st, live, target, report) => switchFlow({ ctx: c, store: st, liveAuthPath: live, target, report, refreshStatus: () => updateStatus(c, st) }),
            } satisfies MenuFlows,
            refreshStatus: (c, st) => updateStatus(c, st),
            activeClaude: (st) => statusBar.cachedAccount(st),
          });
        }
      }

      let target = sub;
      if (!target || target === "menu") {
        const names = s.list();
        if (!names.length) return notify(ctx, "No profiles. Create one with /gentle:accounts create <name>", "warning");
        if (!ctx.hasUI) return notify(ctx, USAGE, "warning");
        const current = s.current();
        const picked = await ctx.ui.select("Switch profile", names.map((n) => (n === current ? `${n} (active)` : n)));
        if (!picked) return;
        target = picked.replace(/ \(active\)$/, "");
      }
      await switchFlow({ ctx, store: s, liveAuthPath: liveAuthPath(), target, report: (m, t) => notify(ctx, m, t), refreshStatus: () => updateStatus(ctx, s) });
    },
  });
}
