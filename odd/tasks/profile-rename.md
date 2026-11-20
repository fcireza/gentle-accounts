# Profile rename

Rename an account profile from the menu (`r`) and with a command, with all docs updated. Branch `feat/profile-rename`, stacked on `feat/accounts-menu-profile-list` (PR #27).
Risk: item 1 (moves a folder with credentials) and item 3 (a new reserved word). Independent verifier unavailable while subagents cannot start (stale Node path): inline real-filesystem checks instead.

## Specs

- S1. User: "Agregame el command r raname, para las accounts": the key `r` in the accounts menu renames the selected profile, and a `rename` command does the same: `/gentle:accounts rename <old> <new>` and `gentle-accounts rename <old> <new>`.
- S2. User: "actualiza todas las docus": README.md, README.en.md and every page under docs/en and docs/es that lists commands, menu keys, reserved words, messages or the disk layout, in both languages with the same inline code spans.
- S3. A rename is one atomic folder move (`profiles/<old>/` to `profiles/<new>/`, same filesystem) through `renameWithRetry`. Nothing else is rewritten except the pointers below.
- S4. User decision: the active profile and the session profile (`★`) can be renamed; the pointers follow: the `current` file(s) and the `startup` file that name the old profile are rewritten to the new name, and `CLAUDE_CONFIG_DIR` of this process is re-applied when it was the old profile's own dir. The status bar refreshes.
- S5. User decision: a profile in use by a live session started with `gentle-accounts <profile>` (a session home whose launcher or gentle-shell pid is alive, naming the profile) is refused: `Cannot rename profile "<old>": a session started with gentle-accounts is using it. Close it first.` Session homes whose launcher is gone are swept first so their credentials are saved under the old name.
- S6. Refusals, each leaving the disk untouched: old missing (`Profile "<old>" does not exist.`), new name invalid or reserved (same messages as `create`), new equals old (`The new name is the same as the current one.`), new already exists (`Profile "<new>" already exists.`, also for a leftover folder without auth.json).
- S7. A `claude-dir` override that points inside the old profile folder is rewritten to the new folder; an external override is left alone.
- S8. Success message: `Renamed profile "<old>" to "<new>".` When the renamed profile was the current one the message adds ` Other open sessions that use it keep the old path until they switch or restart.`
- S9. `rename` is a reserved profile name (a profile already called that stays on disk but cannot be switched to by name; documented like `session`). `startup` and `session` stay reserved.
- S10. Menu: `r` asks `Rename profile "<old>" to` with the old name prefilled; empty or unchanged does nothing; success reselects the new name. The key hints become three lines so `r rename` fits the 60-column panel.
- S11. Existing behavior unchanged: create, delete, switch, session, email, mouse, hits, and every other key.

## Tasks

- [ ] T1 (S3, S7, S9): `ProfileStore.rename` and the reserved word, tests first. Route: inline. Commit: pending.
- [ ] T2 (S4, S5, S6, S8): `src/rename.ts` flow: validations, live-session check with sweep, env re-apply, messages. Route: inline. Commit: pending.
- [ ] T3 (S1): `/gentle:accounts rename`, `gentle-accounts rename`, usage, completions. Route: inline. Commit: pending.
- [ ] T4 (S10): menu key `r`, action, prompt, hints in three lines. Route: inline. Commit: pending.
- [ ] T5 (S2): README and docs en/es. Route: inline. Commit: pending.
- [ ] T6 (S11): full suite, differential check of the shared code (store, hints, USAGE, reserved words), real-filesystem end to end. Route: inline. Commit: pending.

## Log

- L1 (user, verbatim): "Agregame el command r raname, para las accounts actualiza todas las docus"
- L2 (user, 2026-11-20): explore inline (not with the explorer, which cannot start); the active profile and the session profile can be renamed and the pointers move; a profile in use by a launcher session is rejected.
