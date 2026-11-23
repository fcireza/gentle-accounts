// S30: a private agent home per launcher session, so several projects can run at the same time
// with a different account each. The home links every shared entry except the per-session ones.
import * as nodeFs from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ProfileStore, writeFileAtomic } from "./store.ts";
import { isAuthLinked, pointAuthAt } from "./auth-link.ts";
import { coveredProviders, pickFreshest, readAuthFile, transferCovered, writeAuthFile, type AuthData } from "./auth-sync.ts";

export { pickFreshest };

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

/** Parent of every session home: `<os.tmpdir()>/gentle-accounts-<uid>` on POSIX, `<os.tmpdir()>/gentle-accounts` on Windows. */
export function sessionBaseDir(): string {
  return join(tmpdir(), typeof process.getuid === "function" ? `gentle-accounts-${process.getuid()}` : "gentle-accounts");
}

export interface BaseDirOptions {
  fs?: SessionFs;
  platform?: NodeJS.Platform;
  /** Expected owner; defaults to the current uid (test seam for a foreign owner). */
  uid?: number;
}

/**
 * Creates the base dir (0700) when missing and refuses it unless it is a real directory owned by
 * the current user and not group or world writable (POSIX). Throws `gentle-accounts: refusing to use <path>: <reason>`.
 */
export function ensureBaseDir(base: string, options: BaseDirOptions = {}): void {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;
  if (!fs.existsSync(base) && !isLink(fs, base)) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const refuse = (reason: string) => new Error(`gentle-accounts: refusing to use ${base}: ${reason}`);
  const stat = fs.lstatSync(base);
  if (stat.isSymbolicLink()) throw refuse("it is a symbolic link");
  if (!stat.isDirectory()) throw refuse("it is not a directory");
  if (platform === "win32") return;
  const uid = options.uid ?? process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) throw refuse("it is owned by another user");
  if (stat.mode & 0o022) throw refuse("it is group or world writable");
}

