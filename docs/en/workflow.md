[Español](../es/workflow.md) | English

# Workflow

What you will find here: worked scenarios from the first start to deleting a profile, with the messages you will see.

![Status bar showing the active profile and its profile](../../assets/hero-status-bar.svg)

## 1. First start and the `default` profile

After installing, restart Gentle Shell or pi. On session start, when no profile is active yet, the extension wraps your current logins into a profile called `default`:

- Your current account credentials (Codex, Anthropic and any other oauth login) in pi's `auth.json` are copied into `profiles/default/auth.json`.
- Your Claude Code login is not moved or copied. `default` keeps using Claude Code's own default folder, and `CLAUDE_CONFIG_DIR` is left **unset** while it is active. See [How it works](how-it-works.md) for why.
- If you had set `CLAUDE_CONFIG_DIR` yourself, that folder is recorded (not copied) and kept.

Check it:

```
/gentle:accounts current
```

```
Active profile: default (CLAUDE_CONFIG_DIR=(unset: Claude Code default))
```

## 2. A work and a personal Claude account

In this example `default` already holds your personal account and you add `work`.

Create the profile:

```
/gentle:accounts create work
```

```
Created profile "work". Switch with /gentle:accounts work, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.
```

Switch to it:

```
/gentle:accounts work
```

The profile has an empty Claude folder, so it is not logged in yet. Ask for the login command:

```
/gentle:accounts login claude
```

![The highlighted login command on macOS, Linux and Windows](../../assets/workflow-login.svg)

On macOS or Linux the message looks like this:

```
To log profile "work" into Claude Code, run this in ANOTHER terminal (it opens your browser):

  $ CLAUDE_CONFIG_DIR='/Users/you/.gentle-shell/agent/profiles/work/claude' claude auth login

Or run it from a terminal with the launcher: gentle-accounts login work
When it finishes, run /gentle:accounts current to see the account.
```

On Windows (PowerShell):

```
To log profile "work" into Claude Code, run this in ANOTHER terminal (it opens your browser):

  PS> $env:CLAUDE_CONFIG_DIR="C:\Users\you\.gentle-shell\agent\profiles\work\claude"; claude auth login

Or run it from a terminal with the launcher: gentle-accounts login work
When it finishes, run /gentle:accounts current to see the account.
```

Copy the command after `$ ` or `PS> ` and run it in another terminal. For `default` the command is plain `claude auth login`, with no `CLAUDE_CONFIG_DIR` prefix.

Alternative: if you set up the launcher alias ([Installation](install.md)), run this in a terminal instead. It runs `claude auth login` for that profile's Claude folder with the terminal attached:

```sh
gentle-accounts login work
```

When the browser flow ends, check the account:

```
/gentle:accounts current
```

The status bar then reads `👤 gentle-accounts: work`.

### Other ways to log in

`claude auth login` is interactive: it opens a browser and waits for you. `/gentle:accounts login claude` only prints the command. The accounts menu (section 9) can also run it: `Enter` on the Claude row offers `In a new terminal tab`, `In this terminal` (the TUI pauses while `claude auth login` owns the terminal and comes back when it ends) or `Show the command`. From a terminal, `gentle-accounts login <profile>` runs it directly.

## 3. Codex or Anthropic credentials

