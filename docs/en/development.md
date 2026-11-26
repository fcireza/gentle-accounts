[Español](../es/development.md) | English

# Development

What you will find here: the repository layout, how to test and run the extension locally, the CI, the commit convention, how releases are made, branch protection and how to add documentation.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | The extension (`index.ts`), the profile store, credential switching, account detection, login command and launcher logic. |
| `bin/` | `gentle-accounts.mjs`, the launcher entry point. |
| `scripts/` | `next-version.ts` (release version) and the image generator. |
| `assets/` | The logo and the usage images (SVG, generated). |
| `tests/` | `node:test` suites, including the README and docs parity tests. |
| `docs/` | This documentation, in `docs/es/` and `docs/en/`. |
| `odd/` | Feature notes: specs, tasks and a decision log. |

## Install and test

```sh
pnpm install
pnpm test        # node:test through tsx, runs the real launcher too
pnpm typecheck
```

The images in `assets/` are generated from the real messages. Regenerate them after changing a message they show; a test fails when a committed image differs from a fresh render:

```sh
pnpm run assets
```

## Run the extension from a local clone

Load the clone for one run with pi's `-e` option and a throwaway agent dir, so your real profiles and logins are not touched:

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e .
```

The launcher can be run from the clone the same way:

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" node bin/gentle-accounts.mjs list
```

See [Installation](install.md) for installing the clone with `pi install`.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, on Linux, macOS and Windows with Node 22 and 24 (six jobs). Each job runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, a launcher smoke test (`node bin/gentle-accounts.mjs --help`, using Node's type stripping without tsx) and `npm pack --dry-run`.

`.github/workflows/pr-title.yml` checks that the pull request title is a Conventional Commit.

## Conventional Commits and versions

`main` only accepts squash-merged pull requests, so the PR title becomes the commit message and decides the version bump. Use a [Conventional Commits](https://www.conventionalcommits.org/) title (`feat: ...`, `fix: ...`, `docs: ...`). Types are lowercase; `Feat:` is not conventional and counts as a patch.

| Commit | `0.x` | From `1.0.0` |
| --- | --- | --- |
| `feat: ...` | minor | minor |
| `fix: ...` and anything else | patch | patch |
| `feat!: ...`, `fix!: ...` or a `BREAKING CHANGE:` footer | minor | major |

## Tag and Release on every merge

Every merge to `main` runs `.github/workflows/release.yml`, which creates a `vX.Y.Z` tag and a GitHub Release with generated notes. There is no release PR: the workflow uses the default `GITHUB_TOKEN` with `contents: write` for the tag and the release, and publishes the tagged version to npm with the `NPM_TOKEN` repository secret.

- Releases run one at a time and are never cancelled midway.
- The checkout uses the full history and tags. `scripts/next-version.ts` refuses a shallow clone with `next-version: shallow clone detected; fetch the full history and tags (checkout with fetch-depth: 0)`, because missing tags would silently give `0.1.0`.
- A commit that already has a tag is skipped, so re-running the workflow is safe.
- The next version comes from the latest reachable `vX.Y.Z` tag and the squashed commit message; commit text is never put into a shell script. With no tag yet, the first release is `0.1.0`.
- The release is created with `gh release create` and `--generate-notes`.
- The npm publish step stamps `package.json` with the tag version inside the runner only (nothing is committed back), skips with a warning when `NPM_TOKEN` is not set, and does nothing when that version is already on npm. `NPM_TOKEN` is a granular npm token with write access to the package and bypass 2FA.

To see the version the next release would get:

```sh
node scripts/next-version.ts
```

The PR body counts too: a line that starts with `BREAKING CHANGE:` bumps the version, even if you are only quoting it.

The `version` field in `package.json` is not rewritten on `main` (direct pushes are blocked); the tag is the source of truth, and the npm package gets that version at publish time.

## Branch protection

`main` is protected:

- Changes go through a pull request.
- Six required status checks: the CI jobs `ubuntu-latest / node 22`, `ubuntu-latest / node 24`, `macos-latest / node 22`, `macos-latest / node 24`, `windows-latest / node 22` and `windows-latest / node 24`.
- Linear history; only squash merges are allowed.
- A ruleset named `main: only repository admins can update` restricts updates to repository admins, so merging needs the admin bypass, for example:

```sh
gh pr merge --squash --admin
```

## Social preview image

`assets/social-preview.png` (1280x640) is the image GitHub shows when the repository is shared. It is rendered from `assets/social-preview.svg`, which `pnpm run assets` generates. Render the PNG with headless Chrome and a fresh, empty `--user-data-dir`:

```sh
chrome --headless=new --user-data-dir="$(mktemp -d)" --window-size=1280,640 --default-background-color=1a1218ff --screenshot=assets/social-preview.png "file://$PWD/assets/social-preview.svg"
```

`chrome` stands for your Chrome or Chromium binary. GitHub has no API for this image, so upload it by hand: repository Settings > General > Social preview > Edit > Upload an image (PNG, JPG or GIF, under 1 MB).

## The `odd/` folder

`odd/` keeps the feature document used to build this package: numbered specs (`S#`), the task list (`T#`) and a log of user decisions and evidence (`L#`). It explains why things are the way they are; read it before changing a behavior.

## Adding a document

Documentation lives in two folders with the same file names: `docs/es/` (Spanish) and `docs/en/` (English). To add a page:

1. Create the file in both folders with the same name.
2. Start each file with the language switch line pointing to the other language's file.
3. Keep code blocks, inline code, URLs, link and image targets and the number of headings identical; only prose, headings and table text are translated.
4. Add it to the table in both `README.md` files of `docs/`.
5. Add the file name to `FILES` in `tests/docs-parity.test.ts` and run `pnpm test`.
