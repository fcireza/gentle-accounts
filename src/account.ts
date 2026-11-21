import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyClaudeConfigEnv, coveredProviders, type AuthData, type Env } from "./auth-sync.ts";

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

/** Masks the name of an email for display, keeping the `@` and the domain as they are (`fci****@gmail.com`). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  const name = at === -1 ? email : email.slice(0, at);
  return `${name.slice(0, 3)}****${at === -1 ? "" : email.slice(at)}`;
}

export interface StatusTextOptions {
  /** Print the full email instead of hiding it (S29); default false. */
  showEmail?: boolean;
  /** Colors the text with the theme's colors; plain text without it. */
  theme?: { fg(color: string, text: string): string };
}

export function statusText(profile: string, account: { email: string } | null, options: StatusTextOptions = {}): string {
  const fg = options.theme?.fg.bind(options.theme) ?? ((_color: string, text: string) => text);
  const icon = account ? "👤" : "🔒";
  const base = `${icon} ${fg("muted", `${PLUGIN_LABEL}:`)} ${fg("accent", profile)}`;
  if (!account) return `${base} ${fg("muted", "·")} ${fg("warning", "not logged in")}`;
  return options.showEmail === true ? `${base} ${fg("muted", "·")} ${fg("text", account.email)}` : base;
}

/** Menu labels of the providers a profile covers (S31); unknown covered providers show their id. */
export const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Bridge",
  "openai-codex": "Codex",
  anthropic: "Anthropic",
};

/**
 * Best-effort email of a pi oauth credential, read locally and never verified: an `email` field, or the `email`
 * claim of the access or id token (OpenAI nests it under its profile claim). undefined when none is found.
 */
export function credentialEmail(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const valid = (v: unknown): string | undefined => (typeof v === "string" && /^[^\s@]+@[^\s@]+$/.test(v) ? v : undefined);
  const direct = valid(e.email);
  if (direct) return direct;
  for (const field of ["idToken", "id_token", "access"]) {
    const token = e[field];
    if (typeof token !== "string") continue;
    const part = token.split(".")[1];
    if (!part) continue;
    try {
      const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
      const nested = claims["https://api.openai.com/profile"] as { email?: unknown } | undefined;
      const found = valid(claims.email) ?? valid(nested?.email);
      if (found) return found;
    } catch {
      // not a JWT: try the next field
    }
  }
  return undefined;
}

export interface ProviderState {
  /** `claude` or a covered pi provider id. */
  provider: string;
  label: string;
  loggedIn: boolean;
  /** Full email, only when the S29 setting shows it; absent when not logged in or unknown. */
  email?: string;
}

/**
 * Provider rows of one profile for the accounts menu: Claude from an already known account (never spawns),
 * then every covered pi provider, logged in when its entry is present in `auth` (the live file for the active
 * profile, the snapshot for the others). `options.providers` adds providers known elsewhere (another profile, the
 * live file or the `/login` list, named by `options.labels`) so every profile lists the same rows, logged out where it has no entry. Never returns tokens.
 */
export function providerStates(claude: ClaudeAccount | null, auth: AuthData, options: StatusTextOptions & { providers?: string[]; labels?: Record<string, string> } = {}): ProviderState[] {
  const rows: ProviderState[] = [
    claude
      ? { provider: "claude", label: PROVIDER_LABELS.claude, loggedIn: true, ...(options.showEmail === true ? { email: claude.email } : {}) }
      : { provider: "claude", label: PROVIDER_LABELS.claude, loggedIn: false },
  ];
  const known = coveredProviders(auth);
  for (const provider of options.providers ?? []) if (!known.includes(provider)) known.push(provider);
  for (const provider of known) {
    const entry = auth[provider];
    const loggedIn = Boolean(entry && typeof entry === "object");
    const email = loggedIn && options.showEmail === true ? credentialEmail(entry) : undefined;
    rows.push({ provider, label: PROVIDER_LABELS[provider] ?? options.labels?.[provider] ?? provider, loggedIn, ...(email ? { email } : {}) });
  }
  return rows;
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

/** Runs `claude auth logout` with the given env; resolves whether it exited cleanly (the CLI's own message is dropped). */
export type ClaudeLogoutRunner = (env: Env) => Promise<{ ok: boolean; message: string }>;

export const runClaudeAuthLogout: ClaudeLogoutRunner = (env) =>
  new Promise((resolveOut) => {
    execFile("claude", ["auth", "logout"], { env: env as NodeJS.ProcessEnv, timeout: 15000, shell: process.platform === "win32", windowsHide: true }, (error) => {
      resolveOut(error ? { ok: false, message: error.killed ? "claude auth logout timed out" : `claude auth logout failed (${(error as { code?: unknown }).code ?? error.message})` } : { ok: true, message: "" });
    });
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
