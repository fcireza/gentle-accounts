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

Opens the accounts menu, an overlay in the style of Gentle Shell's `/gentle:profiles` panel. Without the interactive TUI it falls back to the `Switch profile` picker.

- Header: the mode (`session home` when the session was started by the launcher, `global` otherwise) and the email display (`shown` or `hidden`).
- One tab per profile: `◉` marks the profile active in this session, `★` the startup profile.
- Rows: the profile row (`Switch to "<name>"`, or `Profile "<name>"` for the active one), then one row per provider (Claude, Codex, Anthropic) with `●` logged in or `○` not logged in. The email is masked unless the email display is shown. Opening the menu never runs `claude auth status` per profile: it reuses the status bar result for the active profile and reads files for the others.
- With no profiles: `no profiles yet: press n to create one`.

| Key | Action |
| --- | --- |
| `←` `→` or `h` `l` | Previous or next profile. |
| `↑` `↓` or `j` `k` | Previous or next row. |
| `Enter` | On the profile row: switch (same rules and messages as `/gentle:accounts <name>`). On a provider row: log that provider in. |
| `n` | New profile (asks for a name with `New profile name`; same messages as `create`). |
| `d` | Delete the selected profile (same confirmation and refusals as `delete`). |
| `s` | Set the selected profile as the startup profile, or clear it when it already is. |
| `e` | Toggle the email display (same messages as `email show` and `email hide`). |
| `o` | Open this project with the selected profile in a new terminal tab. |
| `Esc` or `Ctrl+C` | Close. |

Messages appear inside the menu, because notifications are hidden behind it.

Logging Claude in from its row asks `Log profile "<name>" into Claude Code` with three choices:

- `In a new terminal tab`: runs `claude auth login` with the profile's `CLAUDE_CONFIG_DIR` (removed for `default`) in a new tab and shows `Opened a new terminal tab (<terminal>) to log profile "<name>" into Claude Code. When it finishes, run /gentle:accounts current to see the account.` Supported terminals, in detection order: Windows Terminal (`wt`) on Windows; tmux (`$TMUX`); Terminal.app and iTerm2 on macOS (from `TERM_PROGRAM`); gnome-terminal, konsole, kitty and wezterm on Linux. When no tab can be opened it shows `Could not open a new terminal tab.` followed by the login command of `/gentle:accounts login claude`.
- `In this terminal`: stops the TUI, runs `claude auth login` in the same terminal (Ctrl+C goes to `claude`) and restores the TUI when it ends. Then it reloads the model registry and the status bar and shows `Claude Code login finished for profile "<name>".`, `claude auth login exited with code <code>.`, `claude auth login was stopped by <signal>.` or `Could not run claude auth login: <error>`.
- `Show the command`: shows the login command of `/gentle:accounts login claude`.

Codex and Anthropic use pi's own `/login`, which an extension cannot run. For the active profile the menu closes, writes `/login` in the editor and shows `Press Enter to run /login and choose <provider> for profile "<name>".`. For another profile it shows `/login signs in the active profile. Switch to "<name>" first, then log <provider> in.` (warning).

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
- No name: the usage text (warning).

### `/gentle:accounts delete <name>`

Deletes a profile folder after a confirmation dialog titled `Delete profile` that asks `Delete profile "<name>" and its Claude login and credentials? This cannot be undone.`

- Success: `Deleted profile "<name>".`
- Cancelled: `Delete cancelled.`
- Active profile: `Cannot delete the active profile "<name>". Switch to another profile first.` (error).
- Startup profile: `Cannot delete the startup profile "<name>". Set another one or clear it with "startup last" first.` (error).
- Missing profile: `Profile "<name>" does not exist.` (error).
- No interactive UI: `Deleting needs a confirmation dialog; run it from the TUI.` (error).
- No name: the usage text (warning).

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

### `/gentle:accounts startup [<name>|last]`

Shows, sets or clears the startup profile: the profile new sessions start on. Without it, new sessions start on the last used profile. See [How it works](how-it-works.md).

- `/gentle:accounts startup`: shows `Startup profile: <name>`, or `Startup profile: none (new sessions start on the last used profile: <current>)`, where `<current>` is `none` when no profile is active.
- `/gentle:accounts startup <name>`: sets it and shows `Startup profile set to "<name>". New sessions start on it.`
- `/gentle:accounts startup last`: clears it and shows `Startup profile cleared. New sessions start on the last used profile.`
- Invalid name: the invalid name message (error).
- Missing profile: `Profile "<name>" does not exist.` (error).

Setting the startup profile does not switch the current session. An explicit `gentle-accounts <name>` launch wins for that launch: the launcher sets `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` for gentle-shell and the extension then skips the startup profile. The startup profile is applied only when pi starts, not on `/new`, `/resume`, `/fork` or `/reload`.

### `/gentle:accounts email [show|hide]`

Shows or sets whether the status bar shows the full email of the active profile. By default it is hidden and the status bar shows a masked email.

