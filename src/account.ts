import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyClaudeConfigEnv, type Env } from "./auth-sync.ts";

/** Plugin label shown in front of every status text. */
export const PLUGIN_LABEL = "gentle-accounts";

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

/** Keeps the first min(4, max(1, local - 3)) chars of the local part, then `****`, then `@domain`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "****";
  const local = email.slice(0, at);
  const keep = Math.min(4, Math.max(1, local.length - 3));
  return `${local.slice(0, keep)}****${email.slice(at)}`;
}

export function statusText(profile: string, account: { email: string } | null): string {
  return `${PLUGIN_LABEL}: ${profile} · ${account ? maskEmail(account.email) : "not logged in"}`;
}

/** Runs `claude auth status` with the given env and resolves its stdout; rejects when no output is usable. */
export type ClaudeStatusRunner = (env: Env) => Promise<string>;

export const runClaudeAuthStatus: ClaudeStatusRunner = (env) =>
  new Promise((resolveOut, reject) => {
    execFile(
      "claude",
      ["auth", "status"],
      { env: env as NodeJS.ProcessEnv, timeout: 5000, shell: process.platform === "win32", windowsHide: true },
      (error, stdout) => {
        const out = String(stdout ?? "");
        // A non-zero exit that still printed JSON is a valid answer (for example "not logged in").
        if (error && (error.killed || !out.trim())) reject(error);
        else resolveOut(out);
      },
    );
  });

/** Parses `claude auth status` output: an account, null (CLI says logged out), or undefined (no answer). */
function parseAuthStatus(stdout: string): ClaudeAccount | null | undefined {
  try {
    const data = JSON.parse(stdout.trim()) as unknown;
    if (!data || typeof data !== "object") return undefined;
    const { loggedIn, email } = data as { loggedIn?: unknown; email?: unknown };
    if (loggedIn === true && typeof email === "string" && email) return { email };
    if (loggedIn === false) return null;
    return undefined;
  } catch {
    return undefined;
  }
}

export interface QueryOptions {
  /** CLAUDE_CONFIG_DIR of the profile; undefined means Claude Code's default dir (variable unset). */
  claudeConfigDir: string | undefined;
  homeDir: string;
  run?: ClaudeStatusRunner;
}

/**
 * Asks `claude auth status` first; when the CLI is missing, times out or prints no usable JSON,
 * falls back to the `.claude.json` reader. Never throws.
 */
export async function queryClaudeAccount({ claudeConfigDir, homeDir, run = runClaudeAuthStatus }: QueryOptions): Promise<ClaudeAccount | null> {
  try {
    const env: Env = { ...process.env };
    applyClaudeConfigEnv(env, claudeConfigDir);
    const answer = parseAuthStatus(await run(env));
    if (answer !== undefined) return answer;
  } catch {
    // Fall through to the file reader.
  }
  return readClaudeAccount(claudeConfigDir ?? join(homeDir, ".claude"), homeDir);
}
