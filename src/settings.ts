import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./store.ts";

export type Settings = Record<string, unknown>;

/** `<agentDir>/profiles/settings.json`. */
export function settingsPath(agentDir: string): string {
  return join(agentDir, "profiles", "settings.json");
}

/** Missing, empty, invalid or non-object files read as `{}`; never throws and never rewrites. */
export function readSettings(path: string): Settings {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Settings) : {};
  } catch {
    return {};
  }
}

/** Only a literal `true` shows the full email. */
export function getShowEmail(path: string): boolean {
  return readSettings(path).showEmail === true;
}

/** Writes `showEmail` atomically (temp file then rename, mode 0600), keeping every other key. */
export function setShowEmail(path: string, value: boolean): void {
  const next: Settings = { ...readSettings(path), showEmail: value };
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
}

export interface EmailCommandResult {
  message: string;
  type: "info" | "warning" | "error";
  changed: boolean;
}

/**
 * Shared by `/gentle:accounts email` and `gentle-accounts email`; `usagePrefix` names the command.
 * `arg` is everything after `email`, so extra words after a mode fall through to the usage.
 */
export function runEmailCommand(arg: string, path: string, usagePrefix: string): EmailCommandResult {
  if (!arg) {
    return {
      message: getShowEmail(path) ? "Email display: shown (full email in the status bar)" : "Email display: hidden (not shown in the status bar)",
      type: "info",
      changed: false,
    };
  }
  if (arg === "show" || arg === "hide") {
    try {
      setShowEmail(path, arg === "show");
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "unknown error";
      return { message: `Could not save the email display setting (${code}).`, type: "error", changed: false };
    }
    return arg === "show"
      ? { message: "Email display set to shown. The status bar shows the full email.", type: "info", changed: true }
      : { message: "Email display set to hidden. The status bar does not show the email.", type: "info", changed: true };
  }
  return { message: `Usage: ${usagePrefix} email [show|hide]`, type: "warning", changed: false };
}

/** The per-account usage box is on by default: only a literal `false` disables it. */
export function getUsageBox(path: string): boolean {
  return readSettings(path).usageBox !== false;
}

/** Writes `usageBox` atomically (temp file then rename, mode 0600), keeping every other key. */
export function setUsageBox(path: string, value: boolean): void {
  const next: Settings = { ...readSettings(path), usageBox: value };
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Shared by `gentle-accounts usage` and `/gentle:accounts usage on|off`; `usagePrefix` names the command. An empty
 * `arg` reports the setting (the slash command opens the box instead and never passes it). Fixed messages only.
 */
export function runUsageCommand(arg: string, path: string, usagePrefix: string): EmailCommandResult {
  if (!arg) return { message: `Account usage box: ${getUsageBox(path) ? "enabled" : "disabled"}`, type: "info", changed: false };
  if (arg === "on" || arg === "off") {
    try {
      setUsageBox(path, arg === "on");
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "unknown error";
      return { message: `Could not save the account usage setting (${code}).`, type: "error", changed: false };
    }
    return arg === "on"
      ? { message: "Account usage box enabled.", type: "info", changed: true }
      : { message: "Account usage box disabled. The native Gentle Shell usage is unchanged.", type: "info", changed: true };
  }
  return { message: `Usage: ${usagePrefix} usage [on|off]`, type: "warning", changed: false };
}
