[Español](../es/troubleshooting.md) | English

# Troubleshooting

What you will find here: known symptoms, their cause and the fix. Every row is based on the source code or on measured evidence; rows marked "not verified" could not be checked on a real system.

## Symptoms

| Symptom | Cause | Fix |
| --- | --- | --- |
| The status bar shows `not logged in` right after you logged in | The status refreshes on start, after a switch, on `/gentle:accounts current`, after every agent turn and every 60 seconds; a login made in another terminal is seen at the next refresh. | Run `/gentle:accounts current`. If it still says `not logged in`, check that the login command used the profile's Claude folder shown by `/gentle:accounts current`, or run `gentle-accounts login <profile>`. |
| The status bar shows a masked email and I want the full one | The email is hidden by default (`showEmail` is not `true` in `profiles/settings.json`). | Run `/gentle:accounts email show` (or `gentle-accounts email show`). Anyone who sees your screen can then read it; `/gentle:accounts email hide` masks it again. |
| I changed the setting from the CLI and the open session still shows the old text | The open session reads the setting on its next status refresh: after an agent turn or every 60 seconds. | Wait for the refresh, or run `/gentle:accounts current`. |
| On macOS the `default` login looks logged out | `CLAUDE_CONFIG_DIR` was set to `~/.claude`; the keychain entry depends on that variable, so Claude Code no longer finds the login. | Do not set `CLAUDE_CONFIG_DIR=~/.claude` in your shell. Leave it unset for `default`; see [How it works](how-it-works.md). |
| Both `/profile` and `/gentle:accounts` exist | The old `gentle-profiles` package is still installed next to the new one. | Remove the `git:github.com/fcireza/gentle-profiles` line from `packages` in `settings.json` and restart. |
| `Cannot parse <path>: <reason>` | That `auth.json` (pi's live one or a profile's) is not valid JSON or is not a JSON object. The switch read every file first, so nothing was changed. | Fix the JSON in that file or restore it from a backup, then switch again. At session start the same error shows as `gentle-accounts: Cannot parse ...`. |
| `Cannot delete the startup profile "<name>". Set another one or clear it with "startup last" first.` | New sessions start on that profile, so it cannot be deleted. | Run `/gentle:accounts startup last` (or set another startup profile), then delete it. |
| The session did not start on the startup profile | It was started with an explicit `gentle-accounts <name>`, which wins for that launch (`GENTLE_ACCOUNTS_LAUNCH_PROFILE` is set). | Start gentle-shell without a profile name to use the startup profile. |
| `Startup profile "<name>" does not exist; starting on the last used profile.` | The startup profile was deleted outside `/gentle:accounts`. Nothing was changed. | Run `/gentle:accounts startup <name>` with an existing profile, or `/gentle:accounts startup last`. |
| Two open sessions end up on different accounts, or a session suddenly uses another account's Codex or Anthropic credentials | Known limit: the active profile and the startup profile are global to the agent dir. Claude's `CLAUDE_CONFIG_DIR` is per process, but Codex and Anthropic credentials live in the single `auth.json` that every open session shares, so a session that switches profile (at start or by command) changes what the others read. | Use one profile at a time per agent dir. Per-session isolation is not supported; see [How it works](how-it-works.md). |
| `Wait for the current turn to finish before switching profiles.` | The agent is busy; switching is only allowed when it is idle. | Wait for the turn to end, then run the command again. |
| `gentle-accounts: command not found` (or the PowerShell equivalent) | Installing from git does not put the launcher on your `PATH`. | Add the alias or PowerShell function from [Installation](install.md), or run `node <clone>/bin/gentle-accounts.mjs` directly. |
| `gentle-accounts needs Node 22.18 or newer (found <version>).` | The launcher runs the TypeScript sources with Node's built-in type stripping. | Install Node 22.18 or newer and make sure `node` on `PATH` is that version. |
| `Cannot run gentle-shell: <error>` | `gentle-shell` is not on the `PATH` of the terminal where you ran `gentle-accounts <name>`. The switch already happened. | Install Gentle Shell or add it to `PATH`. With plain pi, use `/gentle:accounts <name>` inside pi instead. On Windows the launcher goes through the shell, so the shell's own "not recognized" error may appear instead (not verified). |
| `Cannot run claude: <error>` | The `claude` CLI is not on `PATH`. | Install Claude Code and check `claude --version` in the same terminal. |
| On Windows the printed login command fails for an unusual path | The Windows command puts the folder in double quotes, `$env:CLAUDE_CONFIG_DIR="<dir>"`, without escaping; a path with `"` or `$` would need manual quoting (not verified on Windows). | Edit the quoting by hand, or use `gentle-accounts login <profile>`, which passes the variable without a shell command line. |
| On Windows `gentle-shell` or `claude` installed through npm is not found | npm installs `.cmd` shims on Windows. | The launcher already runs them through the shell for that reason. If it still fails, check that `where.exe gentle-shell` finds them (not verified on a real Windows machine; covered by the CI matrix only). |
| A Codex or Anthropic profile stopped working after you used the same login elsewhere | OAuth refresh tokens rotate; when another tool refreshes the same login, the copy saved in the profile can go stale. | Switch to that profile and log in again with `/login`. |
| The status bar does not appear and `/gentle:accounts` is unknown | The extension is not loaded: the package is not in that agent dir's `settings.json`, or Gentle Shell or pi was not restarted. | Check the `packages` list in `settings.json` for `git:github.com/fcireza/gentle-accounts`, then restart. |
| The launcher shows different profiles than Gentle Shell or pi | The launcher reads `PI_CODING_AGENT_DIR`, then `GENTLE_SHELL_HOME`, then `~/.gentle-shell/agent`; plain pi uses `~/.pi/agent`. | Set `PI_CODING_AGENT_DIR` to the agent dir you use before running the launcher. |

## Still stuck

Open an issue at [github.com/fcireza/gentle-accounts/issues](https://github.com/fcireza/gentle-accounts/issues) with the exact message. Never paste tokens or the contents of `auth.json`.
