// S30: a private agent home per launcher session, so several projects can run at the same time
// with a different account each. The home links every shared entry except the per-session ones.
import * as nodeFs from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ProfileStore, writeFileAtomic } from "./store.ts";
import { COVERED_PROVIDERS, readAuthFile, transferCovered, writeAuthFile, type AuthData } from "./auth-sync.ts";

export const SESSION_MARKER = ".gentle-accounts-session.json";
export const SESSION_CURRENT = ".gentle-accounts-current";

export type SessionFs = typeof nodeFs;

export interface SessionMarker {
  version: 1;
  sharedAgentDir: string;
  profile: string;
  pid: number;
  createdAt: string;
  /** pid of the gentle-shell started by the launcher, once spawned. */
  childPid?: number;
}

/** `<os.tmpdir()>/gentle-accounts`: parent of every session home. */
export function sessionBaseDir(): string {
  return join(tmpdir(), "gentle-accounts");
}

/** Shared entries a session home never links: its own auth/settings, lock and temp files, gentle markers. */
function skipEntry(name: string): boolean {
  return name === "auth.json" || name === "settings.json" || name.startsWith("auth.json.") || name.endsWith(".lock") || name.startsWith(".gentle-");
}

/** Local package sources become absolute; npm:, git:, https:, ssh: and absolute ones stay as they are. */
function absolutePackage(source: string, sharedAgentDir: string): string {
  if (isAbsolute(source) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source) || source.startsWith("~") || source.startsWith("git@")) return source;
  return resolve(sharedAgentDir, source);
}

