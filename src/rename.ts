import { applyClaudeConfigEnv } from "./auth-sync.ts";
import { liveSessionHomesOn, sweepSessionHomes } from "./session-home.ts";
import type { ProfileStore } from "./store.ts";

export const RENAMED_MESSAGE = (from: string, to: string): string => `Renamed profile "${from}" to "${to}".`;

/** Added when the renamed profile was the current one: other open sessions still hold the old Claude dir path. */
export const RENAMED_CURRENT_NOTE = " Other open sessions that use it keep the old path until they switch or restart.";

export const IN_USE_MESSAGE = (name: string): string =>
  `Cannot rename profile "${name}": a session started with gentle-accounts is using it. Close it first.`;

export interface RenameOptions {
  /** Environment of this process: CLAUDE_CONFIG_DIR follows the folder when it pointed at the renamed profile. */
  env?: NodeJS.ProcessEnv;
  /** Parent of the launcher session homes; tests only. */
  baseDir?: string;
  /** Liveness of a pid; tests only. */
  isAlive?: (pid: number) => boolean;
}

/**
 * Shared by `/gentle:accounts rename`, `gentle-accounts rename` and the menu. Order matters: every cheap refusal first,
 * then the launcher sessions (homes whose launcher is gone are finished first so their credentials are saved under the
 * old name), then the move. Never throws: the result carries the exact user-facing message.
 */
export function renameProfile(store: ProfileStore, from: string, to: string, options: RenameOptions = {}): { ok: boolean; message: string } {
  try {
    store.assertCanRename(from, to);
    try {
      sweepSessionHomes(options.baseDir, options.isAlive, () => {}, { sharedAgentDir: store.agentDir });
    } catch {
      // Sweeping is housekeeping: a failure must not stop a rename that nothing else holds.
    }
    if (liveSessionHomesOn(from, store.agentDir, options.baseDir, options.isAlive).length > 0) return { ok: false, message: IN_USE_MESSAGE(from) };

    const wasCurrent = store.current() === from;
    const oldEnv = store.claudeConfigEnv(from);
    store.rename(from, to);
    // The active profile's Claude dir moved with the folder: keep this process on it, unless the user pointed elsewhere.
    if (options.env && oldEnv !== undefined && options.env.CLAUDE_CONFIG_DIR === oldEnv) {
      applyClaudeConfigEnv(options.env, store.claudeConfigEnv(to));
    }
    return { ok: true, message: `${RENAMED_MESSAGE(from, to)}${wasCurrent ? RENAMED_CURRENT_NOTE : ""}` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
