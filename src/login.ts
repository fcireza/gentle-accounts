/** Shell command a user can paste to log a profile's Claude Code dir into a Claude account. */
export function claudeLoginCommand(claudeDir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `$env:CLAUDE_CONFIG_DIR="${claudeDir}"; claude auth login`;
  }
  return `CLAUDE_CONFIG_DIR='${claudeDir.replaceAll("'", `'\\''`)}' claude auth login`;
}
