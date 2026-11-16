/** Shell command (undefined dir: Claude Code default, no env prefix) a user can paste to log a profile's Claude Code dir into a Claude account. */
export function claudeLoginCommand(claudeDir: string | undefined, platform: NodeJS.Platform = process.platform): string {
  if (claudeDir === undefined) return "claude auth login";
  if (platform === "win32") {
    return `$env:CLAUDE_CONFIG_DIR="${claudeDir}"; claude auth login`;
  }
  return `CLAUDE_CONFIG_DIR='${claudeDir.replaceAll("'", `'\\''`)}' claude auth login`;
}
