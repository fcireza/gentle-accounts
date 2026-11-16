import { existsSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "./store.ts";

/** pi auth.json providers whose credentials belong to a profile. */
export const COVERED_PROVIDERS = ["openai-codex", "anthropic"] as const;

export type AuthData = Record<string, unknown>;
export type Env = Record<string, string | undefined>;

export function readAuthFile(path: string): AuthData {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as AuthData;
    throw new Error("not a JSON object");
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${(error as Error).message}`);
  }
}

/** Write then rename, so a reader never sees a partial file; pi reloads auth.json by file revision. */
export function writeAuthFile(path: string, data: AuthData): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Copies the covered provider entries of `source` into `target`, removing entries absent in `source`. */
function transferCovered(source: AuthData, target: AuthData): AuthData {
  const next: AuthData = { ...target };
  for (const provider of COVERED_PROVIDERS) {
    if (provider in source) next[provider] = source[provider];
    else delete next[provider];
  }
  return next;
}

export interface SwitchOptions {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  to: string;
}

export type SwitchResult = { status: "switched" | "noop"; from: string | null; to: string };

/**
 * Snapshot the active profile's live credentials, load the target profile's credentials into
 * pi's live auth.json, point CLAUDE_CONFIG_DIR at the target's Claude dir and record it as current.
 */
export function switchProfile({ store, liveAuthPath, env, to }: SwitchOptions): SwitchResult {
  store.assertExists(to);
  const from = store.current();
  if (from === to) return { status: "noop", from, to };

  const live = readAuthFile(liveAuthPath);
  if (from) {
    writeAuthFile(store.authPath(from), transferCovered(live, readAuthFile(store.authPath(from))));
  }
  writeAuthFile(liveAuthPath, transferCovered(readAuthFile(store.authPath(to)), live));
  env.CLAUDE_CONFIG_DIR = store.claudeDir(to);
  store.setCurrent(to);
  return { status: "switched", from, to };
}

/** On load: make the bridge use the current profile's Claude login unless the user forced a dir. */
export function applyCurrentProfileEnv(store: ProfileStore, env: Env): string | null {
  const current = store.current();
  if (!current) return null;
  if (!env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = store.claudeDir(current);
  return current;
}

export function defaultClaudeDir(env: Env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/**
 * First run: wrap the existing login into a `default` profile. The Claude dir is recorded
 * (not copied), so the current `claude auth login` keeps working untouched.
 */
export function ensureDefaultProfile({ store, liveAuthPath, env }: Omit<SwitchOptions, "to">): string | null {
  if (store.list().length > 0) return null;
  const claudeDir = defaultClaudeDir(env);
  store.create("default", { claudeDir });
  writeAuthFile(store.authPath("default"), transferCovered(readAuthFile(liveAuthPath), {}));
  store.setCurrent("default");
  env.CLAUDE_CONFIG_DIR = claudeDir;
  return "default";
}
