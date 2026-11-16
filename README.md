# gentle-profiles

Use **more than one account** in [Gentle Shell](https://gentlemanprogramming.com/gentle-hub/) (and pi): a `work` Claude and a `personal` Claude, two Codex logins, and so on. Switch between them with one command, and always see which account is active.

Works on Linux, macOS and Windows.

```
status bar:   work · you@company.com
```

## What it does

Gentle Shell talks to Claude through [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge), which uses the login of the `claude` CLI. That login lives in one folder, so normally you get one account. This package gives every **profile** its own folder and its own credentials, and swaps them when you switch:

| Provider | What a profile keeps |
| --- | --- |
| Claude (via claude-bridge) | its own Claude Code login (a separate `CLAUDE_CONFIG_DIR`) |
| Codex (`openai-codex`) | its own credentials in pi's `auth.json` |
| Anthropic (pi's native provider) | its own credentials in pi's `auth.json` |

Any other provider you have in pi is left alone.

## Install

### In Gentle Shell

```sh
gentle-shell -- install git:github.com/fcireza/gentle-profiles
```

Everything after `--` goes to pi, which clones the package into Gentle Shell's home (`~/.gentle-shell/agent`) and adds it to that home's `settings.json`. Restart Gentle Shell and `/profile` is available. Gentle Shell options such as `--home <path>` go before the `--`.

### In plain pi

```sh
pi install git:github.com/fcireza/gentle-profiles
```

Requirements: pi 1.5.1 or newer, the `claude` CLI and pi-claude-bridge for Claude profiles, and Node 22.18 or newer for the launcher.

### The `gentle-profiles` launcher (optional)

The extension already gives you `/profile` inside Gentle Shell. The launcher is for starting a session already on a profile. Installing the package from git does not put it on your `PATH`, so call it by path or add an alias:

```sh
# bash / zsh
alias gentle-profiles='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-profiles/bin/gentle-profiles.mjs'
```

```powershell
# PowerShell profile
function gentle-profiles { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-profiles\bin\gentle-profiles.mjs" @args }
```

## Update and remove

Reinstalling pulls the latest `main`. To remove it, delete the `git:github.com/fcireza/gentle-profiles` line from the `packages` list in `~/.gentle-shell/agent/settings.json`. Your profiles stay on disk under `profiles/` until you delete that folder.

## Quick start

The first time it loads, your current logins are wrapped into a profile called `default`. Nothing is moved or copied, so everything keeps working.

1. Create a second profile and switch to it, inside Gentle Shell:
   ```
   /profile create work
   /profile work
   ```
2. Log that profile into Claude. This prints a command; run it in **another terminal**:
   ```
   /profile login claude
   ```
3. Log into Codex or Anthropic with pi's normal `/login`, if you use them.
4. Switch back and forth whenever you want:
   ```
   /profile default
   /profile work
   ```

The status bar shows `profile · account email` and updates when you switch.

## Commands

### Inside Gentle Shell: `/profile`

| Command | What it does |
| --- | --- |
| `/profile` | Opens a picker with your profiles and switches to the one you choose. |
| `/profile <name>` | Switches to `<name>`. If it is already active: `Already on profile "<name>".` |
| `/profile list` | Lists profiles. `*` marks the active one. |
| `/profile current` | Shows the active profile and its Claude folder, and refreshes the status bar. |
| `/profile create <name>` | Creates an empty profile. |
| `/profile delete <name>` | Deletes a profile after a confirmation. You cannot delete the active one. |
| `/profile login claude` | Prints the command that logs the active profile into Claude Code. |
| `/profile help` | Shows the command list. |

Profile names use lowercase letters, digits, `-` or `_` (up to 32 characters). Switching waits until the agent is idle.

### From the terminal: `gentle-profiles`

| Command | What it does |
| --- | --- |
| `gentle-profiles <name> [args...]` | Starts `gentle-shell` on that profile. Extra args go to `gentle-shell`. |
| `gentle-profiles list` | Lists profiles. `*` marks the active one. |
| `gentle-profiles current` | Prints the active profile. |
| `gentle-profiles create <name>` | Creates an empty profile. |
| `gentle-profiles login <name>` | Runs `claude auth login` for that profile's Claude folder. |
| `gentle-profiles --help` | Shows the command list. |

Examples:

```sh
gentle-profiles work                  # open Gentle Shell as "work"
gentle-profiles personal --isolated   # extra args are passed through
gentle-profiles login work            # log "work" into Claude
```

If a profile does not exist, the launcher says so and exits with code 1:
`Profile "<name>" does not exist. Create it with: gentle-profiles create <name>`.

## How switching works

Switching to a profile:

1. saves your current Codex and Anthropic credentials into the profile you are leaving,
2. loads the new profile's credentials into pi,
3. points `CLAUDE_CONFIG_DIR` at the new profile's Claude folder, so the next Claude request uses that login,
4. remembers the profile as the active one and updates the status bar.

If any credentials file is unreadable, the switch stops with an error and changes nothing.

## Where things are stored

Under pi's agent folder (`~/.gentle-shell/agent` for Gentle Shell, `~/.pi/agent` for plain pi):

```
profiles/
  current             the active profile name
  work/
    claude/           this profile's Claude Code login
    auth.json         this profile's Codex / Anthropic credentials
  default/
    claude-dir        path to your original Claude folder (recorded, not copied)
    auth.json
```

The launcher finds that folder from `PI_CODING_AGENT_DIR`, then `GENTLE_SHELL_HOME`, then `~/.gentle-shell/agent`.

## Good to know

- **Status bar.** The email is read from Claude Code's `.claude.json`. It refreshes on start, on switch and on `/profile current`; after logging in from another terminal, run `/profile current`. If there is no login it shows `not logged in`. Codex does not show an email, because pi stores only an opaque account id.
- **Menu.** Gentle Shell's own command menu is a fixed list that extensions cannot extend, so the entry points are `/profile` and the status bar.
- **OAuth tokens rotate.** If you use the same Codex or Anthropic login in another tool at the same time, a saved copy can go stale. Log in again from that profile.
- **Windows.** The launcher starts `gentle-shell` through the shell so `.cmd` shims resolve.
- **Do not switch mid-turn.** The command refuses while the agent is working.

## Development

```sh
pnpm install
pnpm test        # node:test through tsx, runs the real launcher too
pnpm typecheck
```

CI runs the tests on Linux, macOS and Windows with Node 22 and 24.

## Gentle Hub

This repository carries the `gentle-shell-package` and `gentle-shell-extension` topics so it is listed in the [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## License

MIT
