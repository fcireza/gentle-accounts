[Español](../es/commands.md) | English

# Commands

What you will find here: the complete reference of the `/gentle:accounts` slash command and the `gentle-accounts` launcher, with every message they print. Messages are shown exactly as the code prints them, in English.

## Profile names

Names must match `^[a-z0-9][a-z0-9_-]{0,31}$`: lowercase letters, digits, `-` or `_`, starting with a letter or digit, up to 32 characters. An invalid name is rejected and nothing changes:

```
Invalid profile name "<name>": use lowercase letters, digits, "-" or "_" (max 32 chars).
```

## Slash command: `/gentle:accounts`

Available inside Gentle Shell and pi. Pressing Tab after `/gentle:accounts ` completes sub-commands and profile names. Messages appear as notifications.

### `/gentle:accounts`

With no argument, opens the accounts menu (the same as `/gentle:accounts menu`) when the interactive TUI is available. In RPC, print or json mode it opens a picker titled `Switch profile` with every profile instead; the active one is labeled `(active)`. Choosing one switches to it, exactly like `/gentle:accounts <name>`; closing the picker does nothing.

- No profiles (picker): `No profiles. Create one with /gentle:accounts create <name>` (warning).
- No interactive UI: shows the usage text (warning).

### `/gentle:accounts menu`

Opens the accounts menu, an overlay in the style of Gentle Shell's `/gentle:profiles` panel. It is a panel of about 60% of the chat column, centered in it: when Gentle Shell shows its sidebar the panel stays beside it instead of the full terminal, with the title `Gentle Accounts` centered in the top border and the key hints at the bottom; on narrow terminals it switches to a compact layout. Without the interactive TUI it falls back to the `Switch profile` picker.

- Header: `Account Default`, the session profile new sessions start on (`none` when it is not set), and `Account Session`, the profile this session is using (the one with the green `●`). The frame and the rules use the theme's `borderAccent` color.
- One row per profile: `●` marks the profile active in this session, `○` the others, `★` the default (session) profile, followed by the providers it is logged in to. The list shows eight profiles at a time and scrolls; `↑ N more` and `↓ N more` count the hidden ones.
- Providers: `→` on the selected profile opens one row per provider (Claude, Codex, Anthropic and every provider that `/login` offers, logged in or not, plus any logged in in any profile or in the live file) with `●` logged in or `○` not logged in, the ones with a login first, and `←` closes them. The email appears only on those rows (for Codex and the other OAuth providers only when the saved credential carries one) and only when the email display is shown, with the name masked after three characters and the domain as it is, for example `mar****@company.com`; while it is hidden nothing follows `logged in`. Opening the menu never runs `claude auth status` per profile: it reuses the status bar result for the active profile and reads files for the others.
- Key hints: the arrow keys (`↑↓`, `→←`, `enter`) on their own line, and the commands (`n`, `r`, `d`, `u`, `e`, `esc`...) on the next one. Each line uses short labels (`⏎ ok`, `del`, `session`) when the full ones do not fit; otherwise the commands wrap in groups.
- Detected logins: one `Detected login:` line per login found outside the profiles (see `i` below).
- With no profiles: `no profiles yet: press n to create one`.

