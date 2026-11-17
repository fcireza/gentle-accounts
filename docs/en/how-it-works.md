[Español](../es/how-it-works.md) | English

# How it works

What you will find here: where profiles live on disk, what happens step by step when you switch, why `CLAUDE_CONFIG_DIR` stays unset for `default`, how the status bar detects the account, and the security rules.

![Profile folders and the credential swap](../../assets/how-it-works.svg)

## On-disk layout

Everything lives under pi's agent dir (`~/.gentle-shell/agent` for Gentle Shell, `~/.pi/agent` for plain pi):

```
profiles/
  current             the active profile name
  startup             optional: the profile new sessions start on
  work/
    claude/           this profile's Claude Code login
    auth.json         this profile's Codex / Anthropic credentials
  default/
    claude-default    marker: use Claude Code's default folder, CLAUDE_CONFIG_DIR unset
    auth.json
```

- `profiles/current` holds the name of the active profile. A name that does not match an existing profile counts as no active profile.
- `profiles/startup` holds the startup profile name, written by `startup <name>` and removed by `startup last`. When it is absent, or names a profile that no longer exists, new sessions start on the last used profile.
- `<name>/claude/` is the profile's `CLAUDE_CONFIG_DIR`, the folder where Claude Code keeps that profile's login. pi-claude-bridge reads `CLAUDE_CONFIG_DIR` from the process environment.
- `<name>/auth.json` holds the profile's entries for the `openai-codex` and `anthropic` providers, in pi's `auth.json` format. A folder without `auth.json` is not a profile.
- `claude-default` is an empty marker: the profile uses Claude Code's built-in default folder and `CLAUDE_CONFIG_DIR` must be unset.
- `claude-dir` holds an explicit folder instead. It is written when `default` is created while you had `CLAUDE_CONFIG_DIR` set. A legacy `claude-dir` that points at `~/.claude` is treated like the `claude-default` marker.

All paths are built with Node's `path` functions, so the same layout works on Linux, macOS and Windows.

## The startup profile at session start

At session start the extension first creates `default` when no profile is active, or applies the active profile's `CLAUDE_CONFIG_DIR`. Then, if a startup profile is set and is not the active one, it switches to it with the same safe switch as `/gentle:accounts <name>`: every file is read before any is written, the outgoing profile's Codex and Anthropic credentials are saved, and `CLAUDE_CONFIG_DIR` is set or removed (removed for `default`). It then shows `Started on profile "<name>" (startup profile).`. When the startup profile is already active nothing changes. If a file cannot be read, it shows `gentle-accounts: <message>` (error), nothing changes and the session keeps working on the last used profile.

### Known limit: one agent dir, shared by every session

The startup profile and the active profile are global to the agent dir, not per session. Claude uses `CLAUDE_CONFIG_DIR`, a per-process variable, but the Codex and Anthropic credentials live in the single `auth.json` that every open session shares and pi reads again. So a session that switches profile, at start or with `/gentle:accounts <name>`, changes the credentials the other open sessions read. Per-session isolation is not supported.

## Switching, step by step

`/gentle:accounts <name>` and the launcher's `gentle-accounts <name>` run the same steps:

1. Check that the target exists and that its `auth.json` can be read. If not, stop before creating anything.
2. If no profile is active, create `default` from the current logins first (see [Workflow](workflow.md)).
3. If the target is already active, stop with `Already on profile "<name>".`
4. Read every file before writing any: pi's live `auth.json`, the target's `auth.json` and the outgoing profile's `auth.json`. A corrupt file stops the switch with `Cannot parse <path>: <reason>` and nothing is written.
5. Save outgoing: copy the live `openai-codex` and `anthropic` entries into the outgoing profile's `auth.json` (an entry missing from the live file is removed from the snapshot).
6. Load incoming: copy the target's `openai-codex` and `anthropic` entries into pi's live `auth.json`, removing those that the target does not have. Entries of any other provider are left as they are.
7. Set `CLAUDE_CONFIG_DIR` to the target's Claude folder, or delete the variable for a profile on Claude Code's default folder (it is deleted, never set to the text `undefined`).
8. Write the target name into `profiles/current`.

