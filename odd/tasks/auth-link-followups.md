# Auth link follow-ups

Non-blocking findings of the native review of the whole `feat/auth-symlink` range, done as behavior-preserving cleanups plus the two missing proofs. Branch `refactor/auth-link-followups`, cut from `feat/auth-symlink` (stacked on PR #34).
Risk: item 1 and item 2 (stored credentials). Own commit per task, native review per task commit range.

## Specs

- S1. Review `R2-dup-global-merge`: the rule "the live API keys (non-OAuth entries) win on a conflict, a key only the profile file has is kept, nothing is deleted" lives in ONE function used by the linked switch (`switchLinked`), the session build (`withGlobalEntries`) and the migration. The migration's extra rule (the fresher OAuth entry per provider wins) stays explicit and separate. No behavior change: every existing test passes unchanged.
- S2. Review `R4-switch-lost-update`: `switchLinked` reads the incoming profile file again right before rewriting it, so a token another live session rotated in between is not written back stale (same narrowing `buildSessionHome` already has; still no lock, and the docs name that limit for the switch too).
- S3. Review `R3-fresh-reread-untested`: a test proves the second read: the profile file changes between the first read and the write (a test-only seam, like the existing `uid` and `isAlive` ones) and the rotated token survives, for both the session build and the switch.
- S4. Review `R2-build-linked-flags`: `buildSessionHome` decides "link or copy" once, with names that say what they mean; the copy-model credentials are only computed on the copy path. No behavior change.
- S5. Review `R2-magic-hops` and `R2-test-alias`: `MAX_LINK_HOPS` is declared before its use with a comment; in tests/session-home.test.ts the linked and copy builders have names that say which model a test exercises, and the copy builder recognizes the credentials link by exact basename, not by string suffix.
- S6. Docs: the known limit about the lost update (no lock) is stated for the profile switch as well as the session build, in en and es, with the same inline code spans.

## Tasks

- T1. S1, S4, S5: refactor (shared global-merge function, build structure, constants, test names). Route: delegated (context backstop). Commit: 720fbc6. Done, native review approved with three non-blocking findings, handled in T2: `R2-001` (`globalEntriesToWrite` is only a gate, the written value is the second read: say so or rename), `R2-002` (the comment "everything is read before the home exists" is no longer true on the link-failure fallback, where `sessionAuth` runs after the home exists), `R3-late-copy-fallback-read` (add a test that a throw in that late read leaves no home behind).
- T2. S2, S3, S6, plus the three T1 review findings above: re-read in `switchLinked`, the proofs of the second read, the clarified comments and name, the doc sentence. Route: delegated. Commit: pending.

## Log

- L1. User, 2026-11-23: "3" (answering: "Si hago las advertencias de la review del rango completo en una rama aparte").
