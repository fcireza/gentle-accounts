import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ClaudeAccount {
  email: string;
  name?: string;
}

function readAccountFile(path: string): ClaudeAccount | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!data || typeof data !== "object") return null;
    const oauth = (data as { oauthAccount?: unknown }).oauthAccount;
    if (!oauth || typeof oauth !== "object") return null;
    const { emailAddress, displayName } = oauth as { emailAddress?: unknown; displayName?: unknown };
    if (typeof emailAddress !== "string" || !emailAddress) return null;
    return typeof displayName === "string" && displayName ? { email: emailAddress, name: displayName } : { email: emailAddress };
  } catch {
    return null;
  }
}

/**
 * Reads the Claude Code account (email and optional display name) of a Claude config dir.
 * Only `oauthAccount.emailAddress`/`displayName` are returned; never throws.
 * For the default `<home>/.claude` dir it falls back to `<home>/.claude.json`.
 */
export function readClaudeAccount(claudeDir: string, homeDir: string): ClaudeAccount | null {
  try {
    const own = readAccountFile(join(claudeDir, ".claude.json"));
    if (own) return own;
    if (resolve(claudeDir) === resolve(join(homeDir, ".claude"))) return readAccountFile(join(homeDir, ".claude.json"));
    return null;
  } catch {
    return null;
  }
}

export function statusText(profile: string, account: { email: string } | null): string {
  return `${profile} · ${account ? account.email : "not logged in"}`;
}
