/**
 * S32: open a command in a NEW terminal tab. `planNewTab` is pure (env, platform, cwd, command in; spawn
 * plan out) and never builds a string that a shell or AppleScript re-parses with user data inside, except
 * through the quoting helpers below (POSIX single quotes, PowerShell literal strings) which are tested.
 */

/** argv to run plus env changes: a string sets the variable, null removes it. */
export interface TabCommand {
  argv: string[];
  env: Record<string, string | null>;
}

export interface SpawnPlan {
  file: string;
  args: string[];
  /** Human name of the terminal, for the feedback line. */
  terminal: string;
}

type Env = Record<string, string | undefined>;

const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** POSIX script: `cd -- '<cwd>' && env [-u VAR] [VAR='v'] 'arg'...`. */
export function posixScript(cwd: string, command: TabCommand): string {
  const env = Object.entries(command.env).map(([k, v]) => (v === null ? `-u ${k}` : `${k}=${shQuote(v)}`));
  const parts = ["env", ...env, ...command.argv.map(shQuote)];
  return `cd -- ${shQuote(cwd)} && ${parts.join(" ")}`;
}

/** PowerShell script with literal strings only (no `$` expansion inside the values). */
export function powershellScript(cwd: string, command: TabCommand): string {
  const env = Object.entries(command.env).map(([k, v]) =>
    v === null ? `Remove-Item Env:${k} -ErrorAction SilentlyContinue` : `$env:${k} = ${psQuote(v)}`);
  return [`Set-Location -LiteralPath ${psQuote(cwd)}`, ...env, `& ${command.argv.map(psQuote).join(" ")}`].join("\n");
}

/** argv form for terminals that exec a program directly: `env [-u VAR] [VAR=v] argv...`. */
function envArgv(command: TabCommand): string[] {
  const env = Object.entries(command.env).flatMap(([k, v]) => (v === null ? ["-u", k] : [`${k}=${v}`]));
  return ["env", ...env, ...command.argv];
}

// The script travels as an argv item (`on run argv`), so it is never interpolated into AppleScript source.
const TERMINAL_APP = [
  "on run argv",
  'tell application "Terminal"',
  "activate",
  "do script (item 1 of argv)",
  "end tell",
  "end run",
];
const ITERM = [
  "on run argv",
  'tell application "iTerm2"',
  "activate",
  "if (count of windows) = 0 then",
  "create window with default profile",
  "else",
  "tell current window to create tab with default profile",
  "end if",
  "tell current session of current window to write text (item 1 of argv)",
  "end tell",
  "end run",
];

const osascript = (lines: string[], script: string, terminal: string): SpawnPlan => ({
  file: "osascript",
  args: [...lines.flatMap((line) => ["-e", line]), "--", script],
  terminal,
});

/** Detection order of S32; null when no known terminal can open a tab. */
export function planNewTab(env: Env, platform: NodeJS.Platform, cwd: string, command: TabCommand): SpawnPlan | null {
  if (platform === "win32") {
    const encoded = Buffer.from(powershellScript(cwd, command), "utf16le").toString("base64");
    return { file: "wt", args: ["-w", "0", "nt", "powershell", "-NoExit", "-EncodedCommand", encoded], terminal: "Windows Terminal" };
  }
  if (env.TMUX) return { file: "tmux", args: ["new-window", "-c", cwd, posixScript(cwd, command)], terminal: "tmux" };
  if (platform === "darwin") {
    if (env.TERM_PROGRAM === "Apple_Terminal") return osascript(TERMINAL_APP, posixScript(cwd, command), "Terminal.app");
    if (env.TERM_PROGRAM === "iTerm.app") return osascript(ITERM, posixScript(cwd, command), "iTerm2");
    return null;
  }
  if (env.GNOME_TERMINAL_SCREEN || env.GNOME_TERMINAL_SERVICE) {
    return { file: "gnome-terminal", args: ["--tab", `--working-directory=${cwd}`, "--", ...envArgv(command)], terminal: "gnome-terminal" };
  }
  if (env.KONSOLE_VERSION) return { file: "konsole", args: ["--new-tab", "--workdir", cwd, "-e", ...envArgv(command)], terminal: "konsole" };
  if (env.KITTY_WINDOW_ID) return { file: "kitty", args: ["@", "launch", "--type=tab", `--cwd=${cwd}`, ...envArgv(command)], terminal: "kitty" };
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm") {
    return { file: "wezterm", args: ["cli", "spawn", "--cwd", cwd, "--", ...envArgv(command)], terminal: "wezterm" };
  }
  return null;
}

export interface TabChild {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
export type TabSpawn = (file: string, args: readonly string[], options: { stdio: "ignore"; windowsHide?: boolean }) => TabChild;

export interface OpenTabDeps {
  env: Env;
  platform: NodeJS.Platform;
  cwd: string;
  command: TabCommand;
  spawn: TabSpawn;
}

export type OpenTabResult = { ok: true; terminal: string } | { ok: false };

/** Runs the plan (never through a shell); ok only when the opener exits with 0. */
export function openInNewTab(deps: OpenTabDeps): Promise<OpenTabResult> {
  const plan = planNewTab(deps.env, deps.platform, deps.cwd, deps.command);
  if (!plan) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    try {
      const child = deps.spawn(plan.file, plan.args, { stdio: "ignore", windowsHide: true });
      child.on("error", () => resolve({ ok: false }));
      child.on("close", (code) => resolve(code === 0 ? { ok: true, terminal: plan.terminal } : { ok: false }));
    } catch {
      resolve({ ok: false });
    }
  });
}
