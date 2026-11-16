import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { ProfileStore, MISSING_PROFILE_MESSAGE, validateProfileName } from "./store.ts";
import { applyCurrentProfileEnv, ensureDefaultProfile, switchProfile } from "./auth-sync.ts";
import { claudeLoginCommand } from "./login.ts";

const USAGE = [
  "/profile                 pick a profile and switch to it",
  "/profile <name>          switch to <name>",
  "/profile list            list profiles (* marks the active one)",
  "/profile current         show the active profile",
  "/profile create <name>   create an empty profile",
  "/profile delete <name>   delete a profile (asks for confirmation)",
  "/profile login claude    show the command that logs the active profile into Claude Code",
].join("\n");

const SUBCOMMANDS = ["list", "current", "create", "delete", "login"];

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  ctx.ui.notify(message, type);
}

export default function gentleProfiles(pi: ExtensionAPI): void {
  const store = () => new ProfileStore(getAgentDir());
  const liveAuthPath = () => join(getAgentDir(), "auth.json");

  pi.on("session_start", () => {
    const s = store();
    if (ensureDefaultProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env }) === null) {
      applyCurrentProfileEnv(s, process.env);
    }
  });

  pi.registerCommand("profile", {
    description: "Switch between account profiles (claude-bridge, openai-codex, anthropic)",
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
        notify(ctx, names.length ? names.map((n) => `${n === current ? "* " : "  "}${n}`).join("\n") : "No profiles. Create one with /profile create <name>");
        return;
      }
      if (sub === "current") {
        const current = s.current();
        notify(ctx, current ? `Active profile: ${current} (CLAUDE_CONFIG_DIR=${s.claudeDir(current)})` : "No active profile.");
        return;
      }
      if (sub === "create") {
        if (!arg) return notify(ctx, USAGE, "warning");
        try {
          s.create(arg);
          notify(ctx, `Created profile "${arg}". Switch with /profile ${arg}, then /login for Codex or Anthropic and /profile login claude for Claude.`);
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
        notify(ctx, `Run this in another terminal to log profile "${current}" into Claude Code:\n${claudeLoginCommand(s.claudeDir(current))}`);
        return;
      }
      if (sub === "help" || sub === "--help") return notify(ctx, USAGE);

      let target = sub;
      if (!target) {
        const names = s.list();
        if (!names.length) return notify(ctx, "No profiles. Create one with /profile create <name>", "warning");
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
        const result = switchProfile({ store: s, liveAuthPath: liveAuthPath(), env: process.env, to: target });
        if (result.status === "noop") return notify(ctx, `Already on profile "${target}".`);
        await ctx.modelRegistry.refresh();
        notify(ctx, `Switched to profile "${target}". Claude Code dir: ${s.claudeDir(target)}`);
      } catch (error) {
        notify(ctx, (error as Error).message, "error");
      }
    },
  });
}