Every `auth.json` is written to a temporary file next to it and then renamed over the original, so a reader never sees a half-written file. pi reloads `auth.json` when it changes. Files are created with `0600` permissions and profile folders with `0700`, on systems that honor them.

In the extension, the switch also reloads pi's model registry and refreshes the status bar. The launcher instead starts `gentle-shell` with the new environment.

On session start, the extension also sets `CLAUDE_CONFIG_DIR` for the active profile, unless the environment already sets it, so the bridge uses the right login even when you start Gentle Shell without the launcher.

## Why `CLAUDE_CONFIG_DIR` stays unset for `default`

On macOS, Claude Code stores the login in the keychain, and the entry depends on the configured folder. Setting `CLAUDE_CONFIG_DIR` to the default path is therefore not the same as leaving it unset. This was measured on macOS with `claude auth status`:

| Environment | Result |
| --- | --- |
| `CLAUDE_CONFIG_DIR` unset | logged in, with the email |
| `CLAUDE_CONFIG_DIR=$HOME/.claude` | not logged in |
| an empty custom folder | not logged in |

So `default` gets the `claude-default` marker and the variable is removed while it is active, in the extension and in the child environment of the launcher. `/gentle:accounts current` shows `CLAUDE_CONFIG_DIR=(unset: Claude Code default)`, and the login command for `default` is plain `claude auth login`. The same measurement was not repeated on Linux or Windows (not verified).

## The status bar

The extension shows the account with pi's `setStatus`, under the key `gentle-accounts`. Gentle Shell shows it in its status bar and sidebar.

- Logged in: `👤 gentle-accounts: <profile> · <masked email>`, for example `👤 gentle-accounts: work · mari****@company.com`.
- Not logged in: `🔒 gentle-accounts: <profile> · not logged in`, for example `🔒 gentle-accounts: work · not logged in`.

The icon tells the two states apart at a glance: `👤` means a Claude login was detected for the profile, `🔒` means it was not.
- No active profile: the status is cleared.

Email mask: keep the first `min(4, max(1, len-3))` characters of the part before `@`, then `****`, then the untouched `@domain`. Examples computed with `maskEmail`:

| Email | Shown as |
| --- | --- |
| `maria.lopez@company.com` | `mari****@company.com` |
| `fcireza@gmail.com` | `fcir****@gmail.com` |
| `ab@x.com` | `a****@x.com` |
| `abcde@x.com` | `ab****@x.com` |
| `no-at-sign` | `****` |

Detection:

1. Run `claude auth status` with the profile's `CLAUDE_CONFIG_DIR` (or without it for `default`), with fixed arguments and a 5 second timeout. Its JSON answer gives `loggedIn` and `email`.
2. If the `claude` CLI is missing, times out or prints no JSON, read `oauthAccount.emailAddress` from `.claude.json` in the profile's Claude folder (and from `~/.claude.json` for the default folder).

Refresh: on session start, after a switch, on `/gentle:accounts current`, after every agent turn and every 60 seconds. A refresh already running for the same profile is skipped, and a result for a profile that is no longer active is dropped. A login done in another terminal shows up on its own within a minute.

Codex shows no email, because pi stores only an opaque account id for it (from the existing README, not verified against pi's source).

## Security

- Tokens are never printed: the status and notifications only use the profile name and the masked email; the full email never appears.
- Credentials files, `profiles/current` and `profiles/startup` are written with `0600` permissions.
- Nothing leaves your machine: the package only reads and writes local files and runs the local `claude` CLI. It makes no network requests of its own; `claude auth login` and pi's `/login` talk to their providers as usual.
- Commands are run with fixed arguments; on Windows they go through the shell only to resolve `.cmd` shims.

## Not supported on purpose

- Running `claude auth login` inside the TUI: it is interactive and the TUI owns the terminal; use the printed command or `gentle-accounts login <profile>`.
- Adding entries to Gentle Shell's command menu: it is a fixed list that extensions cannot extend, so the entry points are `/gentle:accounts` and the status bar.
- Switching during an agent turn.
- Deleting the active profile, or deleting from the launcher.
- Swapping providers other than `openai-codex` and `anthropic` (plus Claude through `CLAUDE_CONFIG_DIR`).
- The old `/profile` command: it was renamed to `/gentle:accounts`.
