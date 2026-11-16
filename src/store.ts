import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const INVALID_NAME_MESSAGE = (name: string): string =>
  `Invalid profile name "${name}": use lowercase letters, digits, "-" or "_" (max 32 chars).`;

export const MISSING_PROFILE_MESSAGE = (name: string): string => `Profile "${name}" does not exist.`;

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
 */
export class ProfileStore {
  readonly agentDir: string;
  readonly profilesDir: string;
  readonly currentPath: string;

  // No parameter properties: Node's type stripping (used by bin/) rejects them.
  constructor(agentDir: string) {
    this.agentDir = agentDir;
    this.profilesDir = join(agentDir, "profiles");
    this.currentPath = join(this.profilesDir, "current");
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
    writeFileSync(this.currentPath, `${name}\n`, { mode: 0o600 });
  }

  create(name: string, options: { claudeDir?: string; claudeDefault?: boolean } = {}): void {
    const invalid = validateProfileName(name);
    if (invalid) throw new Error(invalid);
    if (this.exists(name)) throw new Error(`Profile "${name}" already exists.`);
    mkdirSync(this.profileDir(name), { recursive: true, mode: 0o700 });
    if (options.claudeDefault) {
      writeFileSync(this.claudeDefaultPath(name), "", { mode: 0o600 });
    } else if (options.claudeDir) {
      writeFileSync(this.claudeDirPath(name), `${options.claudeDir}\n`, { mode: 0o600 });
    } else {
      mkdirSync(this.claudeDir(name), { recursive: true, mode: 0o700 });
    }
    writeFileSync(this.authPath(name), "{}\n", { mode: 0o600 });
  }

  delete(name: string): void {
    this.assertExists(name);
    if (this.current() === name) {
      throw new Error(`Cannot delete the active profile "${name}". Switch to another profile first.`);
    }
    rmSync(this.profileDir(name), { recursive: true, force: true });
  }

  assertExists(name: string): void {
    if (!this.exists(name)) throw new Error(MISSING_PROFILE_MESSAGE(name));
  }
}
