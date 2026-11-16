import { ProfileStore } from "./store.ts";
import { assertProfileReadable, ensureDefaultProfile, switchProfile, type Env } from "./auth-sync.ts";

export const USAGE = [
  "Usage:",
  "  gentle-profiles <name> [gentle-shell args...]   start gentle-shell with profile <name>",
  "  gentle-profiles list                            list profiles (* marks the active one)",
  "  gentle-profiles current                         print the active profile",
  "  gentle-profiles create <name>                   create an empty profile",
  "  gentle-profiles login <name>                    run `claude auth login` for that profile's Claude dir",
  "  gentle-profiles --help                          show this help",
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
    if (!names.length) stdout("No profiles. Create one with: gentle-profiles create <name>");
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
  if (first === "login") {
    if (!second || !store.exists(second)) {
      stderr(second ? missingMessage(second) : USAGE);
      return 1;
    }
    return deps.spawn({
      command: "claude",
      args: ["auth", "login"],
      env: { ...deps.env, CLAUDE_CONFIG_DIR: store.claudeDir(second) },
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
  env.CLAUDE_CONFIG_DIR = store.claudeDir(first);
  return deps.spawn({
    command: "gentle-shell",
    args: [second, ...rest].filter((a): a is string => a !== undefined),
    env,
    shell: deps.platform === "win32",
  });
}

function missingMessage(name: string): string {
  return `Profile "${name}" does not exist. Create it with: gentle-profiles create <name>`;
}
