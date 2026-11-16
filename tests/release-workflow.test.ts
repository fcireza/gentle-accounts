import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const wf = readFileSync(".github/workflows/release.yml", "utf8");

test("S21: release runs on push to main only", () => {
  assert.match(wf, /^on:\n  push:\n    branches: \[main\]\n(?!  \S)/m);
  assert.doesNotMatch(wf, /pull_request|workflow_dispatch|schedule:/);
});

test("S21: contents: write is the only permission", () => {
  const block = wf.match(/^permissions:\n((?:  .*\n)+)/m);
  assert.ok(block);
  assert.equal(block[1].trimEnd(), "  contents: write");
  assert.equal(wf.match(/permissions:/g)?.length, 1);
});

test("S21: concurrency never cancels a running release", () => {
  assert.match(wf, /^concurrency:\n  group: release\n  cancel-in-progress: false$/m);
});

test("S21: full history, Node 24, gh release with generated notes", () => {
  assert.match(wf, /fetch-depth: 0/);
  assert.match(wf, /node-version: 24/);
  assert.match(wf, /node scripts\/next-version\.ts/);
  assert.match(wf, /git tag --points-at HEAD/);
  assert.match(wf, /gh release create "v\$VERSION" --target "\$GITHUB_SHA"/);
  assert.match(wf, /--generate-notes/);
  assert.match(wf, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test("S21: release-please is gone from the workflows and config", () => {
  const dir = ".github/workflows";
  assert.doesNotMatch(wf, /release-please|RELEASE_PLEASE/i);
  for (const f of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /release-please|RELEASE_PLEASE/i, f);
  }
  assert.equal(existsSync("release-please-config.json"), false);
  assert.equal(existsSync(".release-please-manifest.json"), false);
});

test("S21: no run: script interpolates github.event", () => {
  assert.doesNotMatch(wf, /github\.event/);
  for (const line of wf.split("\n")) {
    if (/^\s*(- )?run:/.test(line)) assert.doesNotMatch(line, /\$\{\{/);
  }
});

test("S19: the package and its launcher are named gentle-accounts", () => {
  const p = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(p.name, "gentle-accounts");
  assert.deepEqual(p.bin, { "gentle-accounts": "./bin/gentle-accounts.mjs" });
});

test("package.json links point at the gentle-accounts repository", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.repository.url, /fcireza\/gentle-accounts\.git$/);
  assert.match(pkg.homepage, /fcireza\/gentle-accounts#readme$/);
  assert.match(pkg.bugs.url, /fcireza\/gentle-accounts\/issues$/);
});
