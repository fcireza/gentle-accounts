# Auth symlink

Each profile owns its OAuth credentials through a symlink instead of copies. Branch `feat/auth-symlink`, cut from `fix/general-fixes` (PR #34).
Risk: item 1 (rewrites stored credentials, migrates the live auth.json) and item 2 (credentials). Each work unit gets its own commit and native review when RDD is on.

## Specs

- S1. User (pending fix, as recorded in memory): the same flow as Claude. "each profile points at its own auth file instead of overwriting a shared one". `<agentDir>/auth.json` becomes a symlink to `profiles/<name>/auth.json` and is repointed on a profile switch. No snapshot copy of OAuth credentials in either direction, so a token rotated by pi lands in the profile file.
- S2. User: "Solo para Login OAUTH". Only OAuth logins are per profile. Entries that are not OAuth (API keys such as google) stay global: on a switch they are carried from the outgoing profile file to the incoming one (they do not rotate), so every profile file shows the same API keys.
- S3. User: "Dejar Windows fuera por ahora". On Windows nothing changes: the current copy model stays. Any symlink failure on POSIX also falls back to the copy model without losing data.
- S4. Migration: an existing regular `auth.json` becomes the current profile's file once (atomic, no data loss, the old snapshot is kept until the move succeeded). A corrupt file fails before anything is touched.
- S5. Every writer goes through the link, never replaces it: `writeAuthFile` on the live path writes through to the target. Callers that wrote both copies (`saveCredential`, `adoptLogin`, `logoutProvider`) write once.
- S6. Launcher sessions keep their private home: its `auth.json` is the link/target of the session profile, and closing the session needs no copy back for OAuth.
- S7. The README and docs (en/es) describe only what this model does: no promise beyond it, the Windows exception stated.

## Tasks

- T1. S1, S2, S5: link-aware auth module (point, switch, carry non-OAuth) with tests. Route: inline. Commit: db1ec6e. Done.
- T2. S4: migration of the live file and POSIX fallback (S3), plus the T1 follow-ups (keep API keys on a switch, refuse link cycles). Route: inline. Commit: 02fa5d4. Done. The migration is NOT wired into the extension yet: T3 first moves every writer to the single-file model.
- T3. S5, S6, split in three work units. T3a: `saveCredential` writes one copy and `adoptLogin` refuses a live login on a linked file (`logoutProvider` already works linked: it rewrites the same file twice with the same content). Commit: fa2d727. Done, native review approved. T3b (S6): the launcher session home. Commit: pending. T3c: wire `migrateToLinkedAuth` outside session homes. Commit: pending. Route: T3b delegated (context backstop), T3c inline.
- Known trade-off (S1): a raw `/login` made in pi outside the menu lands in the current profile's file and replaces that provider's token, with no adopt rescue (the copy model could adopt it until the next switch). Documented in T4.
- T4. S7: docs en/es and README. Route: inline. Commit: pending.

## Log

- L1. User, request that started this change (memory 2026-11-22): "The user wants the same flow as Claude: each profile points at its own auth file instead of overwriting a shared one."
- L2. User, 2026-11-23: "vamos con eso en otra rama".
- L3. User, API keys question: "Solo para Login OAUTH".
- L4. User, Windows question: "Dejar Windows fuera por ahora".
