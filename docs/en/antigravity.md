[Español](../es/antigravity.md) | English

# Antigravity: multi-account plan

What you will find here: a plan, not a feature. Nothing described here is implemented. Facts that could not be checked are marked "to confirm"; no web source was consulted to write this page.

## Goal

Keep several Antigravity (Google) accounts in gentle-accounts profiles, like Claude, Codex and Anthropic today: each profile with its own login, switched with `/gentle:accounts <name>`, and a different account per session with `gentle-accounts <name>`.

## What exists today

- pi 1.5.x ships no Antigravity or Gemini CLI provider. Its `google` and `google-vertex` providers use API keys, not account logins. A custom OAuth provider for pi has to exist before pi can use an Antigravity account at all.
- gentle-accounts swaps the `auth.json` entries of `openai-codex` and `anthropic` (`COVERED_PROVIDERS` in `src/auth-sync.ts`) and every other provider whose entry is oauth.
- Claude is covered differently: each profile has its own `CLAUDE_CONFIG_DIR`, set or removed per process.

## Research questions

1. Where do Antigravity and the Gemini CLI store their credentials on macOS, Linux and Windows (a file, the macOS keychain, the Windows credential store)? To confirm.
2. Is there an environment variable that moves that folder, like `CLAUDE_CONFIG_DIR` for Claude Code? To confirm.
3. How are tokens refreshed: do refresh tokens rotate, and does a refresh in one process invalidate a copy held by another? To confirm.
4. Do the terms of use allow several accounts on one machine, and switching between them? To confirm.
5. Would a pi OAuth provider for Antigravity store its login in pi's `auth.json` like `openai-codex`? To confirm (it depends on how the provider is written).

## Options

| Option | How | When it fits |
| --- | --- | --- |
| A. A config folder per account | Like Claude: each profile gets a folder and the launcher sets the variable that points the tool at it. | Only if question 2 finds such a variable. |
| B. Snapshot and restore | Save the credentials file of the outgoing profile and restore the incoming one on every switch, with the same atomic writes and freshest-token rule as `auth.json`. | If credentials live in a plain file and no variable exists. Does not fit a keychain. |
| C. pi `auth.json` provider | Once a pi OAuth provider exists, its entry lives in `auth.json` and gentle-accounts swaps it like Codex. | Needs the provider first; then it is the simplest option. |

## Risks

- Rotating refresh tokens: the same account in two live sessions can invalidate a token (already true for Codex and Anthropic).
- Keychain storage (question 1) would make option B impossible and option A depend on how the keychain entry is named, as with Claude on macOS.
- Terms of use (question 4) may forbid the use case.
- A custom pi provider depends on an interface that may change between pi versions.

## Preparation step

Done: profiles no longer hard-code two providers. `openai-codex` and `anthropic` are always covered, and so is every other provider whose `auth.json` entry is `"type": "oauth"`; API-key providers (such as `google`) stay global. Any provider that registers later (option C) works without changes. The exclusion is by entry type, not a configurable list.

## Exit criteria

The plan becomes a task when:

1. Questions 1 to 4 have answers backed by evidence (source code, documentation or a measurement), each one noted in the feature document.
2. One option is chosen, with the reason.
3. The preparation step is merged and tested (done).
4. For option C, a pi Antigravity provider exists and was tested by hand.

Back to the [documentation index](README.md).
