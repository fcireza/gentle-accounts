import { ProfileStore, runStartupCommand } from "./store.ts";
import { LAUNCH_PROFILE_ENV, applyClaudeConfigEnv, assertProfileReadable, ensureDefaultProfile, type Env } from "./auth-sync.ts";
import { runEmailCommand } from "./settings.ts";
import { assertSharedSettingsReadable, buildSessionHome, finishSessionHome, recordSessionChildPid, sessionBaseDir, sweepSessionHomes } from "./session-home.ts";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export const MANAGED_HOME_MESSAGE = "gentle-accounts manages the agent home; do not pass --home, --link or --isolated.";
const MANAGED_FLAGS = ["--home", "--link", "--isolated"];

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
  /** Called with the child pid right after it starts (the launch records it in the session marker). */
  onSpawn?: (pid: number) => void;
}

export interface CliDeps {
  store: ProfileStore;
  liveAuthPath: string;
  env: Env;
  platform: NodeJS.Platform;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Runs the command with inherited stdio and returns (or resolves to) its exit code. */
  spawn: (call: SpawnCall) => number | Promise<number>;
  /** Parent of the session homes (S30); defaults to `<os.tmpdir()>/gentle-accounts`. */
  sessionBaseDir?: string;
  /** Liveness check used by the sweeper; defaults to a signal-0 probe. */
  isAlive?: (pid: number) => boolean;
  /** Registers a best-effort synchronous cleanup for an abrupt process exit (the real launcher uses process "exit"). */
  onExit?: (cleanup: () => void) => void;
}

/** Only the `<name>` launch is asynchronous; every other command returns synchronously. */
export function runCli(argv: string[], deps: CliDeps): number | Promise<number> {
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

  const userArgs = [second, ...rest].filter((a): a is string => a !== undefined);
  if (userArgs.some((a) => MANAGED_FLAGS.some((flag) => a === flag || a.startsWith(`${flag}=`)))) {
    stderr(MANAGED_HOME_MESSAGE);
    return 1;
  }
  if (!store.exists(first)) {
    stderr(missingMessage(first));
    return 1;
  }
  try {
    assertProfileReadable(store, first); // atomic: nothing is created if the target is corrupt
    assertSharedSettingsReadable(store.agentDir); // S30: a home without valid settings would load no packages
    // Same first-run rule as the extension: never drop a live login that no profile holds yet.
    ensureDefaultProfile({ store, liveAuthPath: deps.liveAuthPath, env: { ...deps.env } });
  } catch (error) {
    stderr((error as Error).message);
    return 1;
  }
  return launchSession(first, userArgs, deps);
}

/**
 * S30: the launch never switches the global profile. It runs gentle-shell on a private home built
 * for `name`, then copies the session credentials back and removes the home, whatever the exit.
 */
async function launchSession(name: string, userArgs: string[], deps: CliDeps): Promise<number> {
  const { store, stderr } = deps;
  const baseDir = deps.sessionBaseDir ?? sessionBaseDir();
  let home: string;
  let sharedAgentDir: string;
  try {
    sweepSessionHomes(baseDir, deps.isAlive, stderr, { sharedAgentDir: store.agentDir });
    home = buildSessionHome({ sharedAgentDir: store.agentDir, profile: name, baseDir }).home;
    sharedAgentDir = realpathSync(store.agentDir);
  } catch (error) {
    stderr((error as Error).message);
    return 1;
  }
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    finishSessionHome(home, { sharedAgentDir, stderr });
  };
  deps.onExit?.(finish);

  const env: Env = { ...deps.env };
  // gentle-shell sets PI_CODING_AGENT_DIR itself from --home.
  delete env.PI_CODING_AGENT_DIR;
  delete env.GENTLE_SHELL_HOME;
  // The Claude dir always resolves through the canonical shared path (macOS keychain key).
  applyClaudeConfigEnv(env, new ProfileStore(sharedAgentDir).claudeConfigEnv(name));
  env.GENTLE_SHELL_NO_AUTO_SETUP = "1";
  env[LAUNCH_PROFILE_ENV] = name; // the extension then skips the startup profile for this session
  let code: number;
  try {
    code = await deps.spawn({ command: "gentle-shell", args: ["--home", home, ...userArgs], env, shell: deps.platform === "win32", onSpawn: (pid) => recordSessionChildPid(home, pid) });
  } catch (error) {
    stderr(`Cannot run gentle-shell: ${(error as Error).message}`);
    code = 1;
  }
  finish();
  return code;
}

function missingMessage(name: string): string {
  return `Profile "${name}" does not exist. Create it with: gentle-accounts create <name>`;
}
