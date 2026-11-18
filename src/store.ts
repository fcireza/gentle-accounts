import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LOCK_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Windows refuses to replace a file that another process has open for a moment: retry briefly, then rethrow. */
export function renameWithRetry(rename: (from: string, to: string) => void, from: string, to: string, attempts = 10): void {
  for (let attempt = 0; ; attempt++) {
    try {
      return rename(from, to);
    } catch (error) {
      if (attempt >= attempts || !LOCK_ERRORS.has((error as { code?: string } | null)?.code ?? "")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
    }
  }
}

/**
 * Writes through a unique temp file (`<path>.<pid>.<random>.tmp`) then renames, so a reader never
 * sees a partial file and two processes writing at once never share a temp name.
 */
export function writeFileAtomic(path: string, data: string, mode = 0o600): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, data, { mode });
  try {
    renameWithRetry(renameSync, tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** True for the "already exists" error of `create`, also when another process won the race. */
export function isAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "EEXIST";
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const INVALID_NAME_MESSAGE = (name: string): string =>
  `Invalid profile name "${name}": use lowercase letters, digits, "-" or "_" (max 32 chars).`;

export const MISSING_PROFILE_MESSAGE = (name: string): string => `Profile "${name}" does not exist.`;

export const STARTUP_DELETE_MESSAGE = (name: string): string =>
  `Cannot delete the startup profile "${name}". Set another one or clear it with "startup last" first.`;

/** Subcommands of `/gentle:accounts` and the CLI: a profile with one of these names could never be switched to by name. */
export const RESERVED_NAMES: readonly string[] = ["menu", "list", "current", "create", "delete", "login", "startup", "email", "help"];

export const RESERVED_NAME_MESSAGE = (name: string): string =>
  `"${name}" is a reserved word (it is a subcommand). Pick another profile name.`;

/** Name rules for a new profile: the S7 rules plus the reserved subcommand words. Existing profiles are not affected. */
export function validateNewProfileName(name: string): string | null {
  return validateProfileName(name) ?? (RESERVED_NAMES.includes(name) ? RESERVED_NAME_MESSAGE(name) : null);
}

/** Returns null when the name is valid, otherwise the exact user-facing error message. */
export function validateProfileName(name: string): string | null {
  return NAME_RE.test(name) ? null : INVALID_NAME_MESSAGE(name);
}

/**
 * Filesystem layout under the pi agent dir:
 *   <agentDir>/profiles/<name>/claude/     CLAUDE_CONFIG_DIR for claude-bridge
 *   <agentDir>/profiles/<name>/auth.json   pi credentials snapshot of that profile
 *   <agentDir>/profiles/<name>/claude-dir  optional: explicit CLAUDE_CONFIG_DIR of the profile
 *   <agentDir>/profiles/<name>/claude-default  marker: use Claude Code's default dir (variable unset)
 *   <agentDir>/profiles/current            name of the active profile
 *   <agentDir>/profiles/startup            optional: profile new sessions start on (absent = last used)
 */
export class ProfileStore {
  readonly agentDir: string;
  readonly profilesDir: string;
  readonly currentPath: string;
  readonly startupPath: string;

  // No parameter properties: Node's type stripping (used by bin/) rejects them.
  // `currentPath` lets a private session home keep its own current profile (S30); everything else stays shared.
  constructor(agentDir: string, options: { currentPath?: string } = {}) {
    this.agentDir = agentDir;
    this.profilesDir = join(agentDir, "profiles");
    this.currentPath = options.currentPath ?? join(this.profilesDir, "current");
    this.startupPath = join(this.profilesDir, "startup");
  }

  profileDir(name: string): string {
    return join(this.profilesDir, name);
  }

  /** Optional override file: when present, its content is the CLAUDE_CONFIG_DIR of the profile. */
  claudeDirPath(name: string): string {
    return join(this.profileDir(name), "claude-dir");
  }

  claudeDir(name: string): string {
    const overridePath = this.claudeDirPath(name);
    if (existsSync(overridePath)) {
      const override = readFileSync(overridePath, "utf8").trim();
      if (override) return override;
    }
    return join(this.profileDir(name), "claude");
  }

  /** Marker file: the profile uses Claude Code's built-in default dir, so CLAUDE_CONFIG_DIR stays unset. */
  claudeDefaultPath(name: string): string {
    return join(this.profileDir(name), "claude-default");
  }

  /**
   * Value of CLAUDE_CONFIG_DIR for the profile, or undefined when the variable must be left unset
   * (marker file, or a legacy `claude-dir` pointing at `<home>/.claude`).
   */
  claudeConfigEnv(name: string): string | undefined {
    if (existsSync(this.claudeDefaultPath(name))) return undefined;
    const dir = this.claudeDir(name);
    if (existsSync(this.claudeDirPath(name)) && resolve(dir) === join(homedir(), ".claude")) return undefined;
    return dir;
  }

  authPath(name: string): string {
    return join(this.profileDir(name), "auth.json");
  }

  exists(name: string): boolean {
    return validateProfileName(name) === null && existsSync(this.authPath(name));
  }

  list(): string[] {
    if (!existsSync(this.profilesDir)) return [];
    return readdirSync(this.profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && this.exists(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  current(): string | null {
    if (!existsSync(this.currentPath)) return null;
    const name = readFileSync(this.currentPath, "utf8").trim();
    return this.exists(name) ? name : null;
  }

  setCurrent(name: string): void {
    this.assertExists(name);
    writeFileAtomic(this.currentPath, `${name}\n`);
  }

  /** Profile new sessions start on; null when unset, empty, invalid or naming a missing profile. */
  startup(): string | null {
    const name = this.startupRaw();
    return name && this.exists(name) ? name : null;
  }

  /** Trimmed content of the startup file, even when it names a missing profile; null when absent or empty. */
  startupRaw(): string | null {
    if (!existsSync(this.startupPath)) return null;
    return readFileSync(this.startupPath, "utf8").trim() || null;
  }

  setStartup(name: string): void {
    this.assertExists(name);
    writeFileAtomic(this.startupPath, `${name}\n`);
  }

  clearStartup(): void {
    rmSync(this.startupPath, { force: true });
  }

  create(name: string, options: { claudeDir?: string; claudeDefault?: boolean } = {}): void {
    const invalid = validateNewProfileName(name);
    if (invalid) throw new Error(invalid);
    if (this.exists(name)) throw alreadyExists(name);
    mkdirSync(this.profileDir(name), { recursive: true, mode: 0o700 });
    if (options.claudeDefault) {
      writeFileSync(this.claudeDefaultPath(name), "", { mode: 0o600 });
    } else if (options.claudeDir) {
      writeFileSync(this.claudeDirPath(name), `${options.claudeDir}\n`, { mode: 0o600 });
    } else {
      mkdirSync(this.claudeDir(name), { recursive: true, mode: 0o700 });
    }
    try {
      // Exclusive: when another session created the profile in between, its snapshot is never overwritten.
      writeFileSync(this.authPath(name), "{}\n", { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (isAlreadyExistsError(error)) throw alreadyExists(name);
      throw error;
    }
  }

  delete(name: string): void {
    this.assertExists(name);
    if (this.current() === name) {
      throw new Error(`Cannot delete the active profile "${name}". Switch to another profile first.`);
    }
    if (this.startup() === name) throw new Error(STARTUP_DELETE_MESSAGE(name));
    rmSync(this.profileDir(name), { recursive: true, force: true });
  }

  assertExists(name: string): void {
    if (!this.exists(name)) throw new Error(MISSING_PROFILE_MESSAGE(name));
  }
}

function alreadyExists(name: string): Error {
  return Object.assign(new Error(`Profile "${name}" already exists.`), { code: "EEXIST" });
}

/**
 * Shared `startup [<name>|last]` command of the extension and the CLI: no argument shows the
 * startup profile, `last` clears it, a name sets it. Returns the exact user-facing message.
 */
export function runStartupCommand(store: ProfileStore, arg: string): { ok: boolean; message: string } {
  if (!arg) {
    const startup = store.startup();
    return {
      ok: true,
      message: startup
        ? `Startup profile: ${startup}`
        : `Startup profile: none (new sessions start on the last used profile: ${store.current() ?? "none"})`,
    };
  }
  if (arg === "last") {
    store.clearStartup();
    return { ok: true, message: "Startup profile cleared. New sessions start on the last used profile." };
  }
  const invalid = validateProfileName(arg);
  if (invalid) return { ok: false, message: invalid };
  if (!store.exists(arg)) return { ok: false, message: MISSING_PROFILE_MESSAGE(arg) };
  store.setStartup(arg);
  return { ok: true, message: `Startup profile set to "${arg}". New sessions start on it.` };
}
