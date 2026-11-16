# gentle-profiles

**Account profiles for [gentle-shell](https://gentlemanprogramming.com/) and pi.** Keep a `work` and a `personal` login for Claude (through [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)), Codex and Anthropic, and switch between them with `/profile` or start a shell already on one.

Works on Linux, macOS and Windows.

## Install

```sh
pi install npm:gentle-profiles
```

Node 22.18 or newer is needed for the `gentle-profiles` launcher (the extension itself runs on whatever node pi uses). Claude profiles need the `claude` CLI and pi-claude-bridge installed.

## How it works

A profile is a folder under pi's agent dir (`~/.gentle-shell/agent` for gentle-shell, `~/.pi/agent` for plain pi):

```
<agentDir>/profiles/
  current             name of the active profile
  work/
    claude/           CLAUDE_CONFIG_DIR for claude-bridge (Claude Code login lives here)
    auth.json         this profile's openai-codex and anthropic credentials
  personal/
    claude/
    auth.json
  default/
    claude-dir        path to your pre-existing Claude Code dir (recorded, not copied)
    auth.json
```

Switching to a profile:

1. saves the live `openai-codex` and `anthropic` entries of pi's `auth.json` into the outgoing profile,
2. loads the incoming profile's entries into pi's `auth.json` (other providers are left untouched),
3. points `CLAUDE_CONFIG_DIR` at the incoming profile's `claude/` dir, so claude-bridge spawns Claude Code with that login,
4. records the profile as current.

The first time the extension loads (or the launcher runs) with no active profile, it wraps your existing logins into a `default` profile. Nothing is copied or moved: `default` keeps using your current `~/.claude` dir.

## Inside gentle-shell: `/profile`

| Command | Effect |
| --- | --- |
| `/profile` | Pick a profile from a list and switch to it. |
| `/profile <name>` | Switch to `<name>`. Switching to the active profile prints `Already on profile "<name>".` |
| `/profile list` | List profiles. `*` marks the active one. |
| `/profile current` | Show the active profile and its Claude dir. |
| `/profile create <name>` | Create an empty profile. |
| `/profile delete <name>` | Delete a profile after a confirmation dialog. The active profile cannot be deleted. |
| `/profile login claude` | Print the command that logs the active profile into Claude Code. |

Names use lowercase letters, digits, `-` or `_` (max 32 chars). Switching waits for the current turn to finish; the next Claude Code query starts a fresh Claude session under the new login.

### Logging a profile in

- **Claude (claude-bridge):** run the command printed by `/profile login claude` in another terminal, or `gentle-profiles login <name>`. It is `claude auth login` with `CLAUDE_CONFIG_DIR` set to the profile's dir, so the login lands in that profile only.
- **Codex / Anthropic:** switch to the profile, then use pi's own `/login`. The credentials are saved into the profile the next time you switch away.

## Active account in the status bar

Inside gentle-shell the status bar (and sidebar) shows `<profile> · <email>` for the active profile, or `<profile> · not logged in` when no Claude login is found. The email is read from Claude Code's `.claude.json` (`oauthAccount.emailAddress`) in the profile's Claude dir; tokens are never read out or shown. The text refreshes on session start, after a `/profile` switch and on `/profile current`; a login made from another terminal shows up at the next of those. Gentle Shell's own command palette is a closed catalog, so the entry points are the status bar plus `/profile`.

## Launcher: `gentle-profiles`

```sh
gentle-profiles work                 # start gentle-shell on the "work" profile
gentle-profiles personal --isolated  # extra args go to gentle-shell
gentle-profiles list
gentle-profiles current
gentle-profiles create <name>
gentle-profiles login <name>         # claude auth login for that profile
```

The launcher honours `PI_CODING_AGENT_DIR` and `GENTLE_SHELL_HOME` to find the agent dir, otherwise `~/.gentle-shell/agent`. On Windows it resolves `gentle-shell.cmd` through the shell.

## Notes and limits

- `CLAUDE_CONFIG_DIR` cannot be set per credential in pi-claude-bridge; this extension sets it on the pi process instead, which is why the launcher exists for a clean start.
- OAuth refresh tokens rotate. Using the same Codex or Anthropic login in another tool at the same time can invalidate a profile's snapshot; log in again from that profile if it happens.
- On macOS, Claude Code stores credentials in the Keychain keyed by its config dir. Each profile dir gets its own entry after `claude auth login`.
- Switch when the agent is idle. Switching while a tool call is parked is unsupported.

## Development

```sh
pnpm install
pnpm test        # node:test through tsx
pnpm typecheck
```

## Gentle Hub

This repository carries the `gentle-shell-package` and `gentle-shell-extension` GitHub topics so it shows up in the [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) community explorer.

## License

MIT
