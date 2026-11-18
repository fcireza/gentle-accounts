/**
 * S32 same-terminal login: hand the terminal over to `claude auth login` (precedent: gentle-pi's
 * gentle-music `runInherit` / `handOverTerminal`). The TUI is stopped, the child inherits stdio, SIGINT is
 * ignored by pi while the child runs (Ctrl+C belongs to the child), and the TUI is always restored.
 */

export type InheritResult = { code: number | null; signal: NodeJS.Signals | null } | { error: unknown };

export interface InheritChild {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
export type InheritSpawn = (file: string, args: readonly string[], options: { stdio: "inherit"; env: NodeJS.ProcessEnv; shell: boolean }) => InheritChild;

export interface LoginSignals {
  on(signal: "SIGINT", handler: () => void): unknown;
  off(signal: "SIGINT", handler: () => void): unknown;
}

interface TerminalOwner {
  stop(): void;
  start(): void;
  requestRender(force?: boolean): void;
}

export interface LoginHereDeps {
  spawn: InheritSpawn;
  signals: LoginSignals;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

interface CustomUi {
  ui: { custom<T>(factory: (tui: TerminalOwner, theme: unknown, keybindings: unknown, done: (result: T) => void) => unknown): Promise<T> };
}

function runInherit(spawn: InheritSpawn, file: string, args: readonly string[], env: NodeJS.ProcessEnv, shell: boolean): Promise<InheritResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, { stdio: "inherit", env, shell });
      child.on("error", (error) => resolve({ error }));
      child.on("close", (code, signal) => resolve({ code, signal }));
    } catch (error) {
      resolve({ error });
    }
  });
}

async function handOverTerminal<T>(tui: TerminalOwner, signals: LoginSignals, run: () => Promise<T>): Promise<T> {
  const ignoreSigint = () => {};
  signals.on("SIGINT", ignoreSigint);
  try {
    tui.stop();
    return await run();
  } finally {
    signals.off("SIGINT", ignoreSigint);
    tui.start();
    tui.requestRender(true);
  }
}

/** The child env: the profile's CLAUDE_CONFIG_DIR, or the variable removed (S16 default profile). */
export function loginEnv(base: NodeJS.ProcessEnv, claudeDir: string | undefined): NodeJS.ProcessEnv {
  const env = { ...base };
  if (claudeDir === undefined) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = claudeDir;
  return env;
}

/** Runs `claude auth login` in this terminal; resolves after the TUI is restored and `done` was called. */
export function runClaudeLoginHere(ctx: CustomUi, claudeDir: string | undefined, deps: LoginHereDeps): Promise<InheritResult> {
  const env = loginEnv(deps.env, claudeDir);
  // `shell: true` only on win32 for the `.cmd` shim; the arguments are fixed.
  const shell = deps.platform === "win32";
  return ctx.ui.custom<InheritResult>((tui, _theme, _keybindings, done) => {
    void handOverTerminal(tui, deps.signals, () => runInherit(deps.spawn, "claude", ["auth", "login"], env, shell))
      .then(done, (error: unknown) => done({ error }));
    // The editor slot stays empty while the child owns the terminal.
    return { render: () => [], invalidate: () => {} };
  });
}
