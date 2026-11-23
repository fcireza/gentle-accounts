import { applyClaudeConfigEnv, pickFreshest, readAuthFile, transferCovered, writeAuthFile, type AuthData, type Env } from "./auth-sync.ts";
import type { DetectedLogin } from "./detect.ts";
import { ProfileStore } from "./store.ts";

export const ADOPTED_MESSAGE = (name: string): string => `Adopted the detected login as profile "${name}".`;

export interface AdoptOptions {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  login: DetectedLogin;
  name: string;
}

/**
 * Turns a detected login into a new profile. Never overwrites: `store.create` refuses an existing name, and the
 * previous profile keeps its own snapshot for the adopted providers (its other providers keep the fresher token).
 * A `claude` login only creates a profile on Claude Code's default dir (nothing is copied or moved); a `live` login
 * copies the detected entries and makes the new profile current, like a switch that does not snapshot them over the
 * previous profile. Never throws: the result carries the exact user-facing message.
 */
export function adoptLogin({ store, liveAuthPath, env, login, name }: AdoptOptions): { ok: boolean; message: string } {
  try {
    if (login.kind === "claude") {
      store.create(name, { claudeDefault: true });
      return { ok: true, message: ADOPTED_MESSAGE(name) };
    }
    // Read every file before writing any, so a corrupt file fails without touching the others.
    const live = readAuthFile(liveAuthPath);
    const previous = store.current();
    const outgoing = previous ? readAuthFile(store.authPath(previous)) : null;
    const entries: AuthData = {};
    for (const provider of login.providers) {
      if (!(provider in live)) return { ok: false, message: "The detected login is no longer there. Open the menu again." };
      entries[provider] = live[provider];
    }
    store.create(name);
    writeAuthFile(store.authPath(name), entries);
    if (previous && outgoing) {
      const next: AuthData = { ...outgoing };
      for (const provider of Object.keys(live)) {
        if (!login.providers.includes(provider) && provider in outgoing) next[provider] = pickFreshest(live[provider], outgoing[provider]);
      }
      writeAuthFile(store.authPath(previous), next);
    }
    writeAuthFile(liveAuthPath, transferCovered(entries, live));
    applyClaudeConfigEnv(env, store.claudeConfigEnv(name));
    store.setCurrent(name);
    return { ok: true, message: ADOPTED_MESSAGE(name) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