| Key | Action |
| --- | --- |
| `↑` `↓` or `j` `k` | Previous or next profile; with the providers open, previous or next provider. |
| `→` or `l` | Open the providers of the selected profile. |
| `←` or `h` | Close the providers. |
| `Enter` | On a profile: switch (same rules and messages as `/gentle:accounts <name>`). On a provider row: log that provider in. |
| `n` | New profile (asks for a name with `New profile name`; same messages as `create`). |
| `d` | Delete the selected profile (same confirmation and refusals as `delete`). |
| `r` | Rename the selected profile (asks for the new name with `Rename profile "<name>" to`, the old name prefilled; an empty, unchanged or cancelled answer does nothing; same messages as `rename`). |
| `i` | Adopt the detected login as a new profile (asks for a name with `Name for the detected login`). Only while the menu shows a `Detected login:` line; the key hint `i adopt` appears only then. A live login cannot be adopted while the credentials file is linked (macOS and Linux): it answers `Cannot adopt a live login while the credentials file is linked to a profile: a login made there is saved in the current profile.` Adopting a detected Claude login still works. |
| `u` | Use session: this chat only uses the selected profile, without changing the other windows. Inside a session started with `gentle-accounts` it is that session's own switch. In a regular window, pi's agent folder is fixed at start, so the chat continues in `gentle-accounts <profile> --session <this chat>` in the same terminal (a private session home) and this window closes when it ends. It needs `gentle-accounts` on the `PATH`, waits for an idle turn needs a chat with a session file (not an ephemeral one), keeps this window open with a message if the launcher fails, and is not available on Windows yet. |
| `f` | Default: set the selected profile as the default (session) profile `★`, or clear it when it already is. |
| `e` | Toggle the email display (same messages as `email show` and `email hide`). |
| `g` | Open the `Account Usage` overlay (see `/gentle:accounts usage`). Only while the usage box is enabled; the key hint `g usage` appears only then. Closing it returns to the menu on the same profile. |
| `a` | Open the native `/gentle:usage` first and, when it closes, the `Account Usage` overlay (see `/gentle:accounts usage all`). The menu closes before the native usage opens and does not reopen. Only while the usage box is enabled; the key hint `a all usage` (short: `a usage+`) appears only then. |
| `o` | Open this project with the selected profile in a new terminal tab. Only on a provider row with a login; the key hint `o open in tab` appears only there. |
| `x` | Log the selected provider out of the profile (asks to confirm; removes its credentials from that profile only, the token is just forgotten on this machine). Only on a provider row with a login; for Claude it asks to confirm and runs `claude auth logout` with the profile's `CLAUDE_CONFIG_DIR`, and on the default folder that logs out every profile sharing it). |
| `Esc` or `Ctrl+C` | Close. |

Mouse, in `fullscreen` mode only (in the regular mode the terminal owns the mouse and the keyboard is the only way): moving the pointer over a row or a command hint highlights it (inside the open profile it follows the pointer; other profiles are selected with a click), a click selects the profile or provider under the pointer, a double click acts like `Enter`, and the wheel moves like `↑` `↓`. A click on a key hint (`n`, `r`, `d`, `u`, `e`, `g`, `a`, `i`, `o`, `x`, `esc`) does what pressing that key does; a click on `Account Default` or `Account Session` selects that profile, on `↑ N more` / `↓ N more` selects the neighbouring hidden profile, and on the detected-login line adopts it. Clicks on the frame and the rules do nothing.

Messages appear inside the menu, because notifications are hidden behind it.

Logging Claude in from its row asks `Log profile "<name>" into Claude Code` with three choices (the recommended one is marked `(recommended)`: `In a new terminal tab` for Claude, `In this terminal` for the other providers):

- `In a new terminal tab`: runs `claude auth login` with the profile's `CLAUDE_CONFIG_DIR` (removed for `default`) in a new tab and shows `Opened a new terminal tab (<terminal>) to log profile "<name>" into Claude Code. When it finishes, run /gentle:accounts current to see the account.` Supported terminals, in detection order: Windows Terminal (`wt`) on Windows; tmux (`$TMUX`); Terminal.app and iTerm2 on macOS (from `TERM_PROGRAM`); gnome-terminal, konsole, kitty and wezterm on Linux. When no tab can be opened it shows `Could not open a new terminal tab.` followed by the login command of `/gentle:accounts login claude`.
- `In this terminal`: stops the TUI, runs `claude auth login` in the same terminal (Ctrl+C goes to `claude`) and restores the TUI when it ends. Then it reloads the model registry and the status bar and shows `Claude Code login finished for profile "<name>".`, `claude auth login exited with code <code>.`, `claude auth login was stopped by <signal>.` or `Could not run claude auth login: <error>`.
- `Show the command`: shows the login command of `/gentle:accounts login claude`.

Codex, Anthropic and the other OAuth providers ask where to log in, with the same three choices as Claude Code: `In a new terminal tab` and `Show the command` start `gentle-accounts <name>` (a session on that profile; type `/login` there and choose the provider, and the login stays in the profile when the session ends), and `In this terminal` runs the provider's own login right here (the same flow `/login` runs), switching to the profile first when it is not the active one, opening the link in the browser and saving the credentials into that profile. Results: `Logged <provider> into profile "<name>".`, `Could not log <provider> in: <reason>` (error, nothing is written; a login nobody completes times out after 5 minutes), or `<provider> has no OAuth login here: run /login and choose it for the active profile.` (warning).

`o` runs `gentle-accounts <name>` in a new tab in the current folder and shows `Opened "<name>" in a new terminal tab (<terminal>): gentle-accounts <name>`. When no tab can be opened it shows `Open this project with "<name>" in a new terminal: gentle-accounts <name>`. The launcher alias or function must be available in the new tab (see [Installation](install.md)).

