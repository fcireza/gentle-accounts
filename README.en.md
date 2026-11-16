[Español](README.md) | English

# gentle-accounts

> **Renamed from gentle-profiles.** The `/profile` command is now `/gentle:accounts` (same sub-commands), the launcher is `gentle-accounts`, and the GitHub repository was renamed to `fcireza/gentle-accounts` (old URLs redirect). Your profiles on disk are unchanged.

Use **more than one account** in [Gentle Shell](https://gentlemanprogramming.com/gentle-hub/) (and pi): a `work` Claude and a `personal` Claude, two Codex logins, and so on. Switch between them with one command, and always see which account is active.

Works on Linux, macOS and Windows.

```
status bar:   gentle-accounts: work · you****@company.com
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
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

Everything after `--` goes to pi, which clones the package into Gentle Shell's home (`~/.gentle-shell/agent`) and adds it to that home's `settings.json`. Restart Gentle Shell and `/gentle:accounts` is available. Gentle Shell options such as `--home <path>` go before the `--`.

If you installed the old package (`git:github.com/fcireza/gentle-profiles`), remove that line from the `packages` list in `~/.gentle-shell/agent/settings.json` first. With both installed, the old `/profile` and the new `/gentle:accounts` would run side by side.

### In plain pi

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Requirements: pi 1.5.1 or newer, the `claude` CLI and pi-claude-bridge for Claude profiles, and Node 22.18 or newer for the launcher.

### The `gentle-accounts` launcher (optional)

The extension already gives you `/gentle:accounts` inside Gentle Shell. The launcher is for starting a session already on a profile. Installing the package from git does not put it on your `PATH`, so call it by path or add an alias:

```sh
# bash / zsh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

```powershell
# PowerShell profile
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

## Update and remove

Reinstalling pulls the latest `main`. To remove it, delete the `git:github.com/fcireza/gentle-accounts` line from the `packages` list in `~/.gentle-shell/agent/settings.json`. Your profiles stay on disk under `profiles/` until you delete that folder.

## Quick start

The first time it loads, your current logins are wrapped into a profile called `default`. Nothing is moved or copied: `default` keeps using Claude Code's own default folder with `CLAUDE_CONFIG_DIR` left **unset** (setting it to `~/.claude` would make Claude Code lose the login on macOS, where the keychain entry depends on that variable). If you had set `CLAUDE_CONFIG_DIR` yourself, that folder is recorded and kept.

1. Create a second profile and switch to it, inside Gentle Shell:
   ```
   /gentle:accounts create work
   /gentle:accounts work
   ```
2. Log that profile into Claude. This prints a command; run it in **another terminal**:
   ```
   /gentle:accounts login claude
   ```
3. Log into Codex or Anthropic with pi's normal `/login`, if you use them.
4. Switch back and forth whenever you want:
   ```
   /gentle:accounts default
   /gentle:accounts work
   ```

The status bar shows `gentle-accounts: <profile> · <masked email>` (for example `gentle-accounts: work · fcir****@gmail.com`), or `gentle-accounts: <profile> · not logged in`.

## Commands

### Inside Gentle Shell: `/gentle:accounts`

| Command | What it does |
| --- | --- |
| `/gentle:accounts` | Opens a picker with your profiles and switches to the one you choose. |
| `/gentle:accounts <name>` | Switches to `<name>`. If it is already active: `Already on profile "<name>".` |
| `/gentle:accounts list` | Lists profiles. `*` marks the active one. |
| `/gentle:accounts current` | Shows the active profile and its Claude folder (`Active profile: work (CLAUDE_CONFIG_DIR=...)`; for `default`: `CLAUDE_CONFIG_DIR=(unset: Claude Code default)`), and refreshes the status bar. |
| `/gentle:accounts create <name>` | Creates an empty profile. |
| `/gentle:accounts delete <name>` | Deletes a profile after a confirmation. You cannot delete the active one. |
| `/gentle:accounts login claude` | Prints the command that logs the active profile into Claude Code (plain `claude auth login` for `default`). |
| `/gentle:accounts help` | Shows the command list. |

Profile names use lowercase letters, digits, `-` or `_` (up to 32 characters). Switching waits until the agent is idle.

### From the terminal: `gentle-accounts`

| Command | What it does |
| --- | --- |
| `gentle-accounts <name> [args...]` | Starts `gentle-shell` on that profile. Extra args go to `gentle-shell`. |
| `gentle-accounts list` | Lists profiles. `*` marks the active one. |
| `gentle-accounts current` | Prints the active profile. |
| `gentle-accounts create <name>` | Creates an empty profile. |
| `gentle-accounts login <name>` | Runs `claude auth login` for that profile's Claude folder (without `CLAUDE_CONFIG_DIR` for `default`). |
| `gentle-accounts --help` | Shows the command list. |

Examples:

```sh
gentle-accounts work                  # open Gentle Shell as "work"
gentle-accounts personal --isolated   # extra args are passed through
gentle-accounts login work            # log "work" into Claude
```

If a profile does not exist, the launcher says so and exits with code 1:
`Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`.

## How switching works

Switching to a profile:

1. saves your current Codex and Anthropic credentials into the profile you are leaving,
2. loads the new profile's credentials into pi,
3. points `CLAUDE_CONFIG_DIR` at the new profile's Claude folder, so the next Claude request uses that login (for `default` the variable is removed instead, and the launcher starts `gentle-shell` without it),
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
    claude-default    marker: use Claude Code's default folder, CLAUDE_CONFIG_DIR unset
    auth.json
```

If you had set `CLAUDE_CONFIG_DIR` when `default` was created, it holds a `claude-dir` file with that path instead of the marker. An older `default` whose `claude-dir` points at `~/.claude` is treated like the marker.

The launcher finds that folder from `PI_CODING_AGENT_DIR`, then `GENTLE_SHELL_HOME`, then `~/.gentle-shell/agent`.

## Good to know

- **Status bar.** Login is detected with `claude auth status` run for the active profile (5 s timeout). If the `claude` CLI is missing, times out or prints no JSON, the email is read from Claude Code's `.claude.json` instead. The email is always masked: the first `min(4, max(1, length - 3))` characters of the name, then `****`, then the domain; the full address is never shown. It refreshes on start, on switch, on `/gentle:accounts current`, after every agent turn and every 60 seconds, so a login from another terminal shows up on its own. Codex does not show an email, because pi stores only an opaque account id.
- **Menu.** Gentle Shell's own command menu is a fixed list that extensions cannot extend, so the entry points are `/gentle:accounts` and the status bar.
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

## Releases

Every merge to `main` creates a `vX.Y.Z` tag and a GitHub Release with generated notes. There is no release PR and no token to configure: the workflow uses the default `GITHUB_TOKEN`.

`main` only accepts squash-merged Pull Requests, so the PR title becomes the commit message and decides the version bump. Use a [Conventional Commits](https://www.conventionalcommits.org/) title (`feat: ...`, `fix: ...`, `docs: ...`). A check enforces it.

| Commit | `0.x` | From `1.0.0` |
| --- | --- | --- |
| `feat: ...` | minor | minor |
| `fix: ...` and anything else | patch | patch |
| `feat!: ...`, `fix!: ...` or a `BREAKING CHANGE:` footer | minor | major |

The first release is `0.1.0`. The next version is computed by `scripts/next-version.ts`:

```sh
node scripts/next-version.ts
```

The `version` field in `package.json` is not rewritten on `main`; the tag is the source of truth.

## Gentle Hub

This repository carries the `gentle-shell-package` and `gentle-shell-extension` topics so it is listed in the [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## License

MIT
