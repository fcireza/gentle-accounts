# gentle-profiles

Pi/gentle-shell extension package that provides named account profiles (for example `work` and `personal`) covering claude-bridge, openai-codex and native anthropic credentials, plus a minimal launcher. Linux, macOS, Windows. Published as a Gentle Hub listed package.

## Specs

- S1. The deliverable is a package "como los de: https://gentlemanprogramming.com/gentle-hub/": a public repo with the `gentle-shell-package` and `gentle-shell-extension` GitHub topics, installable with `pi install npm:gentle-profiles`.
- S2. Purpose, verbatim: "tener multicuenta de claude/codex o cualquier otra en gentle-shell, obviamente usar claude-brige para cada una. Pero asi tener perfiles de distinta cuenta, ejemplo: Work y Personal."
- S3. "Debe funcionar para gentle-shell en Linux y Mac y Windows."
- S4. Form chosen by the user: "Extensión /profile + launcher mínimo". The extension provides a `/profile` slash command; the launcher is a CLI that starts gentle-shell with a given profile.
- S5. Providers in v1 chosen by the user: "Claude via claude-bridge", "Codex (openai-codex de pi)", "Anthropic nativo de pi (API key / OAuth)".
- S6. Profile storage lives under the pi agent dir: `<agentDir>/profiles/<name>/` with a `claude/` directory used as `CLAUDE_CONFIG_DIR` for claude-bridge and an `auth.json` holding that profile's pi credentials (`openai-codex`, `anthropic`). `<agentDir>/profiles/current` records the active profile name.
- S7. `/profile` with no argument shows an interactive picker of existing profiles and switches to the selected one. `/profile <name>` switches directly. `/profile create <name>`, `/profile delete <name>`, `/profile list`, `/profile current` are the subcommands. Names match `^[a-z0-9][a-z0-9_-]{0,31}$`; an invalid name is rejected with the message `Invalid profile name "<name>": use lowercase letters, digits, "-" or "_" (max 32 chars).` and nothing changes.
- S8. Switching a profile: saves the current live pi credentials for the covered providers into the outgoing profile's `auth.json`, loads the incoming profile's `auth.json` entries into pi's live credentials, sets `CLAUDE_CONFIG_DIR` for the running process to the incoming profile's `claude/` dir, and writes `profiles/current`. Credentials of providers not covered by S5 are left untouched. Switching to the active profile is a no-op that prints `Already on profile "<name>".`
- S9. Deleting the active profile is refused with `Cannot delete the active profile "<name>". Switch to another profile first.` Deleting a non-existent profile prints `Profile "<name>" does not exist.` Deleting asks for confirmation in the UI before removing the directory.
- S10. The launcher `gentle-profiles <name> [gentle-shell args...]` sets `CLAUDE_CONFIG_DIR` to the profile's `claude/` dir, writes `profiles/current`, syncs the profile's `auth.json` entries into the agent dir's live `auth.json` (same rules as S8), then execs `gentle-shell` with the remaining args. A missing profile prints `Profile "<name>" does not exist. Create it with: gentle-profiles create <name>` and exits with code 1. `gentle-profiles list`, `gentle-profiles create <name>`, `gentle-profiles current` mirror S7 without a UI.
- S11. On extension load, if `profiles/current` names an existing profile, the extension sets `CLAUDE_CONFIG_DIR` for the process to that profile's `claude/` dir (unless the environment already sets it), so the bridge uses the right login even when gentle-shell was started without the launcher. If no profile exists, the extension creates `default` from the live credentials and the current Claude Code config dir path (recorded, not copied).
- S12. Logging into a profile's Claude account is done by running `claude auth login` with that profile's `CLAUDE_CONFIG_DIR`; `/profile login claude` runs it for the active profile and prints the exact command on platforms where an interactive child cannot be opened. Codex and anthropic logins reuse pi's `/login` and are captured by the next switch (S8).
- S13. All paths are built with Node `path` APIs and the agent dir resolved by pi (`PI_CODING_AGENT_DIR` or the platform default), never with hard-coded `~` or `/`; the launcher resolves `gentle-shell` through `PATH` on every platform, including `.cmd` shims on Windows.
- S14. Docs: README with install, Gentle Hub topics, the profile layout from S6, every command from S7/S10, and the Windows notes from S13.

## Tasks

- [ ] T1 (S6, S7, S13): profile store module: list/create/delete/current, name validation, path layout. Route: inline, test-first. Commit: -
- [ ] T2 (S8, S11): credential sync and switch logic against pi auth storage; extension entry with `/profile` command and load hook. Route: inline, test-first. Commit: -
- [ ] T3 (S9, S12): delete confirmation, login helper. Route: inline. Commit: -
- [ ] T4 (S10, S13): launcher CLI `gentle-profiles` (bin). Route: inline, test-first. Commit: -
- [ ] T5 (S1, S3, S14): package.json metadata (pi-package keyword, bin, files), README, Gentle Hub topics instructions, CI on three OSes. Route: inline. Commit: -

## Log

- L1 (user, verbatim): "Quiero hacer un hub como los de: https://gentlemanprogramming.com/gentle-hub/ Para tener multicuenta de claude/codex o cualquier otra en gentle-shell, obviamente usar claude-brige para cada una. Pero asi tener perfiles de distinta cuenta, ejemplo: Work y Personal. Debe funcionar para gentle-shell en Linux y Mac y Windows"
- L2 (user answers): form = "Extensión /profile + launcher mínimo"; location = "Nuevo repo en /Users/federico/dev/my/<nombre>"; providers = claude-bridge, openai-codex, anthropic nativo.
- L3 (evidence): Gentle Hub lists public repos by GitHub topic `gentle-shell-package` (+ `gentle-shell-extension`). pi-claude-bridge README: `CLAUDE_CONFIG_DIR` cannot be set per credential in auth.json; it must be process env. pi agent dir for gentle-shell is `~/.gentle-shell/agent` (settings.json packages include `npm:pi-claude-bridge`).
