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
  type: "info" | "warning";
  changed: boolean;
}

/** Shared by `/gentle:accounts email` and `gentle-accounts email`; `usagePrefix` names the command. */
export function runEmailCommand(arg: string, path: string, usagePrefix: string): EmailCommandResult {
  if (!arg) {
    return {
      message: getShowEmail(path) ? "Email display: shown (full email in the status bar)" : "Email display: hidden (masked in the status bar)",
      type: "info",
      changed: false,
    };
  }
  if (arg === "show") {
    setShowEmail(path, true);
    return { message: "Email display set to shown. The status bar shows the full email.", type: "info", changed: true };
  }
  if (arg === "hide") {
    setShowEmail(path, false);
    return { message: "Email display set to hidden. The status bar shows a masked email.", type: "info", changed: true };
  }
  return { message: `Usage: ${usagePrefix} email [show|hide]`, type: "warning", changed: false };
}
