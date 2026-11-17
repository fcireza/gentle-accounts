import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";
import { PLUGIN_LABEL, queryClaudeAccount, statusText, type ClaudeStatusRunner } from "./account.ts";
import { ProfileStore, MISSING_PROFILE_MESSAGE, validateProfileName } from "./store.ts";
import { applyCurrentProfileEnv, assertProfileReadable, ensureDefaultProfile, switchProfile } from "./auth-sync.ts";
import { claudeLoginCommand, loginHint } from "./login.ts";

const USAGE = [
  "/gentle:accounts                 pick a profile and switch to it",
  "/gentle:accounts <name>          switch to <name>",
  "/gentle:accounts list            list profiles (* marks the active one)",
  "/gentle:accounts current         show the active profile",
  "/gentle:accounts create <name>   create an empty profile",
  "/gentle:accounts delete <name>   delete a profile (asks for confirmation)",
  "/gentle:accounts login claude    show the command that logs the active profile into Claude Code",
].join("\n");

const SUBCOMMANDS = ["list", "current", "create", "delete", "login"];

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  ctx.ui.notify(message, type);
}

const STATUS_KEY = PLUGIN_LABEL;
const REFRESH_MS = 60_000;
const UNSET_DIR = "(unset: Claude Code default)";

type StatusCtx = { hasUI?: boolean; ui?: { setStatus?: (key: string, text: string | undefined) => void } };
type TimerHandle = { unref?: () => unknown };

/** Test seams; pi calls the factory with the API only. */
export interface ExtensionDeps {
  runClaudeStatus?: ClaudeStatusRunner;
  setInterval?: (fn: () => void, ms: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}

function displayDir(store: ProfileStore, name: string): string {
  return store.claudeConfigEnv(name) ?? UNSET_DIR;
}

export default function gentleProfiles(pi: ExtensionAPI, deps: ExtensionDeps = {}): void {
  const store = () => new ProfileStore(getAgentDir());
  const liveAuthPath = () => join(getAgentDir(), "auth.json");
  const startTimer = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopTimer = deps.clearInterval ?? ((handle: TimerHandle) => clearInterval(handle as ReturnType<typeof setInterval>));

  let generation = 0;
  let inFlight: string | null = null;
  let timer: TimerHandle | undefined;
  let lastCtx: StatusCtx | undefined;

  /**
   * Shows `gentle-accounts: <profile> · <masked email>`; never throws. A refresh for the profile
   * already being computed is skipped, and a result for an older request is dropped.
   */
  async function updateStatus(ctx: StatusCtx, s: ProfileStore): Promise<void> {
    try {
      if (!ctx?.hasUI || !ctx.ui?.setStatus) return;
      lastCtx = ctx;
      const current = s.current();
      if (current && inFlight === current) return;
      const gen = ++generation;
      if (!current) {
        inFlight = null;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      inFlight = current;
      try {
        const account = await queryClaudeAccount({ claudeConfigDir: s.claudeConfigEnv(current), homeDir: homedir(), run: deps.runClaudeStatus });
        if (gen !== generation || s.current() !== current) return;
        ctx.ui.setStatus(STATUS_KEY, statusText(current, account));
      } finally {
        if (gen === generation) inFlight = null;
      }
    } catch {
      // The status line is cosmetic; never break the caller.
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const s = store();
    try {
      if (ensureDefaultProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env }) === null) {
        applyCurrentProfileEnv(s, process.env);
      }
    } catch (error) {
      // A corrupt auth.json must not break session start; the user still gets a clear message.
      ctx.ui.notify(`${PLUGIN_LABEL}: ${(error as Error).message}`, "error");
      return;
    }
    if (!timer) {
      timer = startTimer(() => {
        if (lastCtx) void updateStatus(lastCtx, store());
      }, REFRESH_MS);
      timer.unref?.();
    }
    await updateStatus(ctx, s);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await updateStatus(ctx, store());
  });

  pi.on("session_shutdown", () => {
    if (timer) stopTimer(timer);
    timer = undefined;
    lastCtx = undefined;
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
        try {
          s.create(arg);
          notify(ctx, `Created profile "${arg}". Switch with /gentle:accounts ${arg}, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.`);
        } catch (error) {
          notify(ctx, (error as Error).message, "error");
        }
        return;
      }
      if (sub === "delete") {
        if (!arg) return notify(ctx, USAGE, "warning");
        if (!s.exists(arg)) return notify(ctx, MISSING_PROFILE_MESSAGE(arg), "error");
        if (s.current() === arg) {
          return notify(ctx, `Cannot delete the active profile "${arg}". Switch to another profile first.`, "error");
        }
        if (!ctx.hasUI) return notify(ctx, "Deleting needs a confirmation dialog; run it from the TUI.", "error");
        const ok = await ctx.ui.confirm("Delete profile", `Delete profile "${arg}" and its Claude login and credentials? This cannot be undone.`);
        if (!ok) return notify(ctx, "Delete cancelled.");
        try {
          s.delete(arg);
          notify(ctx, `Deleted profile "${arg}".`);
        } catch (error) {
          notify(ctx, (error as Error).message, "error");
        }
        return;
      }
      if (sub === "login") {
        if (arg !== "claude") return notify(ctx, USAGE, "warning");
        const current = s.current();
        if (!current) return notify(ctx, "No active profile.", "error");
        notify(ctx, loginHint(current, claudeLoginCommand(s.claudeConfigEnv(current))));
        return;
      }
      if (sub === "help" || sub === "--help") return notify(ctx, USAGE);

      let target = sub;
      if (!target) {
        const names = s.list();
        if (!names.length) return notify(ctx, "No profiles. Create one with /gentle:accounts create <name>", "warning");
        if (!ctx.hasUI) return notify(ctx, USAGE, "warning");
        const current = s.current();
        const picked = await ctx.ui.select("Switch profile", names.map((n) => (n === current ? `${n} (active)` : n)));
        if (!picked) return;
        target = picked.replace(/ \(active\)$/, "");
      }
      const invalid = validateProfileName(target);
      if (invalid) return notify(ctx, invalid, "error");
      if (!s.exists(target)) return notify(ctx, MISSING_PROFILE_MESSAGE(target), "error");
      if (!ctx.isIdle()) return notify(ctx, "Wait for the current turn to finish before switching profiles.", "warning");
      try {
        assertProfileReadable(s, target); // atomic: nothing is created if the target is corrupt
        // Never drop a live login that no profile holds yet (same rule as the launcher).
        ensureDefaultProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env });
        const result = switchProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env, to: target });
        if (result.status === "noop") return notify(ctx, `Already on profile "${target}".`);
        await ctx.modelRegistry.refresh();
        notify(ctx, `Switched to profile "${target}". Claude Code dir: ${displayDir(s, target)}`);
        await updateStatus(ctx, s);
      } catch (error) {
        notify(ctx, (error as Error).message, "error");
      }
    },
  });
}
