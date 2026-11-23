import { ProfileStore } from "./store.ts";
import { coveredProviders, pickFreshest, readAuthFile, withGlobalEntries, writeAuthFile } from "./auth-sync.ts";
import { isAuthLinked, pointAuthAt } from "./auth-link.ts";

export interface MigrateOptions {
  store: ProfileStore;
  liveAuthPath: string;
  platform?: NodeJS.Platform;
}

export type MigrateResult = { status: "migrated" | "already-linked" | "unsupported" | "no-profile" | "fallback" };

/**
 * Turns a regular live credentials file into a link to the current profile's file (S4), once.
 * The profile file receives the live content first (fresher OAuth entry per provider, live API keys
 * winning), and only then is the link made over the live file, so a failure at any point leaves the
 * data in at least one regular file. Windows (S3) and a link that cannot be made keep the copy model.
 * A corrupt live or profile file throws before anything is written.
 */
export function migrateToLinkedAuth({ store, liveAuthPath, platform = process.platform }: MigrateOptions): MigrateResult {
  if (platform === "win32") return { status: "unsupported" };
  if (isAuthLinked(liveAuthPath)) return { status: "already-linked" };
  const current = store.current();
  if (!current || !store.exists(current)) return { status: "no-profile" };

  const live = readAuthFile(liveAuthPath);
  const profile = readAuthFile(store.authPath(current));
  const merged = withGlobalEntries(live, profile);
  // The migration's own rule: per covered provider the fresher OAuth entry wins.
  for (const provider of coveredProviders(live, profile)) {
    const entry = pickFreshest(live[provider], profile[provider]);
    if (entry !== undefined) merged[provider] = entry;
  }
  writeAuthFile(store.authPath(current), merged);
  try {
    pointAuthAt(liveAuthPath, store.authPath(current));
  } catch {
    return { status: "fallback" };
  }
  return { status: "migrated" };
}
