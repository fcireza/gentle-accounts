import type { DetectedLogin } from "../detect.ts";
import { join } from "node:path";
import { PLUGIN_LABEL, providerStates, readClaudeAccount, type ClaudeAccount, type ProviderState } from "../account.ts";
import { coveredProviders, readAuthFile, type AuthData } from "../auth-sync.ts";
import type { ProfileStore } from "../store.ts";

/** The subset of pi's theme the menu uses; pi's `Theme` satisfies it. */
export interface MenuTheme {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

export const identityTheme: MenuTheme = { fg: (_color, text) => text };

export type FeedbackType = "info" | "warning" | "error";

export interface Feedback {
  message: string;
  type: FeedbackType;
}

export interface MenuProfile {
  name: string;
  /** Active in this session (session mode) or globally (global mode). */
  active: boolean;
  startup: boolean;
  providers: ProviderState[];
}

export interface MenuModel {
  title: string;
  showEmail: boolean;
  /** The profile set for this session (session mode only); null or absent when none is set. */
  sessionName?: string | null;
  /** Logins found outside the profiles, offered with the `i` key (global mode only). */
  detected?: DetectedLogin[];
  profiles: MenuProfile[];
  /** Index of the selected profile in the list (0 when there are no profiles). */
  selected: number;
  /** 0 is the profile row ("switch", providers collapsed); 1..n are the provider rows of the expanded profile. */
  row: number;
  feedback?: Feedback;
}

export interface BuildMenuOptions {
  store: ProfileStore;
  liveAuthPath: string;
  showEmail: boolean;
  /** True when the menu runs in a session home, where the current profile is the session's own. */
  sessionMode?: boolean;
  /** Logins detected outside the profiles; empty when none. */
  detected?: DetectedLogin[];
  /** The providers pi's `/login` offers (id and name), logged in or not; listed for every profile. */
  loginProviders?: { id: string; name: string }[];
  homeDir: string;
  /** Cached `claude auth status` result of the status bar for the active profile; undefined when none is cached. */
  activeClaude?: ClaudeAccount | null;
  selectedName?: string | null;
  row?: number;
  feedback?: Feedback;
}

/** Logged-in providers first; the sort is stable, so each group keeps its order (Claude first). */
function loggedInFirst(rows: ProviderState[]): ProviderState[] {
  return [...rows].sort((x, y) => Number(y.loggedIn) - Number(x.loggedIn));
}

function safeAuth(path: string): AuthData {
  try {
    return readAuthFile(path);
  } catch {
    return {};
  }
}

/** Builds the view model from the store; reads files only (never spawns) and never keeps tokens. */
export function buildMenuModel(options: BuildMenuOptions): MenuModel {
  const { store, homeDir } = options;
  const current = store.current();
  const startup = store.startup();
  const names = store.list();
  // Every provider logged in anywhere (the live file from /login, any snapshot) is listed for every profile.
  const offered = options.loginProviders ?? [];
  const providers = coveredProviders(safeAuth(options.liveAuthPath), ...names.map((name) => safeAuth(store.authPath(name))));
  for (const { id } of offered) if (!providers.includes(id)) providers.push(id);
  const labels = Object.fromEntries(offered.map(({ id, name }) => [id, name]));
  const profiles = names.map((name): MenuProfile => {
    const active = name === current;
    const claude =
      active && options.activeClaude !== undefined
        ? options.activeClaude
        : readClaudeAccount(store.claudeConfigEnv(name) ?? join(homeDir, ".claude"), homeDir);
    const auth = safeAuth(active ? options.liveAuthPath : store.authPath(name));
    return { name, active, startup: name === startup, providers: loggedInFirst(providerStates(claude, auth, { showEmail: options.showEmail, providers, labels })) };
  });
  const wanted = options.selectedName ?? current;
  const selected = Math.max(0, profiles.findIndex((p) => p.name === wanted));
  const rows = profiles.length ? profiles[selected].providers.length + 1 : 1;
  const row = Math.min(Math.max(0, options.row ?? 0), rows - 1);
  return {
    title: PLUGIN_LABEL,
    showEmail: options.showEmail,
    sessionName: options.sessionMode ? current : null,
    detected: options.detected ?? [],
    profiles,
    selected,
    row,
    feedback: options.feedback,
  };
}

/** `o` opens the project with the selected profile: only on a provider row that is logged in. Shared by the hint and the key. */
export function canOpenProject(model: Pick<MenuModel, "profiles" | "selected" | "row">): boolean {
  return model.row > 0 && model.profiles[model.selected]?.providers[model.row - 1]?.loggedIn === true;
}
