import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// S20: README.md (Spanish) and README.en.md (English) only differ in prose.
const es = readFileSync("README.md", "utf8");
const en = readFileSync("README.en.md", "utf8");

const fencedBlocks = (text: string): string[] => [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```$/gm)].map((m) => m[0]);
const proseOnly = (text: string): string => text.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, "");
const inlineCode = (text: string): string[] => [...proseOnly(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).sort();
const urls = (text: string): string[] => [...new Set([...text.matchAll(/https?:\/\/[^\s)>\]"]+/g)].map((m) => m[0]))].sort();

test("S20: fenced code blocks are identical in both READMEs", () => {
  assert.ok(fencedBlocks(en).length > 0);
  assert.deepEqual(fencedBlocks(es), fencedBlocks(en));
});

test("S20: inline code spans and URLs are identical in both READMEs", () => {
  assert.deepEqual(inlineCode(es), inlineCode(en));
  assert.deepEqual(urls(es), urls(en));
});

test("S20: each README links to the other and neither mentions removed release tooling", () => {
  assert.match(es, /\[English\]\(README\.en\.md\)/);
  assert.match(en, /\[Español\]\(README\.md\)/);
  for (const text of [es, en]) assert.doesNotMatch(text, /release-please|RELEASE_PLEASE/i);
});
