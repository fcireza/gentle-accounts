import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// S25: docs/es and docs/en hold the same files and only differ in prose.
const FILES = ["README.md", "install.md", "workflow.md", "commands.md", "how-it-works.md", "troubleshooting.md", "development.md"];
const LANGS = ["es", "en"] as const;
// Produced by the assets task (S24); checked only once assets/ exists.
const PENDING_ASSETS = new Set(["logo.svg", "hero-status-bar.svg", "workflow-switch.svg", "workflow-login.svg", "how-it-works.svg"].map((f) => `../../assets/${f}`));

const FENCE = /^```[^\n]*\n[\s\S]*?^```$/gm;
const read = (lang: string, file: string): string => readFileSync(join("docs", lang, file), "utf8").replace(/\r\n/g, "\n");
const fencedBlocks = (text: string): string[] => [...text.matchAll(FENCE)].map((m) => m[0]);
const proseOnly = (text: string): string => text.replace(FENCE, "");
const inlineCode = (text: string): string[] => [...proseOnly(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).sort();
const urls = (text: string): string[] => [...new Set([...text.matchAll(/https?:\/\/[^\s)>\]"]+/g)].map((m) => m[0]))].sort();
const linkTargets = (text: string): string[] => [...proseOnly(text).matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
const headings = (text: string): number => proseOnly(text).split("\n").filter((line) => /^#{1,6} /.test(line)).length;
// The language switch and the link back to the repository README point at each language's own file.
const normalize = (target: string): string =>
  target.replace(/^\.\.\/(es|en)\//, "../LANG/").replace(/^\.\.\/\.\.\/README(\.en)?\.md$/, "../../README.LANG.md");

for (const file of FILES) {
  test(`S25: docs/es/${file} and docs/en/${file} share code, URLs, links and headings`, () => {
    const es = read("es", file);
    const en = read("en", file);
    assert.deepEqual(fencedBlocks(es), fencedBlocks(en));
    assert.deepEqual(inlineCode(es), inlineCode(en));
    assert.deepEqual(urls(es), urls(en));
    assert.deepEqual(linkTargets(es).map(normalize), linkTargets(en).map(normalize));
    assert.equal(headings(es), headings(en));
    assert.ok(headings(en) > 0);
  });

  test(`S25: docs/<lang>/${file} starts with a switch to the other language`, () => {
    assert.match(read("es", file).split("\n", 1)[0], new RegExp(`\\[English\\]\\(\\.\\./en/${file.replace(".", "\\.")}\\)`));
    assert.match(read("en", file).split("\n", 1)[0], new RegExp(`\\[Español\\]\\(\\.\\./es/${file.replace(".", "\\.")}\\)`));
  });
}

test("S25: every relative link and image target in docs/ resolves", () => {
  const assetsReady = existsSync("assets");
  for (const lang of LANGS) {
    for (const file of FILES) {
      for (const target of linkTargets(read(lang, file))) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        if (PENDING_ASSETS.has(target) && !assetsReady) continue;
        const path = resolve(dirname(join("docs", lang, file)), target.split("#")[0]);
        assert.ok(existsSync(path), `docs/${lang}/${file}: ${target} does not exist`);
      }
    }
  }
});
