import { ProfileStore, runStartupCommand } from "./store.ts";
import { LAUNCH_PROFILE_ENV, applyClaudeConfigEnv, assertProfileReadable, ensureDefaultProfile, switchProfile, type Env } from "./auth-sync.ts";
import { runEmailCommand } from "./settings.ts";
import { join } from "node:path";

export const USAGE = [
  "Usage:",
  "  gentle-accounts <name> [gentle-shell args...]   start gentle-shell with profile <name>",
  "  gentle-accounts list                            list profiles (* marks the active one)",
  "  gentle-accounts current                         print the active profile",
  "  gentle-accounts create <name>                   create an empty profile",
  "  gentle-accounts login <name>                    run `claude auth login` for that profile's Claude dir",
  "  gentle-accounts startup [<name>|last]           show, set or clear the profile new sessions start on",
  "  gentle-accounts email [show|hide]               show or set whether the status bar shows the full email",
  "  gentle-accounts --help                          show this help",
].join("\n");

export interface SpawnCall {
  command: string;
  args: string[];
  env: Env;
  shell: boolean;
}

export interface CliDeps {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  platform: NodeJS.Platform;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Runs the command with inherited stdio and returns its exit code. */
  spawn: (call: SpawnCall) => number;
}

export function runCli(argv: string[], deps: CliDeps): number {
  const { store, stdout, stderr } = deps;
  const [first, second, ...rest] = argv;

  if (!first) {
    stderr(USAGE);
    return 1;
  }
  if (first === "--help" || first === "-h" || first === "help") {
    stdout(USAGE);
    return 0;
  }
  if (first === "list") {
    const names = store.list();
    if (!names.length) stdout("No profiles. Create one with: gentle-accounts create <name>");
    const current = store.current();
    for (const name of names) stdout(`${name === current ? "* " : "  "}${name}`);
    return 0;
  }
  if (first === "current") {
    stdout(store.current() ?? "No active profile.");
    return 0;
  }
  if (first === "create") {
    if (!second) {
      stderr(USAGE);
      return 1;
    }
    try {
      store.create(second);
      stdout(`Created profile "${second}".`);
      return 0;
    } catch (error) {
      stderr((error as Error).message);
      return 1;
    }
  }
  if (first === "startup") {
    const result = runStartupCommand(store, second ?? "");
    (result.ok ? stdout : stderr)(result.message);
    return result.ok ? 0 : 1;
  }
  if (first === "email") {
    const result = runEmailCommand(second ?? "", join(store.profilesDir, "settings.json"), "gentle-accounts");
    (result.type === "info" ? stdout : stderr)(result.message);
    return result.type === "info" ? 0 : 1;
  }
  if (first === "login") {
    if (!second || !store.exists(second)) {
      stderr(second ? missingMessage(second) : USAGE);
      return 1;
    }
    const loginEnv: Env = { ...deps.env };
    applyClaudeConfigEnv(loginEnv, store.claudeConfigEnv(second));
    return deps.spawn({
      command: "claude",
      args: ["auth", "login"],
      env: loginEnv,
      shell: deps.platform === "win32",
    });
  }

  if (!store.exists(first)) {
    stderr(missingMessage(first));
    return 1;
  }
  const env: Env = { ...deps.env };
  try {
    assertProfileReadable(store, first); // atomic: nothing is created if the target is corrupt
    // Same first-run rule as the extension: never drop a live login that no profile holds yet.
    ensureDefaultProfile({ store, liveAuthPath: deps.liveAuthPath, env });
    switchProfile({ store, liveAuthPath: deps.liveAuthPath, env, to: first });
  } catch (error) {
    stderr((error as Error).message);
    return 1;
  }
  applyClaudeConfigEnv(env, store.claudeConfigEnv(first));
  env[LAUNCH_PROFILE_ENV] = first; // the extension then skips the startup profile for this session
  return deps.spawn({
    command: "gentle-shell",
    args: [second, ...rest].filter((a): a is string => a !== undefined),
    env,
    shell: deps.platform === "win32",
  });
}

function missingMessage(name: string): string {
  return `Profile "${name}" does not exist. Create it with: gentle-accounts create <name>`;
}
