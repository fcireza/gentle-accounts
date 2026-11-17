/** Shell command (undefined dir: Claude Code default, no env prefix) a user can paste to log a profile's Claude Code dir into a Claude account. */
export function claudeLoginCommand(claudeDir: string | undefined, platform: NodeJS.Platform = process.platform): string {
  if (claudeDir === undefined) return "claude auth login";
  if (platform === "win32") {
    return `$env:CLAUDE_CONFIG_DIR="${claudeDir}"; claude auth login`;
  }
  return `CLAUDE_CONFIG_DIR='${claudeDir.replaceAll("'", `'\\''`)}' claude auth login`;
}

/** S22: the message that highlights the login command on its own prompt line (`PS> ` on Windows, `$ ` elsewhere). */
export function loginHint(profile: string, command: string, platform: NodeJS.Platform = process.platform): string {
  const prompt = platform === "win32" ? "PS> " : "$ ";
  return `To log profile "${profile}" into Claude Code, run this in ANOTHER terminal (it opens your browser):\n\n` +
    `  ${prompt}${command}\n\n` +
    `Or run it from a terminal with the launcher: gentle-accounts login ${profile}\n` +
    "When it finishes, run /gentle:accounts current to see the account.";
}
