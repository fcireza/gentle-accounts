import { spawn } from "node:child_process";

/** The part of pi's auth interaction this module drives (declared here: pi-ai is not resolvable under tests). */
type Prompt =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: readonly { id: string; label: string }[] };
type AuthEvent =
  | { type: "info"; message: string }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string };

export interface OauthProvider {
  login(interaction: { signal: AbortSignal; prompt(prompt: Prompt): Promise<string>; notify(event: AuthEvent): void }): Promise<Record<string, unknown>>;
}

/** The UI surface used while logging in; `ctx.ui` of a command satisfies it. */
export interface LoginUi {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** Best effort: opens a link in the default browser; a failure is silent (the link is also shown). */
/** No shell is involved (`rundll32` on Windows gets the URL as one argument), so `&` and friends in a URL are inert. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  if (!/^https?:\/\//i.test(url)) return;
  const [command, args] = platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // the link stays on screen
  }
}

/**
 * Runs the provider's own OAuth login (the same flow `/login` runs) with the command's UI and returns the stored
 * credential shape (`type: "oauth"`). Rejects when the user cancels a prompt or the provider fails.
 */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export async function runOauthLogin(provider: OauthProvider, ui: LoginUi, open: (url: string) => void = openBrowser, timeoutMs: number = LOGIN_TIMEOUT_MS): Promise<Record<string, unknown>> {
  // A login nobody completes must not hold the menu forever: abort the provider's flow and give up.
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("login timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([attempt(provider, ui, open, abort.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function attempt(provider: OauthProvider, ui: LoginUi, open: (url: string) => void, signal: AbortSignal): Promise<Record<string, unknown>> {
  const cancelled = (): never => {
    throw new Error("login cancelled");
  };
  const credential = await provider.login({
    signal,
    async prompt(prompt) {
      if (prompt.type === "select") {
        const picked = await ui.select(prompt.message, prompt.options.map((option) => option.label));
        const option = prompt.options.find((o) => o.label === picked);
        return option ? option.id : cancelled();
      }
      return (await ui.input(prompt.message, prompt.placeholder)) ?? cancelled();
    },
    notify(event) {
      if (event.type === "auth_url") {
        open(event.url);
        ui.notify(`Open this link to sign in: ${event.url}${event.instructions ? `\n${event.instructions}` : ""}`, "info");
      } else if (event.type === "device_code") {
        open(event.verificationUri);
        ui.notify(`Go to ${event.verificationUri} and enter the code ${event.userCode}`, "info");
      } else ui.notify(event.message, "info");
    },
  });
  return { ...credential, type: "oauth" };
}
