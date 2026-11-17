import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nextVersion } from "../scripts/next-version.ts";

const cases: Array<[string | null, string, string]> = [
  // [latestTag, message, expected]
  [null, "feat: anything", "0.1.0"],
  [null, "fix!: anything", "0.1.0"],
  ["v0.1.0", "fix: a", "0.1.1"],
  ["v0.1.0", "docs: a", "0.1.1"],
  ["v0.1.0", "ci: a", "0.1.1"],
  ["v0.1.0", "chore: a", "0.1.1"],
  ["v0.1.0", "refactor: a", "0.1.1"],
  ["v0.1.0", "test: a", "0.1.1"],
  ["v0.1.0", "perf: a", "0.1.1"],
  ["v0.1.0", "feat: a", "0.2.0"],
  ["v0.1.0", "feat!: a", "0.2.0"],
  ["v0.1.0", "fix!: a", "0.2.0"],
  ["v1.2.3", "feat!: a", "2.0.0"],
  ["v1.2.3", "fix!: a", "2.0.0"],
  ["v0.1.0", "fix: a\n\nBREAKING CHANGE: gone", "0.2.0"],
  ["v0.1.0", "fix: a\n\nBREAKING-CHANGE: gone", "0.2.0"],
  ["v1.2.3", "chore: a\n\nbody\nBREAKING CHANGE: gone", "2.0.0"],
  ["v1.2.3", "fix: a\n\nmentions BREAKING CHANGE: inline", "1.2.4"],
  ["v0.1.0", "feat(cli): a", "0.2.0"],
  ["v1.2.3", "feat(cli)!: a", "2.0.0"],
  ["v1.2.3", "fix(store): a", "1.2.4"],
  ["v0.1.0", "feat: add thing (#12)", "0.2.0"],
  ["v1.2.3", "feat: add thing (#12)\n\n* detail", "1.3.0"],
  ["v0.1.0", "Update README", "0.1.1"],
  ["v1.2.3", "Merge pull request #4 from x/y", "1.2.4"],
  // Types are case-sensitive lower case: `Feat:` is non-conventional -> patch.
  ["v0.1.0", "Feat: x", "0.1.1"],
  ["v1.2.3", "FEAT!: x", "1.2.4"],
  // `feature` is not `feat`.
  ["v0.1.0", "feature: x", "0.1.1"],
  ["v0.9.9", "fix: a", "0.9.10"],
  ["v0.9.9", "feat: a", "0.10.0"],
  ["v1.2.3", "fix: a", "1.2.4"],
  ["v1.2.3", "feat: a", "1.3.0"],
  ["v1.2.3", "", "1.2.4"],
];

for (const [latestTag, message, expected] of cases) {
  test(`nextVersion(${latestTag}, ${JSON.stringify(message)}) -> ${expected}`, () => {
    assert.equal(nextVersion({ latestTag, message }), expected);
  });
}

for (const bad of ["1.2.3", "v1.2", "vX.Y.Z", "v1.2.3-rc.1", "v01.2.3x", ""]) {
  test(`malformed latest tag ${JSON.stringify(bad)} throws`, () => {
    assert.throws(() => nextVersion({ latestTag: bad, message: "fix: a" }), /malformed|invalid/i);
  });
}

const script = resolve("scripts/next-version.ts");

function withRepo(fn: (dir: string, git: (...args: string[]) => string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "next-version-"));
  const env = {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
    GIT_CONFIG_GLOBAL: join(dir, "no-global-gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  delete (env as Record<string, string | undefined>).GIT_DIR;
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    fn(dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cli(dir: string): string {
  return execFileSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HOME: dir, USERPROFILE: dir, GIT_CONFIG_GLOBAL: join(dir, "none"), GIT_CONFIG_NOSYSTEM: "1" },
  });
}

test("CLI: no tag prints 0.1.0", () => {
  withRepo((dir, git) => {
    git("commit", "-q", "--allow-empty", "-m", "feat: first");
    assert.equal(cli(dir), "0.1.0\n");
  });
});

test("CLI: after v0.1.0, feat bumps minor and fix bumps patch", () => {
  withRepo((dir, git) => {
    git("commit", "-q", "--allow-empty", "-m", "feat: first");
    git("tag", "v0.1.0");
    git("commit", "-q", "--allow-empty", "-m", "feat: second (#3)");
    assert.equal(cli(dir), "0.2.0\n");
    git("tag", "v0.2.0");
    git("commit", "-q", "--allow-empty", "-m", "fix: third");
    assert.equal(cli(dir), "0.2.1\n");
  });
});

test("CLI: shell metacharacters in the commit message are never executed", () => {
  withRepo((dir, git) => {
    git("commit", "-q", "--allow-empty", "-m", "feat: first");
    git("tag", "v0.1.0");
    git("commit", "-q", "--allow-empty", "-m", "fix: $(touch pwned) `touch pwned2`; rm -rf ./x \"'\n\nBody $(touch pwned3)");
    assert.equal(cli(dir), "0.1.1\n");
    for (const f of ["pwned", "pwned2", "pwned3"]) assert.equal(existsSync(join(dir, f)), false);
  });
});

test("CLI: malformed state exits non-zero with stderr", () => {
  withRepo((dir) => {
    // No commits at all: git log fails.
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: dir, stdio: "pipe", env: { ...process.env, HOME: dir, USERPROFILE: dir, GIT_CONFIG_GLOBAL: join(dir, "none"), GIT_CONFIG_NOSYSTEM: "1" } }), (e: { status: number; stderr: Buffer; stdout: Buffer }) => {
      assert.notEqual(e.status, 0);
      assert.match(e.stderr.toString(), /next-version/);
      assert.equal(e.stdout.toString(), "");
      return true;
    });
  });
});

test("CLI: a shallow clone is rejected instead of silently yielding 0.1.0", () => {
  withRepo((dir, git) => {
    git("commit", "-q", "--allow-empty", "-m", "feat: first");
    git("tag", "v0.1.0");
    git("commit", "-q", "--allow-empty", "-m", "fix: second");
    const clone = mkdtempSync(join(tmpdir(), "next-version-shallow-"));
    try {
      execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(dir).href, clone], {
        encoding: "utf8",
        env: { ...process.env, HOME: clone, USERPROFILE: clone, GIT_CONFIG_GLOBAL: join(clone, "none"), GIT_CONFIG_NOSYSTEM: "1" },
      });
      assert.throws(
        () => execFileSync(process.execPath, [script], { cwd: clone, stdio: "pipe", env: { ...process.env, HOME: clone, USERPROFILE: clone, GIT_CONFIG_GLOBAL: join(clone, "none"), GIT_CONFIG_NOSYSTEM: "1" } }),
        (e: { status: number; stderr: Buffer; stdout: Buffer }) => {
          assert.notEqual(e.status, 0);
          assert.match(e.stderr.toString(), /shallow/);
          assert.equal(e.stdout.toString(), "");
          return true;
        },
      );
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