function isLink(fs: SessionFs, path: string): boolean {
  try {
    return fs.lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
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

function sessionSettings(raw: string, sharedAgentDir: string, path: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    // Without a valid settings.json the home would silently load no packages: fail before building.
    throw new Error(`gentle-accounts: cannot read ${path}: ${(error as Error).message}`);
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
 * Private auth.json: the shared live auth.json (keeps providers no profile covers: api keys
 * such as google) with the covered providers of the profile. The global current profile takes
 * them from the shared live file (its freshest copy), any other profile from its snapshot.
 */
function sessionAuth(shared: ProfileStore, liveAuthPath: string, profile: string): AuthData {
  const live = readAuthFile(liveAuthPath);
  const snapshot = readAuthFile(shared.authPath(profile));
  if (shared.current() !== profile) return transferCovered(snapshot, live);
  // A closed session copies rotated tokens into the snapshot only, so the shared live copy may be older.
  const source: AuthData = {};
  for (const provider of coveredProviders(live, snapshot)) {
    const entry = pickFreshest(live[provider], snapshot[provider]);
    if (entry !== undefined) source[provider] = entry;
  }
  return transferCovered(source, live);
}

/** Fails with `gentle-accounts: cannot read <path>: <message>` when the shared settings.json is not valid JSON; a missing file is fine. */
export function assertSharedSettingsReadable(sharedAgentDir: string): void {
  const path = join(nodeFs.realpathSync(sharedAgentDir), "settings.json");
  if (nodeFs.existsSync(path)) sessionSettings(nodeFs.readFileSync(path, "utf8"), resolve(sharedAgentDir), path);
}

export interface BuildOptions {
  sharedAgentDir: string;
  profile: string;
  baseDir?: string;
  platform?: NodeJS.Platform;
  fs?: SessionFs;
  pid?: number;
  id?: string;
  /** Expected owner of the base dir (test seam). */
  uid?: number;
}

/**
 * The profile file with the shared file's global (non-covered, e.g. api key) entries added, the shared ones
 * winning on a conflict and nothing deleted; null when that changes nothing.
 */
function withGlobalEntries(live: AuthData, own: AuthData): AuthData | null {
  const covered = coveredProviders(live, own);
  const next: AuthData = { ...own };
  for (const [provider, entry] of Object.entries(live)) if (!covered.includes(provider)) next[provider] = entry;
  return JSON.stringify(next) !== JSON.stringify(own) ? next : null;
}

export function buildSessionHome(options: BuildOptions): { home: string; marker: SessionMarker } {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;
  const shared = fs.realpathSync(options.sharedAgentDir);
  // Everything is read before the home exists, so a corrupt file builds nothing.
  const store = new ProfileStore(shared);
  const auth = sessionAuth(store, join(shared, "auth.json"), options.profile);
  // POSIX: the home links to the profile file, which first gets the global (non-covered) entries of the shared live file.
  let linked: AuthData | null = null;
  // A profile without its file yet (the first-run `default`) has nothing to link to: it keeps the copy.
  if (platform !== "win32" && store.exists(options.profile)) {
    linked = withGlobalEntries(readAuthFile(join(shared, "auth.json")), readAuthFile(store.authPath(options.profile)));
  }
  const settingsPath = join(shared, "settings.json");
  // pi resolves relative package paths against the agent dir as it was given (before realpath):
  // through a symlinked path (macOS /tmp -> /private/tmp) the canonical dir would point elsewhere.
  const settings = fs.existsSync(settingsPath) ? sessionSettings(fs.readFileSync(settingsPath, "utf8"), resolve(options.sharedAgentDir), settingsPath) : null;
  const base = options.baseDir ?? sessionBaseDir();
  ensureBaseDir(base, { fs, platform, uid: options.uid });
  const home = join(base, options.id ?? randomUUID());
  fs.mkdirSync(home, { mode: 0o700 });
  try {
    for (const name of fs.readdirSync(shared)) {
      if (skipEntry(name)) continue;
      linkEntry(fs, platform, join(shared, name), join(home, name));
    }
    let isLinked = false;
    if (platform !== "win32" && store.exists(options.profile)) {
      try {
        if (fs === nodeFs) pointAuthAt(join(home, "auth.json"), store.authPath(options.profile));
        else fs.symlinkSync(store.authPath(options.profile), join(home, "auth.json"));
        isLinked = true;
      } catch {
        // S3: any failure keeps the private copy below.
      }
    }
    // The link exists first: a failed link leaves the profile file as it was (copy fallback). Writes go through the link.
    if (isLinked && linked !== null) {
      // Read again right before writing: another session on this profile may have rotated its token since the first read.
      const fresh = withGlobalEntries(readAuthFile(join(shared, "auth.json")), readAuthFile(store.authPath(options.profile)));
      if (fresh !== null) writeAuthFile(store.authPath(options.profile), fresh);
    }
    if (!isLinked) writeAuthFile(join(home, "auth.json"), auth);
    if (settings !== null) fs.writeFileSync(join(home, "settings.json"), settings, { mode: 0o600 });
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
  } catch (error) {
    try {
      removeSessionHome(home, { platform, fs });
    } catch {
      // Best effort: the original error is the one worth reporting.
    }
    throw error;
  }
}

/**
 * Links one shared entry, classified with lstat so a link is never followed: a symlink entry (even a
 * dangling one) becomes a symlink to it; on Windows real directories become junctions and files
 * fall back to a hard link, then a copy.
 */
function linkEntry(fs: SessionFs, platform: NodeJS.Platform, target: string, link: string): void {
  const stat = fs.lstatSync(target);
  if (platform !== "win32") {
    fs.symlinkSync(target, link);
  } else if (stat.isDirectory()) {
    fs.symlinkSync(target, link, "junction"); // absolute target: junctions need no privilege
  } else if (stat.isSymbolicLink()) {
    fs.symlinkSync(target, link, "file");
  } else {
    try {
      fs.linkSync(target, link);
    } catch {
      fs.copyFileSync(target, link);
    }
  }
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
    // A linked home already wrote through to the profile file: nothing to copy back.
    if (isAuthLinked(join(home, "auth.json"))) {
      removeSessionHome(home, options);
      return true;
    }
    const live = readAuthFile(join(home, "auth.json"));
    const snapshot = readAuthFile(store.authPath(profile));
    // Same freshness rule as the build: another session on this profile may have saved a newer token.
    const merged: AuthData = { ...snapshot };
    for (const provider of coveredProviders(live, snapshot)) {
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
export function sweepSessionHomes(
  baseDir: string = sessionBaseDir(),
  isAlive: (pid: number) => boolean = pidAlive,
  stderr: (line: string) => void = (line) => console.error(line),
  options: BaseDirOptions & { sharedAgentDir?: string } = {},
): string[] {
  const fs = options.fs ?? nodeFs;
  if (!fs.existsSync(baseDir) && !isLink(fs, baseDir)) return [];
  try {
    ensureBaseDir(baseDir, options); // never trust markers in a dir someone else controls
  } catch (error) {
    stderr((error as Error).message);
    return [];
  }
  let shared: string | undefined;
  try {
    shared = options.sharedAgentDir === undefined ? undefined : fs.realpathSync(options.sharedAgentDir);
  } catch {
    shared = resolve(options.sharedAgentDir!);
  }
  const swept: string[] = [];
  for (const name of fs.readdirSync(baseDir)) {
    const home = join(baseDir, name);
    const marker = readSessionMarker(home);
    // In use while the launcher or its gentle-shell runs (an orphan survives a kill -9 of the launcher).
    if (!marker || isAlive(marker.pid) || (typeof marker.childPid === "number" && isAlive(marker.childPid))) continue;
    if (shared !== undefined && marker.sharedAgentDir !== shared) {
      stderr(`gentle-accounts: leaving ${home}: it belongs to another agent dir (${marker.sharedAgentDir})`);
      continue;
    }
    if (finishSessionHome(home, { sharedAgentDir: marker.sharedAgentDir, stderr })) swept.push(home);
  }
  return swept;
}

/**
 * The session homes of live launcher sessions that use `profile` of `sharedAgentDir`: the launcher or its gentle-shell
 * is alive and the session's own current file (or, without one, its marker) names the profile. Read only: it never
 * creates the base dir, and a base dir someone else controls is not trusted, so it reports no sessions.
 */
export function liveSessionHomesOn(
  profile: string,
  sharedAgentDir: string,
  baseDir: string = sessionBaseDir(),
  isAlive: (pid: number) => boolean = pidAlive,
  options: BaseDirOptions = {},
): string[] {
  const fs = options.fs ?? nodeFs;
  if (!fs.existsSync(baseDir)) return [];
  try {
    ensureBaseDir(baseDir, options);
  } catch {
    return [];
  }
  let shared: string;
  try {
    shared = fs.realpathSync(sharedAgentDir);
  } catch {
    shared = resolve(sharedAgentDir);
  }
  const homes: string[] = [];
  for (const name of fs.readdirSync(baseDir)) {
    const home = join(baseDir, name);
    const marker = readSessionMarker(home);
    if (!marker || marker.sharedAgentDir !== shared) continue;
    if (!isAlive(marker.pid) && !(typeof marker.childPid === "number" && isAlive(marker.childPid))) continue;
    if ((readSessionCurrent(home) ?? marker.profile) === profile) homes.push(home);
  }
  return homes;
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
