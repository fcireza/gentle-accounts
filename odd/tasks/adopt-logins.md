# Adopt detected logins

Detect logins made outside gentle-accounts (pi or Gentle Shell `/login`, an unowned `~/.claude`) and offer them in the menu as new profiles with the `i` key. Branch `feat/adopt-logins`.
Risk: item 1 (writes credentials into a new profile; never overwrites an existing one).

## Specs

- S1. User: "Necesitamos que lea los /login de pi o gentle-shell y los autocargue en el menu"; "Detecta los logins y los ofrece como para accounts nuevos"; "Tecla i en el menú".
- S2. Detection is read-only and never spawns. A login is detected when (a) `~/.claude` holds a Claude account that no profile owns (no profile resolves to `~/.claude`), or (b) the live `auth.json` holds a covered oauth entry whose account id (`accountId`) differs from the one in the current profile's snapshot. Entries without an id (Anthropic) cannot be told apart and are never detected; this is documented.
- S3. Detection only runs in global mode (not in a session home) and an unreadable auth file detects nothing.
- S4. The menu shows one hint line per detection (provider labels; the email only when email display is on) and `i` adopts. The hint and the key exist only while something is detected.
- S5. Adopting asks for the new profile name (validated like `create`, default derived from the provider, never `default`), creates the profile with `store.create` (refuses an existing name), and never writes into another profile's snapshot or deletes anything.
- S6. Adopting a live entry copies only the detected entries into the new profile, then makes it current WITHOUT snapshotting the live file over the previous profile, so the previous profile keeps its own account. Adopting `~/.claude` creates the profile with `claudeDefault: true` (nothing copied or moved).
- S7. Existing behavior unchanged: switch, create, delete, rename, session, email, hints, mouse.
- S8. Docs en/es (commands, how-it-works, workflow) in parity, and README if it lists menu keys.

## Tasks

- [x] T1 (S2, S3): `src/detect.ts` pure detection, tests first. Commit: 66947dc.
- [x] T2 (S5, S6): `src/adopt.ts` adopt flow, tests first. Commit: 74c8fb3.
- [x] T3 (S4): menu model, hint line, key `i`, run hook. Commit: 78b96f5.
- [x] T4 (S7, S8): docs en/es, full suite. Commit: d7680a6. Full suite: 427 pass.

## Log

- L1 (user, verbatim): "Necesitamos que lea los /login de pi o gentle-shell y los autocargue en el menu"
- L2 (user): "Detecta los logins y los ofrece como para accounts nuevos"; adoption key: "Tecla i en el menú".
- L3 (evidence): this branch is stacked on `fix/general-fixes` (2 unpushed commits, 145 lines, not part of this feature); the feature slice itself is about 350 lines. No independent verifier (Risk item 1, new credentials are written only through `store.create`, which refuses existing names); the adopt tests assert the previous profile's snapshot and live auth stay intact.
- L4 (known limit): Anthropic oauth entries carry no account id, so a new Anthropic login is never detected.