- `/gentle:accounts email`: shows `Email display: hidden (masked in the status bar)` or `Email display: shown (full email in the status bar)`.
- `/gentle:accounts email show`: sets it and shows `Email display set to shown. The status bar shows the full email.`
- `/gentle:accounts email hide`: sets it and shows `Email display set to hidden. The status bar shows a masked email.`
- Any other argument: `Usage: /gentle:accounts email [show|hide]` (warning). Nothing changes.

After `show` or `hide` the status bar is refreshed right away. The setting is global to the agent dir (`profiles/settings.json`, see [How it works](how-it-works.md)) and is read on every status refresh, so a change made from the CLI shows up in an open session at its next refresh. These messages never contain the email.

Warning: with `show`, anyone who sees your screen can read the full address, including screen shares, screenshots and recordings.

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
/gentle:accounts login claude    show the command that logs the active profile into Claude Code
/gentle:accounts startup [<name>|last]  show, set or clear the profile new sessions start on
/gentle:accounts email [show|hide]      show or set whether the status bar shows the full email
```

### Extension hooks

Besides the command, the extension registers:

- **Session start**: creates `default` when no profile is active, otherwise sets `CLAUDE_CONFIG_DIR` for the active profile unless the environment already sets it; then, if a startup profile is set and is not the active one, switches to it and shows `Started on profile "<name>" (startup profile).` (never in a session started by the launcher); starts a 60 s status refresh timer and shows the status. If a credentials file cannot be read it shows `gentle-accounts: <message>` (error) and continues.
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
| `gentle-accounts login <name>` | runs `claude auth login` | exit code of `claude`, or 1 on error |
| `gentle-accounts startup [<name>\|last]` | shows, sets or clears the startup profile | 0, or 1 on error |
| `gentle-accounts email [show\|hide]` | shows or sets the email display | 0, or 1 on a usage error |
| `gentle-accounts <name> [args...]` | starts `gentle-shell` | exit code of `gentle-shell`, or 1 on error |

Usage text:

```
Usage:
  gentle-accounts <name> [gentle-shell args...]   start gentle-shell with profile <name>
  gentle-accounts list                            list profiles (* marks the active one)
  gentle-accounts current                         print the active profile
  gentle-accounts create <name>                   create an empty profile
  gentle-accounts login <name>                    run `claude auth login` for that profile's Claude dir
  gentle-accounts startup [<name>|last]           show, set or clear the profile new sessions start on
  gentle-accounts email [show|hide]               show or set whether the status bar shows the full email
  gentle-accounts --help                          show this help
```

### `gentle-accounts list`

Prints the sorted profiles with `* ` before the active one. With none: `No profiles. Create one with: gentle-accounts create <name>`.

### `gentle-accounts current`

Prints the active profile name, or `No active profile.`

### `gentle-accounts create <name>`

Creates an empty profile and prints `Created profile "<name>".`. On an invalid or existing name it prints the error (`Invalid profile name ...` or `Profile "<name>" already exists.`) on stderr and exits with 1. Without a name it prints the usage on stderr and exits with 1.

### `gentle-accounts login <name>`

Runs `claude auth login` with the terminal attached, with `CLAUDE_CONFIG_DIR` set to the profile's Claude folder, or removed for a profile on Claude Code's default folder. It does not switch profiles. Without a name it prints the usage; for a missing profile it prints `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`; both exit with 1. If `claude` cannot be started it prints `Cannot run claude: <error>` and exits with 1.

### `gentle-accounts startup [<name>|last]`

Same as `/gentle:accounts startup`, with the same messages: without an argument it prints the startup profile, `last` clears it and a name sets it. Messages go to stdout with exit code 0; an invalid name (`Invalid profile name ...`) or a missing profile (`Profile "<name>" does not exist.`) goes to stderr with exit code 1.

```sh
gentle-accounts startup work   # new sessions start on "work"
gentle-accounts startup        # show it
gentle-accounts startup last   # back to the last used profile
```

### `gentle-accounts email [show|hide]`

Same as `/gentle:accounts email`, with the same messages, on stdout with exit code 0. Any other argument prints `Usage: gentle-accounts email [show|hide]` on stderr and exits with 1. An open session picks up the change at its next status refresh (after an agent turn, every 60 seconds, or on `/gentle:accounts current`).

```sh
gentle-accounts email show   # full email in the status bar
gentle-accounts email        # show the current value
gentle-accounts email hide   # back to the masked email
```

### `gentle-accounts <name> [args...]`

Starts `gentle-shell` on `<name>` in a private session home, without changing the global active profile: the session gets its own `auth.json` with the profile's credentials, `CLAUDE_CONFIG_DIR` for the profile (removed for `default`) and `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>`. The remaining arguments are passed to `gentle-shell`. When it exits, the session's credentials are copied back into the profile and the home is removed. See [How it works](how-it-works.md). It creates `default` first when no profile is active. On Windows `gentle-shell` and `claude` start through the shell so `.cmd` shims resolve.

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
