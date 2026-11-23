import { existsSync, readFileSync } from "node:fs";
import { ProfileStore, isAlreadyExistsError, writeFileAtomic } from "./store.ts";
import { isAuthLinked, pointAuthAt, resolveAuthTarget } from "./auth-link.ts";

/** Base providers whose credentials always belong to a profile, whatever the entry type. */
export const COVERED_PROVIDERS = ["openai-codex", "anthropic"] as const;

export type AuthData = Record<string, unknown>;

/** True for an oauth credential entry; malformed entries (null, strings, arrays) are not oauth. */
export function isOauthEntry(entry: unknown): boolean {
  return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) && (entry as { type?: unknown }).type === "oauth";
}

/**
 * Providers whose entries belong to a profile (S34): the base set plus every provider stored as oauth in
 * any of `sources`. Other providers (api keys such as google) stay global.
 */
export function coveredProviders(...sources: AuthData[]): string[] {
  const covered: string[] = [...COVERED_PROVIDERS];
  for (const source of sources) {
    for (const [provider, entry] of Object.entries(source)) {
      if (!covered.includes(provider) && isOauthEntry(entry)) covered.push(provider);
    }
  }
  return covered;
}
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
  // A linked auth.json is written through to its target: the rename must not replace the link.
  writeFileAtomic(resolveAuthTarget(path), `${JSON.stringify(data, null, 2)}\n`);
}

/** Copies the covered provider entries of `source` into `target`, removing entries absent in `source`. */
export function transferCovered(source: AuthData, target: AuthData): AuthData {
  const next: AuthData = { ...target };
  for (const provider of coveredProviders(source, target)) {
    if (provider in source) next[provider] = source[provider];
    else delete next[provider];
  }
  return next;
}

/**
 * The profile file `own` with the global entries of `live` (non-covered providers, e.g. api keys) added: the live
 * ones win on a conflict, an entry only `own` has is kept, nothing is deleted. Always a new object; key order is
 * `own`'s, then the live entries it lacked.
 */
export function withGlobalEntries(live: AuthData, own: AuthData): AuthData {
  const covered = coveredProviders(live, own);
  const next: AuthData = { ...own };
  for (const [provider, entry] of Object.entries(live)) if (!covered.includes(provider)) next[provider] = entry;
  return next;
}

/** Fails (before any state changes) when the target profile's auth.json is unreadable. */
export function assertProfileReadable(store: ProfileStore, name: string): void {
  store.assertExists(name);
  readAuthFile(store.authPath(name));
}

function oauthExpires(entry: unknown): number | null {
  const e = entry as { type?: unknown; expires?: unknown } | null | undefined;
  return e && typeof e === "object" && e.type === "oauth" && typeof e.expires === "number" && Number.isFinite(e.expires) ? e.expires : null;
}

/**
 * The fresher of two credential entries of one provider, whole (fields are never mixed): the oauth
 * entry with the larger numeric `expires`; otherwise (ties, api keys, no expiry) `preferred`.
 * A missing side yields the other one.
 */
export function pickFreshest<T>(preferred: T | undefined, other: T | undefined): T | undefined {
  if (preferred === undefined) return other;
  if (other === undefined) return preferred;
  const a = oauthExpires(preferred);
  const b = oauthExpires(other);
  return a !== null && b !== null && b > a ? other : preferred;
}

/**
 * Outgoing snapshot after a switch: each covered provider of `live` replaces the snapshot entry
 * unless the snapshot holds a fresher oauth token (another session may have rotated it); a covered
 * provider absent from `live` is removed.
 */
function snapshotOutgoing(live: AuthData, outgoing: AuthData, incoming: AuthData): AuthData {
  const next: AuthData = { ...outgoing };
  for (const provider of coveredProviders(live, outgoing, incoming)) {
    if (provider in live) next[provider] = pickFreshest(live[provider], outgoing[provider]);
    else delete next[provider];
  }
  return next;
}

export interface SwitchOptions {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  to: string;
  /** Test seam: called after the first read of the incoming file and right before the second one. */
  beforeProfileWrite?: () => void;
}

export type SwitchResult = { status: "switched" | "noop"; from: string | null; to: string };

/**
 * Snapshot the active profile's live credentials, load the target profile's credentials into
 * pi's live auth.json, point CLAUDE_CONFIG_DIR at the target's Claude dir and record it as current.
 */
export function switchProfile({ store, liveAuthPath, env, to, beforeProfileWrite }: SwitchOptions): SwitchResult {
  store.assertExists(to);
  const from = store.current();
  if (from === to) return { status: "noop", from, to };

  if (isAuthLinked(liveAuthPath)) return switchLinked({ store, liveAuthPath, env, to, beforeProfileWrite }, from);

  // Read every file before writing any, so a corrupt file fails without touching the others.
  const live = readAuthFile(liveAuthPath);
  const incoming = readAuthFile(store.authPath(to));
  const outgoing = from ? readAuthFile(store.authPath(from)) : null;
  if (from && outgoing) {
    writeAuthFile(store.authPath(from), snapshotOutgoing(live, outgoing, incoming));
  }
  writeAuthFile(liveAuthPath, transferCovered(incoming, live));
  applyClaudeConfigEnv(env, store.claudeConfigEnv(to));
  store.setCurrent(to);
  return { status: "switched", from, to };
}

/**
 * Switch on a linked auth.json (S1, S2): the link already is the outgoing profile's file, so rotated
 * tokens are in place and nothing is copied back. The non-OAuth entries (api keys) are global: the live
 * ones win over the incoming file's on a conflict, and an api key only the incoming file has is kept (a
 * switch never deletes a key), then the link moves. Every file is read before any write; the incoming file is read once more right before its write.
 */
function switchLinked({ store, liveAuthPath, env, to, beforeProfileWrite }: SwitchOptions, from: string | null): SwitchResult {
  const live = readAuthFile(liveAuthPath);
  const incoming = readAuthFile(store.authPath(to));
  if (JSON.stringify(withGlobalEntries(live, incoming)) !== JSON.stringify(incoming)) {
    beforeProfileWrite?.();
    // Read again right before writing: another live session may have rotated its token since the first read (no lock, the window only narrows).
    const fresh = readAuthFile(store.authPath(to));
    const next = withGlobalEntries(live, fresh);
    if (JSON.stringify(next) !== JSON.stringify(fresh)) writeAuthFile(store.authPath(to), next);
  }
  pointAuthAt(liveAuthPath, store.authPath(to));
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
