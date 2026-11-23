import { readAuthFile, writeAuthFile } from "./auth-sync.ts";
import type { ProfileStore } from "./store.ts";

export const LOGGED_OUT_MESSAGE = (provider: string, profile: string): string =>
  `Logged "${provider}" out of profile "${profile}". The token is only forgotten on this machine.`;

export interface LogoutOptions {
  store: ProfileStore;
  liveAuthPath: string;
  profile: string;
  provider: string;
}

/**
 * Removes one pi provider's credentials from a profile: its snapshot and, when it is the current profile, the live
 * auth.json too. Nothing else is touched. Every file is read before any is written. Never throws.
 */
export function logoutProvider({ store, liveAuthPath, profile, provider }: LogoutOptions): { ok: boolean; message: string } {
  try {
    store.assertExists(profile);
    const snapshot = readAuthFile(store.authPath(profile));
    const isCurrent = store.current() === profile;
    const live = isCurrent ? readAuthFile(liveAuthPath) : null;
    if (!(provider in snapshot) && !(live && provider in live)) return { ok: false, message: `Profile "${profile}" has no login for "${provider}".` };
    delete snapshot[provider];
    writeAuthFile(store.authPath(profile), snapshot);
    if (live) {
      delete live[provider];
      writeAuthFile(liveAuthPath, live);
    }
    return { ok: true, message: LOGGED_OUT_MESSAGE(provider, profile) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
