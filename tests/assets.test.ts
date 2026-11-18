// S24: the SVG assets are generated, self-contained and in sync with the generator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAssets, SWITCH_SOURCE_FRAGMENTS } from "../scripts/render-assets.ts";
import { statusText } from "../src/account.ts";
import { claudeLoginCommand } from "../src/login.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAMES = ["hero-status-bar.svg", "how-it-works.svg", "logo-mark.svg", "logo.svg", "social-preview.svg", "workflow-login.svg", "workflow-switch.svg"];
const SVG_NS = "http://www.w3.org/2000/svg";
const KNOWN = new Set(["svg", "title", "desc", "rect", "circle", "path", "text", "tspan", "g", "line", "defs", "marker", "polygon", "ellipse"]);

/** Simple well-formedness check: every tag is known and open/close tags balance. */
function checkTags(svg: string): void {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z]+)([^<>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  for (m = re.exec(svg); m; m = re.exec(svg)) {
    const [, close, name, , selfClose] = m;
    assert.ok(KNOWN.has(name), `unknown tag <${name}>`);
    if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else if (!selfClose) stack.push(name);
  }
  assert.deepEqual(stack, [], "unclosed tags");
  const stripped = svg.replace(re, "");
  assert.ok(!/[<>]/.test(stripped), "stray angle bracket outside tags");
}

test("renderAssets returns exactly the seven files", () => {
  assert.deepEqual(Object.keys(renderAssets()).sort(), NAMES);
});

test("every SVG is self-contained and well formed", () => {
  for (const [name, svg] of Object.entries(renderAssets())) {
    assert.ok(svg.startsWith("<svg"), name);
    assert.ok(svg.trimEnd().endsWith("</svg>"), name);
    for (const s of ['role="img"', "<title>", "<desc>"]) assert.ok(svg.includes(s), `${name} lacks ${s}`);
    for (const s of ["<script", "<image", "href="]) assert.ok(!svg.includes(s), `${name} has ${s}`);
    assert.ok(!svg.split(SVG_NS).join("").includes("http"), `${name} has an external URL`);
    assert.ok(Buffer.byteLength(svg) < 60_000, `${name} too big`);
    assert.ok(/<desc>[^<]*not a screenshot/.test(svg), `${name} desc must say not a screenshot`);
    checkTags(svg);
  }
});

test("committed assets equal a fresh render", () => {
  for (const [name, svg] of Object.entries(renderAssets())) {
    const committed = readFileSync(join(root, "assets", name), "utf8");
    assert.equal(committed, svg, `assets/${name} is stale: run pnpm run assets`);
  }
});

test("hero shows the real masked status text", () => {
  const svg = renderAssets()["hero-status-bar.svg"];
  const status = statusText("work", { email: "maria.lopez@company.com" });
  const plain = svg.replace(/<[^>]+>/g, "");
  assert.ok(plain.includes(status), "status text missing");
  assert.ok(plain.includes("mari****@company.com"), "expected the masked example address");
  assert.ok(plain.includes("👤 gentle-accounts: work · mari****@company.com"), "S28: status icon missing in the hero");
  assert.ok(renderAssets()["workflow-switch.svg"].replace(/<[^>]+>/g, "").includes("👤 gentle-accounts: work"), "S28: status icon missing in the switch image");
  for (const [name, text] of Object.entries(renderAssets())) assert.ok(!text.includes("maria.lopez@company.com"), `${name} leaks the email`);
});

test("login SVG contains both real login command lines", () => {
  const svg = renderAssets()["workflow-login.svg"];
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const unix = "$ " + claudeLoginCommand("/Users/you/.gentle-shell/agent/profiles/work/claude", "darwin");
  const win = "PS> " + claudeLoginCommand("C:\\Users\\you\\.gentle-shell\\agent\\profiles\\work\\claude", "win32");
  assert.ok(svg.includes(esc(unix)), "unix command missing");
  assert.ok(svg.includes(esc(win)), "windows command missing");
});

test("switch SVG messages come from src/index.ts", () => {
  const src = readFileSync(join(root, "src", "index.ts"), "utf8");
  assert.ok(SWITCH_SOURCE_FRAGMENTS.length > 0);
  for (const f of SWITCH_SOURCE_FRAGMENTS) assert.ok(src.includes(f), `src/index.ts lacks ${JSON.stringify(f)}`);
});

test("the social preview is 1280x640, shows only the mark and carries no text or email", () => {
  const svg = renderAssets()["social-preview.svg"];
  assert.match(svg, /width="1280" height="640" viewBox="0 0 1280 640"/);
  assert.ok(!svg.includes("<text"), "no text: the picture is the mark alone");
  assert.ok(!svg.includes("@"), "no email address");
  assert.ok(svg.includes(renderAssets()["logo-mark.svg"].match(/<path[^>]*>/)![0]), "uses the same mark paths as logo-mark.svg");
});