### `/gentle:accounts <name>`

Switches to `<name>`: saves the account credentials (Codex, Anthropic and any other oauth login) of the profile you leave, loads the ones of `<name>`, sets or removes `CLAUDE_CONFIG_DIR`, records the active profile, reloads pi's model registry and refreshes the status bar. See [How it works](how-it-works.md).

- Success: `Switched to profile "<name>". Claude Code dir: <dir>`, where `<dir>` is the profile's Claude folder or `(unset: Claude Code default)`.
- Already active: `Already on profile "<name>".`
- Invalid name: the invalid name message above (error).
- Missing profile: `Profile "<name>" does not exist.` (error).
- Agent busy: `Wait for the current turn to finish before switching profiles.` (warning). The idle check runs before anything is read or written, so nothing changes.
- Unreadable credentials file: the error message, for example `Cannot parse <path>: <reason>` (error). Every file is read before any is written, so nothing changes.

If no profile is active yet, `default` is created first from your current logins, so the switch never drops them.

### `/gentle:accounts list`

Lists the profiles, one per line, sorted; `* ` marks the active one:

```
* default
  work
```

With no profiles: `No profiles. Create one with /gentle:accounts create <name>`.

### `/gentle:accounts current`

Shows `Active profile: <name> (CLAUDE_CONFIG_DIR=<dir>)`, with `<dir>` being `(unset: Claude Code default)` for `default`, and refreshes the status bar. With no active profile: `No active profile.`

### `/gentle:accounts create <name>`

Creates an empty profile: a `claude/` folder and an `auth.json` with no credentials. It does not switch to it.

- Success: `Created profile "<name>". Switch with /gentle:accounts <name>, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.`
- Already exists: `Profile "<name>" already exists.` (error).
- Invalid name: the invalid name message (error).
- Reserved name (`menu`, `list`, `current`, `create`, `delete`, `login`, `rename`, `session`, `startup`, `email`, `usage`, `help`): `"<name>" is a reserved word (it is a subcommand). Pick another profile name.` (error). These words are subcommands, so a profile with one of these names could not be switched to with `/gentle:accounts <name>`. A profile that already has such a name keeps working from the menu and the picker. `session` and `rename` became reserved words in this version: a profile you had already created with one of those names stays on disk, but it can no longer be switched to by name. `rename` still accepts it as the old name, for example `/gentle:accounts rename session work`.
- No name: the usage text (warning).

### `/gentle:accounts delete <name>`

Deletes a profile folder after a confirmation dialog titled `Delete profile` that asks `Delete profile "<name>" and its Claude login and credentials? This cannot be undone.`

- Success: `Deleted profile "<name>".`
- Cancelled: `Delete cancelled.`
- Active profile: `Cannot delete the active profile "<name>". Switch to another profile first.` (error).
- Session profile: `Cannot delete the session profile "<name>". Set another one or clear it with "session last" first.` (error).
- Missing profile: `Profile "<name>" does not exist.` (error).
- No interactive UI: `Deleting needs a confirmation dialog; run it from the TUI.` (error).
- No name: the usage text (warning).

### `/gentle:accounts rename <old> <new>`

Renames a profile. Its folder moves in one atomic step, so the Claude login and the credentials come along and nothing is copied. The current profile and the session profile follow the new name, `CLAUDE_CONFIG_DIR` of this session keeps pointing at the moved Claude folder, and the status bar refreshes.

- Success: `Renamed profile "<old>" to "<new>".`
- When it was the current profile the success message adds: `Other open sessions that use it keep the old path until they switch or restart.` Those sessions still hold the old Claude folder path.
- Missing profile: `Profile "<old>" does not exist.` (error).
- Same name: `The new name is the same as the current one.` (error).
- Invalid or reserved new name: the invalid name message or the reserved name message (error).
- Already exists: `Profile "<new>" already exists.` (error).
- In use: `Cannot rename profile "<old>": a session started with gentle-accounts is using it. Close it first.` (error). Only sessions that are still running count; the ones whose launcher is gone are finished first, so their credentials are saved under the old name.
- Missing or extra words: the usage text (warning).

### `/gentle:accounts login claude`

Prints, but does not run, the command that logs the active profile into Claude Code, highlighted on its own line (`$ ` prompt, `PS> ` on Windows):

```
To log profile "<name>" into Claude Code, run this in ANOTHER terminal (it opens your browser):

  $ <command>

Or run it from a terminal with the launcher: gentle-accounts login <name>
When it finishes, run /gentle:accounts current to see the account.
```

