[Español](../es/README.md) | English

# gentle-accounts documentation

![gentle-accounts logo](../../assets/logo.svg)

What you will find here: the detailed guide to gentle-accounts, from installing it to how it switches accounts under the hood.

## What this documentation covers

gentle-accounts keeps named **profiles** (for example `work` and `personal`), each with its own Claude Code login and its own Codex and Anthropic credentials, and switches between them inside Gentle Shell or plain pi. The repository README is the short overview; these pages hold every detail.

## Documents

| Document | What it covers |
| --- | --- |
| [Installation](install.md) | Gentle Shell or plain pi, requirements, one section per system, launcher alias, update, remove. |
| [Workflow](workflow.md) | Worked scenarios: first start, work and personal accounts, switching, the launcher, deleting, the accounts menu, a different account per project. |
| [Commands](commands.md) | Complete reference of `/gentle:accounts` and `gentle-accounts`, with every message and exit code. |
| [How it works](how-it-works.md) | On-disk layout, the switching algorithm, `CLAUDE_CONFIG_DIR`, the status bar and security. |
| [Troubleshooting](troubleshooting.md) | Symptoms, causes and fixes. |
| [Development](development.md) | Tests, CI, Conventional Commits, releases, branch protection and the social preview image. |
| [Antigravity](antigravity.md) | Plan (not implemented) for several Antigravity (Google) accounts. |

## Start here

If you are new, read in this order:

1. [Installation](install.md)
2. [Workflow](workflow.md)
3. [Commands](commands.md)

Back to the [repository README](../../README.en.md).
