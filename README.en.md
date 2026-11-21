<p align="center"><img src="assets/logo-mark.svg" alt="gentle-accounts" width="100"></p>

[Español](README.md) | English

Several Claude, Codex and Anthropic accounts in Gentle Shell and pi, with one command to switch between them.

<p align="center">
  <a href="https://github.com/fcireza/gentle-accounts/releases"><img src="https://img.shields.io/github/v/release/fcireza/gentle-accounts?label=release&labelColor=1A1218&color=F095C8&style=for-the-badge" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1A1218?labelColor=1A1218&color=D7A0B8&style=for-the-badge" alt="MIT"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/Pi-native-F095C8?labelColor=1A1218&style=for-the-badge" alt="Pi-native package"></a>
</p>

<p align="center">
  <a href="https://github.com/Gentleman-Programming/gentle-ai"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" height="64" alt="Built with Gentle-AI"></a>
</p>

<p align="center"><img src="assets/logo.svg" alt="gentle-accounts" width="350"></p>

![Gentle Shell status bar showing the name of the active profile](assets/hero-status-bar.svg)

The images are illustrations built from the program's real messages, not screenshots.

## Documentation

- [Index](docs/en/README.md): starting point of the documentation.
- [Installation](docs/en/install.md): every system, Gentle Shell and pi, alias, update and remove.
- [Workflow](docs/en/workflow.md): complete scenarios with images.
- [Commands](docs/en/commands.md): full reference with every message.
- [How it works](docs/en/how-it-works.md): disk layout, switching, status bar and security.
- [Troubleshooting](docs/en/troubleshooting.md): symptoms, causes and fixes.
- [Development](docs/en/development.md): tests, CI, Conventional Commits and releases.

## Objective

Claude Code keeps one login per machine, and pi keeps your Codex and Anthropic credentials in a single `auth.json`. gentle-accounts lets you keep named **profiles**, such as `work` and `personal`, each with its own logins. You switch between them with one command and the status bar always shows which account is active.

## How it works

- Each profile keeps its own logins: its own Claude Code folder (`CLAUDE_CONFIG_DIR`) and its own set of credentials from pi's `auth.json`.
- Switching with `/gentle:accounts <name>`, or from the menu, swaps them and refreshes the status bar, which shows the active profile.
- `gentle-accounts <profile>` starts a session with a private agent home, so two projects can use two accounts at the same time. Avoid the SAME account in two live sessions: OAuth refresh tokens rotate and one of them can be invalidated.
- Profiles stay on disk under `profiles/` in the agent dir. More in [How it works](docs/en/how-it-works.md).

## Providers

| Provider | What each profile keeps | How to log in |
| --- | --- | --- |
| Claude Bridge (via [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)) | its own Claude Code login (a separate `CLAUDE_CONFIG_DIR`) | `/gentle:accounts login claude` or `gentle-accounts login <profile>` |
| Codex (`openai-codex`) | its own credentials in pi's `auth.json` | `Enter` on its menu row (new tab, this terminal or show the command) |
| Anthropic (pi's native provider) | its own credentials in pi's `auth.json` | `Enter` on its menu row (new tab, this terminal or show the command) |

Providers that use an API key stay global; every account (oauth) provider belongs to the profile.

## Commands

The accounts menu is the main way to use it: `/gentle:accounts` lists the profiles (`●` active in this session, `○` the others, `★` session profile). Keys: `↑` `↓` profile, `→` `←` open or close its providers (`●`/`○` logged in or not), `Enter` switch or log in, `n` new, `r` rename, `d` delete, `s` session, `e` email, `x` log a provider out, `i` adopt a login detected outside the profiles, `o` (on a logged-in provider) open the project with that profile in a new tab, `Esc` close. In `fullscreen` mode the pointer highlights the row under the mouse, and you can also click a profile or provider, double-click to switch or log in, and use the wheel.

| Command | What it does |
| --- | --- |
| `/gentle:accounts` | Opens the accounts menu. |
| `/gentle:accounts <name>` | Switches to `<name>`. |
| `/gentle:accounts list` | Lists profiles. |
| `/gentle:accounts rename <old> <new>` | Renames a profile; its logins move with it. |
| `/gentle:accounts session [<name>\|last]` | Shows, sets or clears the profile new sessions start on. |
| `/gentle:accounts email [show\|hide]` | Shows or sets whether the status bar shows the full email. |
| `gentle-accounts <name>` | Starts `gentle-shell` with that profile in a private session home. |
| `gentle-accounts login <name>` | Runs `claude auth login` for that profile. |

First use: create a profile, switch to it and open the menu to log in.

```sh
/gentle:accounts create work
/gentle:accounts work
/gentle:accounts
```

The other commands and every message are in [Commands](docs/en/commands.md).

## Install / Uninstall

| | macOS | Linux | Windows (PowerShell) |
| --- | --- | --- | --- |
| Install with Gentle Shell | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` |
| Install with pi | `pi install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Launcher | `alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'` in `~/.zshrc` or `~/.bashrc` | `alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'` in `~/.bashrc` or `~/.zshrc` | `function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }` in `$PROFILE` |
| Uninstall with Gentle Shell | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` |
| Uninstall with pi | `pi remove git:github.com/fcireza/gentle-accounts` | `pi remove git:github.com/fcireza/gentle-accounts` | `pi remove git:github.com/fcireza/gentle-accounts` |

Requirements: Node 22.18 or newer, pi 1.5.1 or newer (or Gentle Shell), the `claude` CLI and pi-claude-bridge for Claude profiles. Uninstalling keeps your profiles on disk under `profiles/` until you delete that folder. **Windows has not been tested on a real machine**, only by automated tests; WSL is recommended. Details, updating and the old package in [Installation](docs/en/install.md).

## Gentle Hub

This repository carries the `gentle-shell-package` and `gentle-shell-extension` topics to appear in the [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## License

MIT
