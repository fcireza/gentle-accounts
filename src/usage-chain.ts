import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The native Gentle Shell usage command (registered by gentle-pi, not by this package). */
export const NATIVE_USAGE_COMMAND = "gentle:usage";

export const NATIVE_USAGE_UNAVAILABLE_MESSAGE = "Native Gentle Shell usage is not available; showing the account usage only.";

/**
 * Runs the native `/gentle:usage` and resolves when its overlay closes. "unavailable" when the command is not
 * registered or the call fails. Never throws.
 */
export async function openNativeUsage(pi: Pick<ExtensionAPI, "getCommands" | "sendUserMessage">): Promise<"opened" | "unavailable"> {
  try {
    const known = pi.getCommands().some((c) => c.name === NATIVE_USAGE_COMMAND || c.name === `/${NATIVE_USAGE_COMMAND}`);
    if (!known) return "unavailable";
    await pi.sendUserMessage(`/${NATIVE_USAGE_COMMAND}`, { expandPromptTemplates: true } as never);
    return "opened";
  } catch {
    return "unavailable";
  }
}
