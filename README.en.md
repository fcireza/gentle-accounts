<p align="center"><img src="assets/logo.svg" alt="gentle-accounts" width="520"></p>

[Español](README.md) | English

Several Claude, Codex and Anthropic accounts in Gentle Shell and pi, with one command to switch between them.

[![CI](https://github.com/fcireza/gentle-accounts/actions/workflows/ci.yml/badge.svg)](https://github.com/fcireza/gentle-accounts/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/fcireza/gentle-accounts)](https://github.com/fcireza/gentle-accounts/releases)

> **Formerly gentle-profiles.** The `/profile` command is now `/gentle:accounts`.

![Gentle Shell status bar showing the active profile and its masked account](assets/hero-status-bar.svg)

The images are illustrations built from the program's real messages, not screenshots.

## Objective

Claude Code keeps one login per machine, and pi keeps your Codex and Anthropic credentials in a single `auth.json`. gentle-accounts lets you keep named **profiles**, such as `work` and `personal`, each with its own logins. You switch between them with one command and the status bar always shows which account is active.

## Providers

| Provider | What each profile keeps | How to log in |
| --- | --- | --- |
| Claude (via [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)) | its own Claude Code login (a separate `CLAUDE_CONFIG_DIR`) | `/gentle:accounts login claude` or `gentle-accounts login <profile>` |
| Codex (`openai-codex`) | its own credentials in pi's `auth.json` | pi's `/login` |
| Anthropic (pi's native provider) | its own credentials in pi's `auth.json` | pi's `/login` |

Any other provider configured in pi is left untouched.

## Quick start

Install in Gentle Shell and restart it:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

1. Create a profile: `/gentle:accounts create work`
2. Switch to it: `/gentle:accounts work`
3. Log in: open the menu with `/gentle:accounts`, pick the provider row and press Enter. Claude logs in in a new terminal tab, in the same terminal, or by showing the command; Codex and Anthropic use pi's `/login`.
4. Check the account: `/gentle:accounts current`. The status bar shows `👤 gentle-accounts: work · mari****@company.com` (`🔒` and `not logged in` when there is no login). The email is masked by default; `/gentle:accounts email show` shows it in full (visible to anyone who sees your screen).
5. Optional: `/gentle:accounts startup work` makes new sessions start on `work`; `/gentle:accounts startup last` goes back to the last used profile.

![Listing profiles and switching with /gentle:accounts](assets/workflow-switch.svg)

![The highlighted Claude login command for macOS, Linux and Windows](assets/workflow-login.svg)

From a terminal, `gentle-accounts login <profile>` runs the Claude login directly.

## Accounts menu

`/gentle:accounts menu` (or just `/gentle:accounts`) opens a panel with one tab per profile: `◉` active in this session, `★` startup profile, and `●`/`○` per provider. Keys: `←` `→` profile, `↑` `↓` row, `Enter` switch or log in, `n` new, `d` delete, `s` startup, `e` email, `o` open the project with that profile in a new tab, `Esc` close.

## A different account per session

`gentle-accounts <profile>` runs each session with a private agent home, so two projects can use two accounts at the same time. Sessions started without the launcher still use the global profile. OAuth refresh tokens rotate: the SAME account in two live sessions can invalidate one of them, so prefer a different account per session.

## Installation

| | Gentle Shell | pi without Gentle Shell |
| --- | --- | --- |
| Command | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Agent dir | `~/.gentle-shell/agent` (or `GENTLE_SHELL_HOME`) | `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) |

Requirements: Node 22.18 or newer, pi 1.5.1 or newer (or Gentle Shell), the `claude` CLI and pi-claude-bridge for Claude profiles.

### macOS

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Agent dir: `~/.gentle-shell/agent`. Launcher alias for zsh (`~/.zshrc`) or bash (`~/.bashrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

### Linux

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Agent dir: `~/.gentle-shell/agent`. Launcher alias for bash (`~/.bashrc`) or zsh (`~/.zshrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

### Windows (PowerShell)

```powershell
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Agent dir: `%USERPROFILE%\.gentle-shell\agent`. Launcher function for your PowerShell profile (`$PROFILE`):

```powershell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

For details, updating, removing or dropping the old package, see [Installation](docs/en/install.md).

## Commands

| Inside Gentle Shell or pi | What it does |
| --- | --- |
| `/gentle:accounts` | Opens the accounts menu (a picker without the TUI). |
| `/gentle:accounts menu` | Opens the accounts menu. |
| `/gentle:accounts <name>` | Switches to `<name>`. |
| `/gentle:accounts list` | Lists profiles; `*` marks the active one. |
| `/gentle:accounts current` | Shows the active profile and refreshes the status bar. |
| `/gentle:accounts create <name>` | Creates an empty profile. |
| `/gentle:accounts delete <name>` | Deletes a profile after confirmation. |
| `/gentle:accounts login claude` | Shows the Claude login command for the active profile. |
| `/gentle:accounts startup [<name>\|last]` | Shows, sets or clears the profile new sessions start on. |
| `/gentle:accounts email [show\|hide]` | Shows or sets whether the status bar shows the full email. |
| `/gentle:accounts help` | Shows the command list. |

| From a terminal | What it does |
| --- | --- |
| `gentle-accounts <name> [args...]` | Starts `gentle-shell` with that profile in a private session home. |
| `gentle-accounts list` | Lists profiles. |
| `gentle-accounts current` | Shows the active profile. |
| `gentle-accounts create <name>` | Creates an empty profile. |
| `gentle-accounts login <name>` | Runs `claude auth login` for that profile. |
| `gentle-accounts startup [<name>\|last]` | Same as `/gentle:accounts startup`. |
| `gentle-accounts email [show\|hide]` | Same as `/gentle:accounts email`. |
| `gentle-accounts --help` | Shows the command list. |

The full reference, with every message, is in [Commands](docs/en/commands.md).

## Documentation

- [Index](docs/en/README.md): starting point of the documentation.
- [Installation](docs/en/install.md): every system, Gentle Shell and pi, alias, update and remove.
- [Workflow](docs/en/workflow.md): complete scenarios with images.
- [Commands](docs/en/commands.md): full reference with every message.
- [How it works](docs/en/how-it-works.md): disk layout, switching, status bar and security.
- [Troubleshooting](docs/en/troubleshooting.md): symptoms, causes and fixes.
- [Development](docs/en/development.md): tests, CI, Conventional Commits and releases.
- [Antigravity](docs/en/antigravity.md): plan for several Antigravity (Google) accounts (not implemented).

## Gentle Hub

This repository carries the `gentle-shell-package` and `gentle-shell-extension` topics to appear in the [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## License

MIT