The command is `claude auth login` for a profile on Claude Code's default folder, `CLAUDE_CONFIG_DIR='<dir>' claude auth login` on macOS and Linux, and `$env:CLAUDE_CONFIG_DIR="<dir>"; claude auth login` on Windows.

- No active profile: `No active profile.` (error).
- Anything other than `claude` after `login`: the usage text (warning).

### `/gentle:accounts session [<name>|last]`

Shows, sets or clears the session profile: the profile new sessions start on. Without it, new sessions start on the last used profile. See [How it works](how-it-works.md). `startup` still works as an alias of `session`, with the same behavior and output. "Session profile" means the profile new sessions start on, not the private per-session home that the launcher creates.

- `/gentle:accounts session`: shows `Session profile: <name>`, or `Session profile: none (new sessions start on the last used profile: <current>)`, where `<current>` is `none` when no profile is active.
- `/gentle:accounts session <name>`: sets it and shows `Session profile set to "<name>". New sessions start on it.`
- `/gentle:accounts session last`: clears it and shows `Session profile cleared. New sessions start on the last used profile.`
- Invalid name: the invalid name message (error).
- Missing profile: `Profile "<name>" does not exist.` (error).

Setting the session profile does not switch the current session. An explicit `gentle-accounts <name>` launch wins for that launch: the launcher sets `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` for gentle-shell and the extension then skips the session profile. The session profile is applied only when pi starts, not on `/new`, `/resume`, `/fork` or `/reload`.

### `/gentle:accounts email [show|hide]`

Shows or sets whether the status bar shows the full email of the active profile. By default it is hidden and the status bar shows only the profile name.

- `/gentle:accounts email`: shows `Email display: hidden (not shown in the status bar)` or `Email display: shown (full email in the status bar)`.
- `/gentle:accounts email show`: sets it and shows `Email display set to shown. The status bar shows the full email.`
- `/gentle:accounts email hide`: sets it and shows `Email display set to hidden. The status bar does not show the email.`
- Any other argument, or extra words after `show` or `hide`: `Usage: /gentle:accounts email [show|hide]` (warning). Nothing changes.
- Settings file cannot be written: `Could not save the email display setting (<code>).` (error), where `<code>` is the system error code (for example `EACCES`). Nothing changes.

After `show` or `hide` the status bar is refreshed right away. The setting is global to the agent dir (`profiles/settings.json`, see [How it works](how-it-works.md)) and is read on every status refresh, so a change made from the CLI shows up in an open session at its next refresh. These messages never contain the email.

Warning: with `show`, anyone who sees your screen can read the full address, including screen shares, screenshots and recordings.

### `/gentle:accounts usage [on|off]`

Opens the `Account Usage` overlay: a framed panel, in the same style as the accounts menu, with one block per profile. `●` marks the profile this session uses and `○` the others. Under each profile there is one row per provider that has reported usage (provider name, plan when known, and `updated <time> ago`) and, for each window (`5h`, `week`...), a 10-cell meter, the percent used and when it resets. A profile with nothing yet shows `no usage seen yet`. It closes with `Esc`, `Enter`, `Ctrl+C` or a click on `esc close`. Without the TUI the same box is printed as plain text.

It only shows usage that was already seen: whenever the active account's Anthropic or Codex response reports its rate limits, the numbers (percent used, window label, reset time and the time they were seen) are saved in that profile's folder as `usage.json`. It makes no request of its own and never reads or stores a token or the headers, so usage arrives only while that account is the active one, and a profile you have not used since shows `no usage seen yet` or the last numbers it saw. Deleting a profile deletes them and renaming it moves them. Gentle Shell's own `/gentle:usage` panel is not changed in any way: this box is a separate overlay and the native usage stays as it is.

- `/gentle:accounts usage`: opens the overlay.
- `/gentle:accounts usage all`: opens the native `/gentle:usage` first and, once it closes, the `Account Usage` overlay: one flow, nothing of Gentle Shell is changed. If the native usage is not available it opens only the overlay and shows `Native Gentle Shell usage is not available; showing the account usage only.` (info). While the box is disabled it shows the disabled warning below and opens nothing.
- `/gentle:accounts usage off`: disables the box and shows `Account usage box disabled. The native Gentle Shell usage is unchanged.` Nothing is captured while it is disabled, and the menu hides the `g usage` hint and key.
- `/gentle:accounts usage on`: enables it and shows `Account usage box enabled.`
- While disabled, `/gentle:accounts usage` shows `Account usage box is disabled. Enable it with /gentle:accounts usage on.` (warning).
- Any other argument: `Usage: /gentle:accounts usage [on|off]` (warning). Nothing changes.
- Settings file cannot be written: `Could not save the account usage setting (<code>).` (error). Nothing changes.