function sessionSettings(raw: string, sharedAgentDir: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw; // pi reports an invalid file itself; never rewrite what we cannot parse
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return raw;
  const settings = { ...(data as Record<string, unknown>) };
  if (Array.isArray(settings.packages)) {
    settings.packages = settings.packages.map((entry: unknown) => {
      if (typeof entry === "string") return absolutePackage(entry, sharedAgentDir);
      if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
        const e = entry as { source: string };
        return { ...e, source: absolutePackage(e.source, sharedAgentDir) };
      }
      return entry;
    });
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Private auth.json: the shared live auth.json (keeps providers no profile covers, such as
 * github-copilot) with the covered providers of the profile. The global current profile takes
 * them from the shared live file (its freshest copy), any other profile from its snapshot.
 */
function sessionAuth(shared: ProfileStore, liveAuthPath: string, profile: string): AuthData {
  const live = readAuthFile(liveAuthPath);
  const snapshot = readAuthFile(shared.authPath(profile));
  if (shared.current() !== profile) return transferCovered(snapshot, live);
  // A closed session copies rotated tokens into the snapshot only, so the shared live copy may be older.
  const source: AuthData = {};
  for (const provider of COVERED_PROVIDERS) {
    const entry = pickFreshest(live[provider], snapshot[provider]);
    if (entry !== undefined) source[provider] = entry;
  }
  return transferCovered(source, live);
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

export interface BuildOptions {
  sharedAgentDir: string;
  profile: string;
  baseDir?: string;
  platform?: NodeJS.Platform;
  fs?: SessionFs;
  pid?: number;
  id?: string;
}

export function buildSessionHome(options: BuildOptions): { home: string; marker: SessionMarker } {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;
  const shared = fs.realpathSync(options.sharedAgentDir);
  const base = options.baseDir ?? sessionBaseDir();
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const home = join(base, options.id ?? randomUUID());
  fs.mkdirSync(home, { mode: 0o700 });
  // Everything is read before the home gets credentials, so a corrupt file leaves an empty home only.
  const store = new ProfileStore(shared);
  const auth = sessionAuth(store, join(shared, "auth.json"), options.profile);

  for (const name of fs.readdirSync(shared)) {
    if (skipEntry(name)) continue;
    const target = join(shared, name);
    const link = join(home, name);
    const isDir = fs.statSync(target).isDirectory();
    if (platform !== "win32") {
      fs.symlinkSync(target, link);
    } else if (isDir) {
      fs.symlinkSync(target, link, "junction"); // absolute target: junctions need no privilege
    } else {
      try {
        fs.linkSync(target, link);
      } catch {
        fs.copyFileSync(target, link);
      }
    }
  }

  writeAuthFile(join(home, "auth.json"), auth);
  const settingsPath = join(shared, "settings.json");
  if (fs.existsSync(settingsPath)) {
    // pi resolves relative package paths against the agent dir as it was given (before realpath):
    // through a symlinked path (macOS /tmp -> /private/tmp) the canonical dir would point elsewhere.
    const given = resolve(options.sharedAgentDir);
    fs.writeFileSync(join(home, "settings.json"), sessionSettings(fs.readFileSync(settingsPath, "utf8"), given), { mode: 0o600 });
  }
  fs.writeFileSync(join(home, SESSION_CURRENT), `${options.profile}\n`, { mode: 0o600 });
  const marker: SessionMarker = {
    version: 1,
    sharedAgentDir: shared,
    profile: options.profile,
    pid: options.pid ?? process.pid,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(join(home, SESSION_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return { home, marker };
}

/** The marker of a session home; null when missing, unreadable or not a version 1 marker. */
export function readSessionMarker(dir: string): SessionMarker | null {
  try {
    const data = JSON.parse(nodeFs.readFileSync(join(dir, SESSION_MARKER), "utf8")) as Partial<SessionMarker> | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (data.version !== 1 || typeof data.sharedAgentDir !== "string" || typeof data.profile !== "string" || typeof data.pid !== "number") return null;
    return data as SessionMarker;
  } catch {
    return null;
  }
}

/** Records the spawned gentle-shell pid in the marker (atomic rewrite, other fields kept); never throws. */
export function recordSessionChildPid(home: string, childPid: number): void {
  try {
    const marker = readSessionMarker(home);
    if (!marker) return;
    writeFileAtomic(join(home, SESSION_MARKER), `${JSON.stringify({ ...marker, childPid }, null, 2)}\n`);
  } catch {
    // Best effort: without it the sweeper only knows the launcher pid.
  }
}

/** The session's current profile name (trimmed), or null when absent or empty. */
export function readSessionCurrent(home: string): string | null {
  try {
    return nodeFs.readFileSync(join(home, SESSION_CURRENT), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Copies the covered providers of `H/auth.json` back into the snapshot of the session's current
 * profile, then removes the home. A failure is reported and keeps the home and its auth.json.
 */
export function finishSessionHome(
  home: string,
  options: { sharedAgentDir: string; stderr?: (line: string) => void; platform?: NodeJS.Platform; fs?: SessionFs },
): boolean {
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  const store = new ProfileStore(options.sharedAgentDir);
  const profile = readSessionCurrent(home) ?? readSessionMarker(home)?.profile ?? null;
  try {
    if (!profile) throw new Error("the session has no current profile");
    store.assertExists(profile);
    const live = readAuthFile(join(home, "auth.json"));
    const snapshot = readAuthFile(store.authPath(profile));
    // Same freshness rule as the build: another session on this profile may have saved a newer token.
    const merged: AuthData = { ...snapshot };
    for (const provider of COVERED_PROVIDERS) {
      if (provider in live) merged[provider] = pickFreshest(live[provider], snapshot[provider]);
      else delete merged[provider]; // the user logged this provider out inside the session
    }
    writeAuthFile(store.authPath(profile), merged);
  } catch (error) {
    stderr(`gentle-accounts: cannot save the session credentials of "${profile ?? "unknown"}": ${(error as Error).message}; they are kept in ${join(home, "auth.json")}`);
    return false;
  }
  removeSessionHome(home, options);
  return true;
}

/** Removes a home without following links: unlink links and files, rmdir junctions and directories. */
export function removeSessionHome(home: string, options: { platform?: NodeJS.Platform; fs?: SessionFs } = {}): void {
  const fs = options.fs ?? nodeFs;
  const remove = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const path = join(dir, name);
      const stat = fs.lstatSync(path);
      if (stat.isSymbolicLink()) {
        try {
          fs.unlinkSync(path);
        } catch {
          fs.rmdirSync(path); // a junction on Windows
        }
      } else if (stat.isDirectory()) {
        remove(path);
      } else {
        fs.unlinkSync(path);
      }
    }
    fs.rmdirSync(dir);
  };
  remove(home);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

/** Finishes every home whose launcher is gone; unreadable markers are left alone. Returns the swept homes. */
export function sweepSessionHomes(baseDir: string = sessionBaseDir(), isAlive: (pid: number) => boolean = pidAlive, stderr?: (line: string) => void): string[] {
  let names: string[];
  try {
    names = nodeFs.readdirSync(baseDir);
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const name of names) {
    const home = join(baseDir, name);
    const marker = readSessionMarker(home);
    // In use while the launcher or its gentle-shell runs (an orphan survives a kill -9 of the launcher).
    if (!marker || isAlive(marker.pid) || (typeof marker.childPid === "number" && isAlive(marker.childPid))) continue;
    if (finishSessionHome(home, { sharedAgentDir: marker.sharedAgentDir, stderr })) swept.push(home);
  }
  return swept;
}

export interface AgentContext {
  /** Shared agent dir: profiles, snapshots, Claude dirs, startup and settings. */
  sharedDir: string;
  store: ProfileStore;
  liveAuthPath: string;
  session: SessionMarker | null;
}

/** Session mode when `agentDir` holds a marker; otherwise today's global layout. */
export function resolveContext(agentDir: string): AgentContext {
  const session = readSessionMarker(agentDir);
  if (session) {
    return {
      sharedDir: session.sharedAgentDir,
      store: new ProfileStore(session.sharedAgentDir, { currentPath: join(agentDir, SESSION_CURRENT) }),
      liveAuthPath: join(agentDir, "auth.json"),
      session,
    };
  }
  return { sharedDir: agentDir, store: new ProfileStore(agentDir), liveAuthPath: join(agentDir, "auth.json"), session: null };
}
