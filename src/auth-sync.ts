import { existsSync, readFileSync } from "node:fs";
import { ProfileStore, isAlreadyExistsError, writeFileAtomic } from "./store.ts";

/** pi auth.json providers whose credentials belong to a profile. */
export const COVERED_PROVIDERS = ["openai-codex", "anthropic"] as const;

export type AuthData = Record<string, unknown>;
export type Env = Record<string, string | undefined>;

export function readAuthFile(path: string): AuthData {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as AuthData;
    throw new Error("not a JSON object");
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${(error as Error).message}`);
  }
}

/** Write then rename, so a reader never sees a partial file; pi reloads auth.json by file revision. */
export function writeAuthFile(path: string, data: AuthData): void {
  writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Copies the covered provider entries of `source` into `target`, removing entries absent in `source`. */
export function transferCovered(source: AuthData, target: AuthData): AuthData {
  const next: AuthData = { ...target };
  for (const provider of COVERED_PROVIDERS) {
    if (provider in source) next[provider] = source[provider];
    else delete next[provider];
  }
  return next;
}

/** Fails (before any state changes) when the target profile's auth.json is unreadable. */
export function assertProfileReadable(store: ProfileStore, name: string): void {
  store.assertExists(name);
  readAuthFile(store.authPath(name));
}

export interface SwitchOptions {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  to: string;
}

export type SwitchResult = { status: "switched" | "noop"; from: string | null; to: string };

/**
 * Snapshot the active profile's live credentials, load the target profile's credentials into
 * pi's live auth.json, point CLAUDE_CONFIG_DIR at the target's Claude dir and record it as current.
 */
export function switchProfile({ store, liveAuthPath, env, to }: SwitchOptions): SwitchResult {
  store.assertExists(to);
  const from = store.current();
  if (from === to) return { status: "noop", from, to };

  // Read every file before writing any, so a corrupt file fails without touching the others.
  const live = readAuthFile(liveAuthPath);
  const incoming = readAuthFile(store.authPath(to));
  const outgoing = from ? readAuthFile(store.authPath(from)) : null;
  if (from && outgoing) {
    writeAuthFile(store.authPath(from), transferCovered(live, outgoing));
  }
  writeAuthFile(liveAuthPath, transferCovered(incoming, live));
  applyClaudeConfigEnv(env, store.claudeConfigEnv(to));
  store.setCurrent(to);
  return { status: "switched", from, to };
}

/** Sets CLAUDE_CONFIG_DIR, or deletes it for undefined (never assigns the string "undefined"). */
export function applyClaudeConfigEnv(env: Env, value: string | undefined): void {
  if (value === undefined) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = value;
}

/**
 * On load: make the bridge use the current profile's Claude login unless the user forced a dir.
 * A profile on Claude Code's default dir leaves the environment alone.
 */
export function applyCurrentProfileEnv(store: ProfileStore, env: Env): string | null {
  const current = store.current();
  if (!current) return null;
  const value = store.claudeConfigEnv(current);
  if (value !== undefined && !env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = value;
  return current;
}

/**
 * No active profile yet: wrap the existing login into a `default` profile so a later switch
 * snapshots it instead of dropping it. A user-set CLAUDE_CONFIG_DIR is recorded (not copied);
 * otherwise the profile keeps Claude Code's default dir with the variable unset, because
 * setting it to `<home>/.claude` loses the macOS keychain login.
 */
export function ensureDefaultProfile({ store, liveAuthPath, env }: Omit<SwitchOptions, "to">): string | null {
  if (store.current()) return null;
  if (!store.exists("default")) {
    const live = readAuthFile(liveAuthPath); // before create: a corrupt file leaves no stray profile
    const userDir = env.CLAUDE_CONFIG_DIR;
    let created = true;
    try {
      store.create("default", userDir ? { claudeDir: userDir } : { claudeDefault: true });
    } catch (error) {
      // Another session created it first (S30): theirs wins, nothing is overwritten.
      if (!isAlreadyExistsError(error)) throw error;
      created = false;
    }
    if (created) writeAuthFile(store.authPath("default"), transferCovered(live, {}));
  }
  store.setCurrent("default");
  applyClaudeConfigEnv(env, store.claudeConfigEnv("default"));
  return "default";
}

/** Set by the launcher in gentle-shell's env: an explicit `gentle-accounts <name>` launch wins over the startup profile. */
export const LAUNCH_PROFILE_ENV = "GENTLE_ACCOUNTS_LAUNCH_PROFILE";

export type StartupResult = { status: "switched" | "same" | "none" | "missing"; from: string | null; to: string | null };

/**
 * Session start: when a startup profile is set and is not the active one, switch to it with the
 * same safe switch as a manual switch (target read first, so a corrupt file changes nothing).
 */
export function applyStartupProfile({ store, liveAuthPath, env }: Omit<SwitchOptions, "to">): StartupResult {
  const from = store.current();
  const to = store.startup();
  if (!to) {
    const raw = store.startupRaw();
    return raw ? { status: "missing", from, to: raw } : { status: "none", from, to: null };
  }
  if (to === from) return { status: "same", from, to };
  assertProfileReadable(store, to);
  switchProfile({ store, liveAuthPath, env, to });
  return { status: "switched", from, to };
}