The `Gentle Accounts` card: while the usage box is enabled and the session has a UI, a small framed card sits below the editor. It shows `Default` (the profile new sessions start on, or `none`), `Session` (the profile this session uses) and `Usage`, one row per profile (at most 5, then `+N more`): `●` for the profile this session uses and `○` for the others, with its last seen numbers such as `Claude Bridge 5h 62% · 7d 20%`, or `no usage yet`. The numbers are the last ones seen, not live. It refreshes after each turn, response, switch, rename, create, delete and usage change, and it disappears with `/gentle:accounts usage off` (or `gentle-accounts usage off`). Long rows are cut with an ellipsis, never wrapped.

The setting is the key `usageBox` of `profiles/settings.json` (see [How it works](how-it-works.md)); it is enabled by default.

### `/gentle:accounts help`

`help` and `--help` show the usage text:

```
/gentle:accounts                 open the accounts menu (picker without the TUI)
/gentle:accounts menu            open the accounts menu
/gentle:accounts <name>          switch to <name>
/gentle:accounts list            list profiles (* marks the active one)
/gentle:accounts current         show the active profile
/gentle:accounts create <name>   create an empty profile
/gentle:accounts delete <name>   delete a profile (asks for confirmation)
/gentle:accounts rename <old> <new>  rename a profile (its logins move with it)
/gentle:accounts login claude    show the command that logs the active profile into Claude Code
/gentle:accounts session [<name>|last]  show, set or clear the profile new sessions start on (alias: startup)
/gentle:accounts email [show|hide]      show or set whether the status bar shows the full email
/gentle:accounts usage [on|off]         open the per-account usage box, or turn it on or off
/gentle:accounts usage all              open the native usage, then the per-account usage box
```

### Extension hooks

Besides the command, the extension registers:

- **Session start**: creates `default` when no profile is active, otherwise sets `CLAUDE_CONFIG_DIR` for the active profile unless the environment already sets it; then, if a session profile is set and is not the active one, switches to it and shows `Started on profile "<name>" (session profile).` (never in a session started by the launcher); starts a 60 s status refresh timer and shows the status. If a credentials file cannot be read it shows `gentle-accounts: <message>` (error) and continues.
- **Provider response**: while the usage box is enabled, saves the rate limits the response reported under the active profile (see `/gentle:accounts usage`).
- **Agent end**: refreshes the status after every agent turn.
- **Session shutdown**: stops the 60 s timer.

## CLI: `gentle-accounts`

The optional launcher (`bin/gentle-accounts.mjs`). It needs Node 22.18 or newer; otherwise it prints `gentle-accounts needs Node 22.18 or newer (found <version>).` and exits with code 1. It works on the agent dir from `PI_CODING_AGENT_DIR`, then `GENTLE_SHELL_HOME`, then `~/.gentle-shell/agent`.

| Command | Output | Exit code |
| --- | --- | --- |
| `gentle-accounts` | usage on stderr | 1 |
| `gentle-accounts --help`, `-h` or `help` | usage on stdout | 0 |
| `gentle-accounts list` | profiles, `* ` marks the active one | 0 |
| `gentle-accounts current` | the active profile name or `No active profile.` | 0 |
| `gentle-accounts create <name>` | `Created profile "<name>".` | 0, or 1 on error |
| `gentle-accounts rename <old> <new>` | renames a profile | 0, or 1 on error |
| `gentle-accounts login <name>` | runs `claude auth login` | exit code of `claude`, or 1 on error |
| `gentle-accounts session [<name>\|last]` | shows, sets or clears the session profile | 0, or 1 on error |
| `gentle-accounts email [show\|hide]` | shows or sets the email display | 0, or 1 on a usage error |
| `gentle-accounts usage [on\|off]` | shows or sets the account usage box | 0, or 1 on a usage error |
| `gentle-accounts <name> [args...]` | starts `gentle-shell` | exit code of `gentle-shell`, or 1 on error |

Usage text:

```
Usage:
  gentle-accounts <name> [gentle-shell args...]   start gentle-shell with profile <name>
  gentle-accounts list                            list profiles (* marks the active one)
  gentle-accounts current                         print the active profile
  gentle-accounts create <name>                   create an empty profile
  gentle-accounts rename <old> <new>              rename a profile (its logins move with it)
  gentle-accounts login <name>                    run `claude auth login` for that profile's Claude dir
  gentle-accounts session [<name>|last]           show, set or clear the profile new sessions start on (alias: startup)
  gentle-accounts email [show|hide]               show or set whether the status bar shows the full email
  gentle-accounts usage [on|off]                  show or set the per-account usage box of the accounts overlay
  gentle-accounts --help                          show this help
```

### `gentle-accounts list`

Prints the sorted profiles with `* ` before the active one. With none: `No profiles. Create one with: gentle-accounts create <name>`.

### `gentle-accounts current`

Prints the active profile name, or `No active profile.`

### `gentle-accounts create <name>`

Creates an empty profile and prints `Created profile "<name>".`. On an invalid or existing name it prints the error (`Invalid profile name ...`, the reserved name message or `Profile "<name>" already exists.`) on stderr and exits with 1. Without a name it prints the usage on stderr and exits with 1.

### `gentle-accounts rename <old> <new>`

Same as `/gentle:accounts rename`, with the same messages: the success message on stdout with exit code 0, every refusal and the usage text on stderr with exit code 1. It does not touch other running sessions.

### `gentle-accounts login <name>`

Runs `claude auth login` with the terminal attached, with `CLAUDE_CONFIG_DIR` set to the profile's Claude folder, or removed for a profile on Claude Code's default folder. It does not switch profiles. Without a name it prints the usage; for a missing profile it prints `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`; both exit with 1. If `claude` cannot be started it prints `Cannot run claude: <error>` and exits with 1.

### `gentle-accounts session [<name>|last]`

Same as `/gentle:accounts session`, with the same messages: without an argument it prints the session profile, `last` clears it and a name sets it. Messages go to stdout with exit code 0; an invalid name (`Invalid profile name ...`) or a missing profile (`Profile "<name>" does not exist.`) goes to stderr with exit code 1.

```sh
gentle-accounts session work   # new sessions start on "work"
gentle-accounts session        # show it
gentle-accounts session last   # back to the last used profile
```

### `gentle-accounts email [show|hide]`

Same as `/gentle:accounts email`, with the same messages, on stdout with exit code 0. Any other argument, or extra words after the mode, prints `Usage: gentle-accounts email [show|hide]` on stderr and exits with 1; a settings file that cannot be written prints `Could not save the email display setting (<code>).` on stderr and exits with 1. An open session picks up the change at its next status refresh (after an agent turn, every 60 seconds, or on `/gentle:accounts current`).

```sh
gentle-accounts email show   # full email in the status bar
gentle-accounts email        # show the current value
gentle-accounts email hide   # back to hiding the email
```

### `gentle-accounts usage [on|off]`

Same as `/gentle:accounts usage on` and `off`, with the same messages, on stdout with exit code 0. Without an argument it prints `Account usage box: enabled` or `Account usage box: disabled`. Any other argument prints `Usage: gentle-accounts usage [on|off]` on stderr and exits with 1; a settings file that cannot be written prints `Could not save the account usage setting (<code>).` on stderr and exits with 1.

### `gentle-accounts <name> [args...]`

Starts `gentle-shell` on `<name>` in a private session home, without changing the global active profile: the session gets its own `auth.json`, a link to the profile's own file on macOS and Linux and a private copy on Windows or if linking fails, `CLAUDE_CONFIG_DIR` for the profile (removed for `default`) and `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>`. The remaining arguments are passed to `gentle-shell`. When it exits the home is removed; a private copy is merged back into the profile first, a link needs nothing. See [How it works](how-it-works.md). It creates `default` first when no profile is active. On Windows `gentle-shell` and `claude` start through the shell so `.cmd` shims resolve.

- Missing profile: `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`, exit 1.
- `--home`, `--link` or `--isolated` in the arguments: `gentle-accounts manages the agent home; do not pass --home, --link or --isolated.`, exit 1.
- Unreadable credentials file: the error message, exit 1, nothing changed.
- Invalid shared `settings.json`: `gentle-accounts: cannot read <path>: <message>`, exit 1, nothing created.
- Unsafe temporary folder (POSIX): `gentle-accounts: refusing to use <path>: <reason>`, exit 1.
- `gentle-shell` cannot be started: `Cannot run gentle-shell: <error>`, exit 1.

```sh
gentle-accounts work                  # open Gentle Shell as "work"
gentle-accounts login work            # log "work" into Claude
```
