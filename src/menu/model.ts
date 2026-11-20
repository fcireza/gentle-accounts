import { join } from "node:path";
import { PLUGIN_LABEL, providerStates, readClaudeAccount, type ClaudeAccount, type ProviderState } from "../account.ts";
import { readAuthFile, type AuthData } from "../auth-sync.ts";
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
  mode: "session home" | "global";
  showEmail: boolean;
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
  session: boolean;
  showEmail: boolean;
  homeDir: string;
  /** Cached `claude auth status` result of the status bar for the active profile; undefined when none is cached. */
  activeClaude?: ClaudeAccount | null;
  selectedName?: string | null;
  row?: number;
  feedback?: Feedback;
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
  const profiles = store.list().map((name): MenuProfile => {
    const active = name === current;
    const claude =
      active && options.activeClaude !== undefined
        ? options.activeClaude
        : readClaudeAccount(store.claudeConfigEnv(name) ?? join(homeDir, ".claude"), homeDir);
    const auth = safeAuth(active ? options.liveAuthPath : store.authPath(name));
    return { name, active, startup: name === startup, providers: providerStates(claude, auth, { showEmail: options.showEmail }) };
  });
  const wanted = options.selectedName ?? current;
  const selected = Math.max(0, profiles.findIndex((p) => p.name === wanted));
  const rows = profiles.length ? profiles[selected].providers.length + 1 : 1;
  const row = Math.min(Math.max(0, options.row ?? 0), rows - 1);
  return {
    title: PLUGIN_LABEL,
    mode: options.session ? "session home" : "global",
    showEmail: options.showEmail,
    profiles,
    selected,
    row,
    feedback: options.feedback,
  };
}
