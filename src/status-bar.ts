import { homedir } from "node:os";
import { PLUGIN_LABEL, queryClaudeAccount, statusText, type ClaudeAccount, type ClaudeStatusRunner } from "./account.ts";
import type { ProfileStore } from "./store.ts";

export const STATUS_KEY = PLUGIN_LABEL;
export const REFRESH_MS = 60_000;

export type StatusCtx = { hasUI?: boolean; ui?: { setStatus?: (key: string, text: string | undefined) => void } };
export type TimerHandle = { unref?: () => unknown };

export interface StatusBarOptions {
  /** The store of the current context, read on every timer tick (a session home can change it). */
  store: () => ProfileStore;
  showEmail: () => boolean;
  runClaudeStatus?: ClaudeStatusRunner;
  startTimer: (fn: () => void, ms: number) => TimerHandle;
  stopTimer: (handle: TimerHandle) => void;
}

export interface StatusBar {
  /**
   * Shows `gentle-accounts: <profile>` (plus ` · <email>` only when shown); never throws. A refresh for the profile
   * already being computed is skipped, and a result for an older request is dropped.
   */
  update(ctx: StatusCtx, store: ProfileStore): Promise<void>;
  /** Starts the periodic refresh once; later calls do nothing. */
  start(): void;
  /** Stops the periodic refresh and forgets the last context. */
  stop(): void;
  /**
   * The last `claude auth status` answer of the status bar for the active profile of `store`, reused by the menu
   * (no extra process per open); undefined when there is none for that profile.
   */
  cachedAccount(store: ProfileStore): ClaudeAccount | null | undefined;
}

export function createStatusBar(options: StatusBarOptions): StatusBar {
  let generation = 0;
  let inFlight: string | null = null;
  let timer: TimerHandle | undefined;
  let lastCtx: StatusCtx | undefined;
  let lastAccount: { store: string; profile: string; account: ClaudeAccount | null } | undefined;

  async function update(ctx: StatusCtx, s: ProfileStore): Promise<void> {
    try {
      if (!ctx?.hasUI || !ctx.ui?.setStatus) return;
      lastCtx = ctx;
      const current = s.current();
      if (current && inFlight === current) return;
      const gen = ++generation;
      if (!current) {
        inFlight = null;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      inFlight = current;
      try {
        const account = await queryClaudeAccount({ claudeConfigDir: s.claudeConfigEnv(current), homeDir: homedir(), run: options.runClaudeStatus });
        if (gen !== generation || s.current() !== current) return;
        lastAccount = { store: s.currentPath, profile: current, account };
        ctx.ui.setStatus(STATUS_KEY, statusText(current, account, { showEmail: options.showEmail() }));
      } finally {
        if (gen === generation) inFlight = null;
      }
    } catch {
      // The status line is cosmetic; never break the caller.
    }
  }

  return {
    update,
    start() {
      if (timer) return;
      timer = options.startTimer(() => {
        if (lastCtx) void update(lastCtx, options.store());
      }, REFRESH_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) options.stopTimer(timer);
      timer = undefined;
      lastCtx = undefined;
    },
    cachedAccount(s) {
      const current = s.current();
      return lastAccount && current && lastAccount.store === s.currentPath && lastAccount.profile === current ? lastAccount.account : undefined;
    },
  };
}