Codex (`openai-codex`) and Anthropic (pi's native `anthropic` provider) use pi's normal `/login`. While a profile is active, run:

```
/login
```

pi writes the credentials into its live `auth.json`. They are saved into the active profile's `auth.json` the next time you switch away from that profile (with `/gentle:accounts <name>` or the launcher). Until then they only live in pi's `auth.json`. Api-key providers stay global and are never touched; every other account (oauth) provider belongs to the profile.

## 4. Switching back and forth

![Listing profiles and switching between them](../../assets/workflow-switch.svg)

List profiles; `*` marks the active one:

```
/gentle:accounts list
```

```
* default
  work
```

Switch by name, or run `/gentle:accounts` with no argument to pick from a list:

```
/gentle:accounts default
```

```
Switched to profile "default". Claude Code dir: (unset: Claude Code default)
```

Switching to the profile that is already active only says `Already on profile "default".`. Switching waits for the agent: while a turn is running you get `Wait for the current turn to finish before switching profiles.`

Reading the status bar: `👤 gentle-accounts: <profile>` when the profile's Claude login is detected, `🔒 gentle-accounts: <profile> · not logged in` otherwise. The icon shows the state at a glance: `👤` logged in, `🔒` not logged in. By default the email is hidden and not shown at all; see section 7 to show it in full. The status refreshes on start, after a switch, on `/gentle:accounts current`, after every agent turn and every 60 seconds.

## 5. Starting a session on a profile

With the launcher alias, start Gentle Shell already on a profile. Extra arguments are passed to `gentle-shell`:

```sh
gentle-accounts work
```

The launcher does not change the global profile. It gives the session a private agent home with the profile's credentials, starts `gentle-shell` on it with `CLAUDE_CONFIG_DIR` set for that profile (removed for `default`), and when gentle-shell exits copies the session's credentials back into the profile. See section 10.

## 6. Choose the profile new sessions start on

By default a new session starts on the last used profile. To always start on `work`, set it as the session profile:

```
/gentle:accounts session work
```

```
Session profile set to "work". New sessions start on it.
```

Restart Gentle Shell or pi. If another profile was active, the session switches to `work` on start and shows `Started on profile "work" (session profile).`. To go back to the last used profile:

```
/gentle:accounts session last
```

```
Session profile cleared. New sessions start on the last used profile.
```

The session profile is shared by every session of the same agent dir; to give each session its own account see [A different account per session](how-it-works.md).

## 7. Show the full email in the status bar

By default the status bar shows only the profile name, `👤 gentle-accounts: work`. To see the full address:

```
/gentle:accounts email show
```

```
Email display set to shown. The status bar shows the full email.
```

The status bar refreshes right away and reads `👤 gentle-accounts: work · maria.lopez@company.com`. To hide it again:

```
/gentle:accounts email hide
```

```
Email display set to hidden. The status bar does not show the email.
```

Privacy warning: with `show`, anyone who sees your screen can read the address, including screen shares, screenshots and recordings. Hide it before sharing your screen. The setting applies to every session of the same agent dir.

## 8. Deleting a profile

You cannot delete the active profile or the session profile, so switch away (or run `session last`) first:

```
/gentle:accounts default
/gentle:accounts delete work
```

A confirmation dialog asks `Delete profile "work" and its Claude login and credentials? This cannot be undone.`. Confirm to get `Deleted profile "work".`, or cancel to get `Delete cancelled.`. The whole profile folder is removed, including its Claude login folder. The launcher has no delete command.

## 9. The accounts menu

Open the menu (or run `/gentle:accounts` with no argument):

```
/gentle:accounts menu
```

The menu lists the profiles: `●` marks the profile active in this session, `○` the others and `★` the session profile. Press `→` on a profile to open a row per provider with `●` logged in or `○` not logged in, and the email when the email display is shown; `←` closes them. Move with the arrows (or `h` `j` `k` `l`), press `Enter` on a profile to switch or on a provider row to log in, `n` to create, `d` to delete, `s` for the session profile, `e` for the email display, `o` (on a logged-in provider row) to open this project with the selected profile in a new terminal tab, and `Esc` to close. Every key and message is in [Commands](commands.md).

Logging in from a provider row:

- Claude: choose `In a new terminal tab`, `In this terminal` or `Show the command`.
- Codex and Anthropic: the menu closes and writes `/login` in the editor; press Enter and choose the provider. It only works for the active profile, so switch to it first.

## 10. A different account in each project

Start each project with the launcher and its own profile, each in its own terminal:

```sh
gentle-accounts work
gentle-accounts personal
```

Each session gets a private agent home, so a switch or a login in one does not change the other. Sessions started without the launcher still use the global profile. From the menu, `o` opens the current project with the selected profile in a new tab; when it cannot open a tab it shows the command to run, for example `Open this project with "personal" in a new terminal: gentle-accounts personal`.

Prefer a different account per session: OAuth refresh tokens rotate, so the SAME account in two live sessions can invalidate the token one of them holds, and that session has to log in again. Details in [How it works](how-it-works.md).
