[Español](../es/install.md) | English

# Installation

What you will find here: how to choose between Gentle Shell and plain pi, the requirements, one complete section per system, and how to update, remove and develop the package.

## Gentle Shell or plain pi

| | Gentle Shell | plain pi |
| --- | --- | --- |
| Who it is for | you use Gentle Shell | you use pi without Gentle Shell |
| Command | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Command (npm) | `gentle-shell -- install npm:gentle-accounts` | `pi install npm:gentle-accounts` |
| Agent dir | `~/.gentle-shell/agent` (or `GENTLE_SHELL_HOME`) | `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) |

With Gentle Shell, everything after `--` goes to pi, which clones the package into the agent dir and adds it to that dir's `settings.json`. Gentle Shell options such as `--home <path>` go before the `--`. Restart Gentle Shell or pi and `/gentle:accounts` is available.

The extension always uses the agent dir that pi resolves for the running session. The launcher (`gentle-accounts`) resolves it on its own: `PI_CODING_AGENT_DIR`, then `GENTLE_SHELL_HOME`, then `~/.gentle-shell/agent`. With plain pi, set `PI_CODING_AGENT_DIR` to `~/.pi/agent` before using the launcher, otherwise it reads the Gentle Shell folder. The launcher's `gentle-accounts <name>` always starts `gentle-shell`; with plain pi only `list`, `current`, `create`, `login` and `session` are useful.

## Requirements

- Node 22.18 or newer (the launcher refuses older versions; the package declares `engines.node` `>=22.18`).
- pi 1.5.1 or newer (peer dependency `@earendil-works/pi-coding-agent`), or Gentle Shell, which ships pi.
- The `claude` CLI on your `PATH`, for Claude logins and for the status bar.
- [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) installed in the same agent dir, for Claude profiles.

## macOS

Install with Gentle Shell:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

Or with plain pi:

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Or from npm (the same package, published on every release):

```sh
gentle-shell -- install npm:gentle-accounts
```

```sh
pi install npm:gentle-accounts
```

Agent dir: `~/.gentle-shell/agent` (plain pi: `~/.pi/agent`).

Clone path: pi clones git packages under `git/` in the agent dir, so the clone is `~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts`. This path comes from the existing README and was not verified against pi's source; confirm it with:

```sh
ls ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin
```

Launcher alias for zsh (`~/.zshrc`) or bash (`~/.bashrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

With plain pi, replace `.gentle-shell/agent` with `.pi/agent` in the alias path.

If you installed from npm, pi puts the package under `npm/node_modules/` in the agent dir, so the alias path is `~/.gentle-shell/agent/npm/node_modules/gentle-accounts/bin/gentle-accounts.mjs` (this layout comes from the other npm packages in the agent dir and was not verified for this package; check it with `ls ~/.gentle-shell/agent/npm/node_modules/gentle-accounts/bin`).

Verify: open Gentle Shell or pi and run `/gentle:accounts list`. In a new terminal, `gentle-accounts --help` prints the launcher usage.

## Linux

Install with Gentle Shell:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

Or with plain pi:

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Or from npm (the same package, published on every release):

```sh
gentle-shell -- install npm:gentle-accounts
```

```sh
pi install npm:gentle-accounts
```

Agent dir: `~/.gentle-shell/agent` (plain pi: `~/.pi/agent`).

Clone path: same layout as macOS, `~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts` (from the existing README, not verified against pi's source). Confirm it with the same `ls` command:

```sh
ls ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin
```

Launcher alias for bash (`~/.bashrc`) or zsh (`~/.zshrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

With plain pi, replace `.gentle-shell/agent` with `.pi/agent` in the alias path.

If you installed from npm, pi puts the package under `npm/node_modules/` in the agent dir, so the alias path is `~/.gentle-shell/agent/npm/node_modules/gentle-accounts/bin/gentle-accounts.mjs` (this layout comes from the other npm packages in the agent dir and was not verified for this package; check it with `ls ~/.gentle-shell/agent/npm/node_modules/gentle-accounts/bin`).

Verify: open Gentle Shell or pi and run `/gentle:accounts list`. In a new terminal, `gentle-accounts --help` prints the launcher usage.

## Windows (PowerShell)

> **Windows has not been tested on a real machine**, only by automated tests. WSL is recommended.

Install with Gentle Shell:

```powershell
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

Or with plain pi:

```powershell
pi install git:github.com/fcireza/gentle-accounts
```

Or from npm (the same package, published on every release):

```powershell
gentle-shell -- install npm:gentle-accounts
```

```powershell
pi install npm:gentle-accounts
```

Agent dir: `%USERPROFILE%\.gentle-shell\agent` (plain pi: `%USERPROFILE%\.pi\agent`).

Clone path: `%USERPROFILE%\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts` (from the existing README, not verified against pi's source). Confirm it with:

```powershell
Get-ChildItem "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin"
```

Launcher function for your PowerShell profile (`$PROFILE`):

```powershell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

With plain pi, replace `.gentle-shell\agent` with `.pi\agent` in the function path.

If you installed from npm, the package lives under `%USERPROFILE%\.gentle-shell\agent\npm\node_modules\gentle-accounts` instead (this layout was not verified for this package), so use `...\npm\node_modules\gentle-accounts\bin\gentle-accounts.mjs` in the function path.

Verify: open Gentle Shell or pi and run `/gentle:accounts list`. In a new PowerShell window, `gentle-accounts --help` prints the launcher usage.

The launcher starts `gentle-shell` and `claude` through the shell on Windows, so `.cmd` shims on `PATH` resolve.

## Update

Reinstalling pulls the latest `main`: run the same install command again. A git install follows `main`; an npm install gets the latest published version, so run `pi install npm:gentle-accounts` again (or `pi update --extensions`) to move to a newer release. pi also documents `pi update --extensions` to reconcile installed packages.

## Remove

Delete the `git:github.com/fcireza/gentle-accounts` line (or `npm:gentle-accounts`, if you installed from npm) from the `packages` list in the agent dir's `settings.json` (`~/.gentle-shell/agent/settings.json` for Gentle Shell) and restart. pi also documents `pi remove <source>`. Your profiles stay on disk under `profiles/` in the agent dir until you delete that folder yourself.

## Old package

The package used to be called `gentle-profiles`. If you installed it (`git:github.com/fcireza/gentle-profiles`), remove that line from the `packages` list in `settings.json` first. With both installed, the old `/profile` and the new `/gentle:accounts` run side by side. The `/profile` command became `/gentle:accounts` with the same sub-commands, and the launcher became `gentle-accounts`. Profiles on disk are unchanged.

## Install from a local clone

For development, clone the repository and load it from its folder. pi documents local paths for packages: `pi install ./local-package` adds it to `settings.json`, and `pi -e <source>` loads it for one run without touching settings. To keep your real profiles out of it, point pi at a throwaway agent dir:

```sh
git clone https://github.com/fcireza/gentle-accounts.git
cd gentle-accounts
pnpm install
PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e .
```

See [Development](development.md) for tests and CI.
