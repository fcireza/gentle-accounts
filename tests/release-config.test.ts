import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const pkg = cfg.packages["."];

test("tags are vX.Y.Z without the component prefix", () => {
  assert.equal(pkg["include-v-in-tag"], true);
  assert.equal(pkg["include-component-in-tag"], false);
});

test("the first release is 0.1.0, not release-please's default 1.0.0", () => {
  assert.equal(pkg["initial-version"], "0.1.0");
  assert.equal(JSON.parse(readFileSync(".release-please-manifest.json", "utf8"))["."], "0.0.0");
});

test("the package name matches package.json", () => {
  assert.equal(pkg["package-name"], JSON.parse(readFileSync("package.json", "utf8")).name);
});

test("S19: the package, its launcher and the release are named gentle-accounts", () => {
  const p = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(p.name, "gentle-accounts");
  assert.deepEqual(p.bin, { "gentle-accounts": "./bin/gentle-accounts.mjs" });
  assert.equal(pkg["package-name"], "gentle-accounts");
});
