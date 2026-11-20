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
    auth.json         this profile's account (oauth) credentials
  default/
    claude-default    marker: use Claude Code's default folder, CLAUDE_CONFIG_DIR unset
    auth.json
```

- `profiles/current` holds the name of the active profile. A name that does not match an existing profile counts as no active profile.
- `profiles/startup` holds the session profile name, written by `session <name>` and removed by `session last`. When it is absent, or names a profile that no longer exists, new sessions start on the last used profile.
- `<name>/claude/` is the profile's `CLAUDE_CONFIG_DIR`, the folder where Claude Code keeps that profile's login. pi-claude-bridge reads `CLAUDE_CONFIG_DIR` from the process environment.
- `<name>/auth.json` holds the profile's covered entries, in pi's `auth.json` format. Covered means `openai-codex`, `anthropic` and every other provider whose entry is `"type": "oauth"`; API-key providers (such as `google`) stay global and are never moved. A folder without `auth.json` is not a profile.
- `claude-default` is an empty marker: the profile uses Claude Code's built-in default folder and `CLAUDE_CONFIG_DIR` must be unset.
- `claude-dir` holds an explicit folder instead. It is written when `default` is created while you had `CLAUDE_CONFIG_DIR` set. A legacy `claude-dir` that points at `~/.claude` is treated like the `claude-default` marker.

All paths are built with Node's `path` functions, so the same layout works on Linux, macOS and Windows.

## The session profile at session start

At session start the extension first creates `default` when no profile is active, or applies the active profile's `CLAUDE_CONFIG_DIR`. Then, if a session profile is set and is not the active one, it switches to it with the same safe switch as `/gentle:accounts <name>`: every file is read before any is written, the outgoing profile's covered credentials are saved, and `CLAUDE_CONFIG_DIR` is set or removed (removed for `default`). It then shows `Started on profile "<name>" (session profile).`. When the session profile is already active nothing changes. If a file cannot be read, it shows `gentle-accounts: <message>` (error), nothing changes and the session keeps working on the last used profile.

The session profile switch is skipped when `GENTLE_ACCOUNTS_LAUNCH_PROFILE` is set (not empty): the launcher sets it when it starts gentle-shell with `gentle-accounts <name>`, which already switched to `<name>`. If `profiles/startup` names a profile that no longer exists, session start shows `Session profile "<name>" does not exist; starting on the last used profile.` (warning) and nothing changes. The session profile switch only happens when pi starts. It does not run on `/new`, `/resume`, `/fork` or `/reload`, so a profile you switched to by hand stays active.

### A different account per session

A session started without the launcher uses the global profile: `profiles/current` and the single `auth.json` that every such session shares. Switching profile in one of them changes the covered credentials (Codex, Anthropic and any other OAuth login) the others read.

A session started with `gentle-accounts <name>` gets its own private agent home instead, so several projects can run at the same time with a different account each:

1. The launcher creates `<tmp>/gentle-accounts-<uid>/<uuid>` (`<tmp>/gentle-accounts/<uuid>` on Windows) with `0700` permissions. On POSIX it refuses a base folder that is a symlink, owned by another user or writable by group or others: `gentle-accounts: refusing to use <path>: <reason>`.
2. Every entry of the shared agent dir is linked into it, except `auth.json`, `settings.json`, `auth.json.*`, `*.lock` and names starting with `.gentle-` (on Windows folders become junctions and files fall back to a hard link, then a copy).
3. The home gets its own `auth.json` (`0600`) with the profile's credentials, its own `settings.json` (a copy of the shared one with relative package paths made absolute) and a marker `.gentle-accounts-session.json`.
4. It runs `gentle-shell --home <home>` with `GENTLE_SHELL_NO_AUTO_SETUP=1`, `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` and the profile's `CLAUDE_CONFIG_DIR`.
5. When gentle-shell exits (any exit code, Ctrl+C or a kill signal), the launcher copies the session's covered entries back into the profile and removes the home without following links. The next launch also cleans up homes whose launcher and gentle-shell processes are gone.

Inside such a session the extension reads profiles from the shared agent dir, but the live credentials are the home's `auth.json` and the session's current profile is stored in the home (`.gentle-accounts-current`), never in `profiles/current`. A switch inside the session only changes that session. The session profile is not applied there; the menu shows the mode `session home`.

When copying credentials back, or saving them on a switch, the freshest login wins per provider: the OAuth entry with the later expiry is kept, so a session that ends later never overwrites a token that another session refreshed.

Known limit: Codex and Anthropic OAuth logins use rotating refresh tokens. Using the SAME account in two live sessions at once can make one of them invalidate the token the other holds, and that session then has to log in again. Prefer a different account (profile) per session.

## Switching, step by step

`/gentle:accounts <name>` (and the menu) run these steps. In a session started by the launcher, "live `auth.json`" means the home's own file and the current profile is stored in the home:

1. Check that the target exists and that its `auth.json` can be read. If not, stop before creating anything.
2. If no profile is active, create `default` from the current logins first (see [Workflow](workflow.md)).
3. If the target is already active, stop with `Already on profile "<name>".`
4. Read every file before writing any: pi's live `auth.json`, the target's `auth.json` and the outgoing profile's `auth.json`. A corrupt file stops the switch with `Cannot parse <path>: <reason>` and nothing is written.
5. Save outgoing: copy the live covered entries into the outgoing profile's `auth.json` (an entry missing from the live file is removed from the snapshot).
6. Load incoming: copy the target's covered entries into pi's live `auth.json`, removing those that the target does not have. API-key entries of other providers are left as they are.
7. Set `CLAUDE_CONFIG_DIR` to the target's Claude folder, or delete the variable for a profile on Claude Code's default folder (it is deleted, never set to the text `undefined`).
8. Write the target name into `profiles/current`.

Every `auth.json` is written to a temporary file next to it and then renamed over the original, so a reader never sees a half-written file. pi reloads `auth.json` when it changes. Files are created with `0600` permissions and profile folders with `0700`, on systems that honor them.

In the extension, the switch also reloads pi's model registry and refreshes the status bar. The launcher does not switch: it builds a session home (see above).

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

- Logged in: `👤 gentle-accounts: <profile>`, for example `👤 gentle-accounts: work`. The email is hidden by default and not shown at all; with `/gentle:accounts email show` the full address appears after the profile, for example `👤 gentle-accounts: work · maria.lopez@company.com`.
- Not logged in: `🔒 gentle-accounts: <profile> · not logged in`, for example `🔒 gentle-accounts: work · not logged in`.

The icon tells the two states apart at a glance: `👤` means a Claude login was detected for the profile, `🔒` means it was not.
- No active profile: the status is cleared.

Email display: while hidden, no email appears anywhere, not even masked; only `showEmail` set to `true` shows the full address.

Detection:

1. Run `claude auth status` with the profile's `CLAUDE_CONFIG_DIR` (or without it for `default`), with fixed arguments and a 5 second timeout. Its JSON answer gives `loggedIn` and `email`.
2. If the `claude` CLI is missing, times out or prints no JSON, read `oauthAccount.emailAddress` from `.claude.json` in the profile's Claude folder (and from `~/.claude.json` for the default folder).

Refresh: on session start, after a switch, on `/gentle:accounts current`, after every agent turn and every 60 seconds. A refresh already running for the same profile is skipped, and a result for a profile that is no longer active is dropped. A login done in another terminal shows up on its own within a minute.

Email display setting: `/gentle:accounts email [show|hide]` and `gentle-accounts email [show|hide]` store it in `profiles/settings.json` under the key `showEmail` (default `false`). Only a literal `true` shows the full email. A missing, empty or invalid file means hidden and is never rewritten when it is read. Writing keeps any other key and uses the same atomic write as the credentials files (temporary file, then rename) with `0600` permissions. The file is global to the agent dir and is read on every status refresh.

The full email is only ever written to the status bar, and only when the setting is shown: no notification, command output, log or image contains it, in either mode.

Codex shows no email, because pi stores only an opaque account id for it (from the existing README, not verified against pi's source).

## Security

- Tokens are never printed: the status and notifications only use the profile name; the full email appears only in the status bar, and only after `/gentle:accounts email show`. With it shown, anyone who sees your screen can read it.
- `profiles/settings.json` is written with `0600` permissions.
- Credentials files, `profiles/current` and `profiles/startup` are written with `0600` permissions.
- Nothing leaves your machine: the package only reads and writes local files and runs the local `claude` CLI. It makes no network requests of its own; `claude auth login` and pi's `/login` talk to their providers as usual.
- Commands are run with fixed arguments; on Windows they go through the shell only to resolve `.cmd` shims.

## Not supported on purpose

- Running pi's `/login` from the extension: the accounts menu writes `/login` in the editor and you press Enter.
- Adding entries to Gentle Shell's command menu: it is a fixed list that extensions cannot extend, so the entry points are `/gentle:accounts` (and its menu) and the status bar.
- Switching during an agent turn.
- Deleting the active profile, or deleting from the launcher.
- Swapping API-key providers other than `openai-codex` and `anthropic` (OAuth providers and Claude through `CLAUDE_CONFIG_DIR` are swapped). Antigravity is only a plan for now: see [Antigravity](antigravity.md).
- The old `/profile` command: it was renamed to `/gentle:accounts`.
