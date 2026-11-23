import { join, resolve } from "node:path";
import { readClaudeAccount } from "./account.ts";
import { coveredProviders, readAuthFile, type AuthData } from "./auth-sync.ts";
import type { ProfileStore } from "./store.ts";

/** A login found outside the profiles, offered in the menu to become a new profile. */
export interface DetectedLogin {
  /** `claude`: an unowned `~/.claude` account. `live`: oauth entries of pi's live auth.json that no profile holds. */
  kind: "claude" | "live";
  /** Providers to adopt (the covered provider ids for `live`, `claude` for the Claude login). */
  providers: string[];
  /** The Claude account email; shown only when email display is on. */
  email?: string;
}

export interface DetectOptions {
  store: ProfileStore;
  liveAuthPath: string;
  homeDir: string;
}

/** The account id of an oauth entry, when it carries one (Codex does; Anthropic does not). */
function accountId(entry: unknown): string | null {
  const id = entry && typeof entry === "object" ? (entry as { accountId?: unknown }).accountId : undefined;
  return typeof id === "string" && id ? id : null;
}

function safeRead(path: string): AuthData | null {
  try {
    return readAuthFile(path);
  } catch {
    return null;
  }
}

/**
 * Read-only: logins that exist on this machine but belong to no profile. Entries without an account id cannot be
 * told apart from a token refresh, so they are never reported. Never throws; unreadable files detect nothing.
 */
export function detectLogins({ store, liveAuthPath, homeDir }: DetectOptions): DetectedLogin[] {
  const found: DetectedLogin[] = [];
  try {
    const names = store.list();
    const defaultDir = resolve(join(homeDir, ".claude"));
    const owned = names.some((name) => {
      const env = store.claudeConfigEnv(name);
      return env === undefined || resolve(env) === defaultDir;
    });
    const claude = owned ? null : readClaudeAccount(defaultDir, homeDir);
    if (claude) found.push({ kind: "claude", providers: ["claude"], email: claude.email });

    const current = store.current();
    const live = safeRead(liveAuthPath);
    const snapshot = current && store.exists(current) ? safeRead(store.authPath(current)) : null;
    if (live && snapshot) {
      const snapshots = names.map((name) => safeRead(store.authPath(name)));
      if (snapshots.every((s) => s !== null)) {
        const providers = coveredProviders(live, snapshot).filter((provider) => {
          const liveId = accountId(live[provider]);
          const snapId = accountId(snapshot[provider]);
          if (!liveId || !snapId || liveId === snapId) return false;
          return !snapshots.some((s) => accountId(s?.[provider]) === liveId);
        });
        if (providers.length) found.push({ kind: "live", providers });
      }
    }
  } catch {
    return [];
  }
  return found;
}
