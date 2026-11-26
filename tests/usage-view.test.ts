import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { recordUsage } from "../src/usage.ts";
import { UsageBoxPanel } from "../src/usage-panel.ts";
import { buildUsageModel, renderUsageBox, usageSpans, type UsageBoxModel } from "../src/usage-view.ts";
import { identityTheme, visibleWidth } from "../src/menu/view.ts";

const NOW = 1_700_000_000_000;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const model = (): UsageBoxModel => ({
  now: NOW,
  profiles: [
    {
      name: "work",
      active: true,
      snapshots: [
        {
          provider: "anthropic",
          plan: "max",
          fetchedAt: NOW - 5 * 60_000,
          windows: [
            { label: "5h", usedPercent: 42, resetAt: NOW + 3_660_000 },
            { label: "week", usedPercent: 100, resetAt: null },
          ],
        },
      ],
    },
    { name: "home", active: false, snapshots: [] },
  ],
});

test("S2 render: rounded frame titled Account Usage, a block per profile with meter, percent and reset", () => {
  const lines = renderUsageBox(model(), 70, identityTheme).map(strip);
  assert.match(lines[0], /^╭─+ Account Usage ─+╮$/);
  assert.match(lines.at(-1)!, /^╰─+╯$/);
  const text = lines.join("\n");
  assert.match(text, /● work/);
  assert.match(text, /○ home/);
  assert.match(text, /Anthropic · max · updated 5m ago/);
  assert.match(text, /5h +████░░░░░░ +42% +resets in 1h 1m/);
  assert.match(text, /week +██████████ +100%/);
  assert.match(text, /no usage seen yet/);
  assert.match(text, /esc close/);
  for (const line of lines.slice(1, -1)) assert.match(line, /^│ .* │$/);
});

test("S2 render: the dot is green for the profile in use and dim otherwise; no-usage text is dim", () => {
  const seen: string[] = [];
  renderUsageBox(model(), 70, { fg: (c, t) => (seen.push(`${c}:${t}`), t) });
  assert.ok(seen.includes("success:●"));
  assert.ok(seen.includes("dim:○"));
  assert.ok(seen.includes("dim:no usage seen yet"));
});

test("S2 render: unknown providers use their id, a missing plan is omitted, empty store has a message", () => {
  const m = model();
  m.profiles[0].snapshots = [{ provider: "claude", fetchedAt: NOW, windows: [{ label: "5h", usedPercent: 0, resetAt: null }] }];
  const text = renderUsageBox(m, 70, identityTheme).map(strip).join("\n");
  assert.match(text, /Claude Bridge · updated just now/);
  assert.match(text, /░░░░░░░░░░ +0%/);
  const mystery = { ...m, profiles: [{ name: "x", active: false, snapshots: [{ provider: "zzz", fetchedAt: NOW - 3 * 3_600_000, windows: [] }] }] };
  assert.match(renderUsageBox(mystery, 70, identityTheme).map(strip).join("\n"), /zzz · updated 3h ago/);
  assert.match(renderUsageBox({ now: NOW, profiles: [] }, 70, identityTheme).map(strip).join("\n"), /no profiles yet/);
});

test("S2 render: percentages outside 0..100 are clamped in the meter", () => {
  const m = model();
  m.profiles[0].snapshots[0].windows = [{ label: "5h", usedPercent: 250, resetAt: null }, { label: "week", usedPercent: -5, resetAt: null }];
  const text = renderUsageBox(m, 70, identityTheme).map(strip).join("\n");
  assert.match(text, /██████████ +100%/);
  assert.match(text, /░░░░░░░░░░ +0%/);
});

test("S2 render: no line is wider than the width, from 0 to 120 columns", () => {
  for (let width = 0; width <= 120; width++) for (const line of renderUsageBox(model(), width, identityTheme)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
});

test("S2 render: long names are truncated inside the frame", () => {
  const m = model();
  m.profiles[0].name = "a".repeat(32);
  const lines = renderUsageBox(m, 40, identityTheme).map(strip);
  for (const line of lines) assert.ok(visibleWidth(line) <= 40);
  assert.ok(lines.every((l, i) => i === 0 || i === lines.length - 1 || /^│ .* │$/.test(l)));
});

test("S2 render: the hovered esc hint is lit without changing the layout", () => {
  const plain = renderUsageBox(model(), 70, identityTheme);
  const lit = renderUsageBox({ ...model(), hover: "escape" }, 70, { fg: (c, t) => `<${c}>${t}`, bold: (t) => `*${t}` });
  assert.equal(lit.length, plain.length);
});

test("S2 build: one block per profile from the store, the current one active, data read from usage.json", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-usage-view-"));
  after(() => rmSync(agentDir, { recursive: true, force: true }));
  const store = new ProfileStore(agentDir);
  store.create("home");
  store.create("work");
  store.setCurrent("work");
  recordUsage(store, "home", { provider: "openai-codex", fetchedAt: NOW, windows: [{ label: "5h", usedPercent: 1, resetAt: null }] });
  const built = buildUsageModel(store, NOW);
  assert.deepEqual(built.profiles.map((p) => [p.name, p.active, p.snapshots.length]), [["home", false, 1], ["work", true, 0]]);
  assert.equal(built.now, NOW);
});

test("S2 panel: esc, enter and ctrl+c close it once; other keys do nothing", () => {
  for (const input of ["\x1b", "\r", "\x03"]) {
    let closed = 0;
    const panel = new UsageBoxPanel(model(), identityTheme, () => void closed++);
    panel.handleInput("x");
    assert.equal(closed, 0);
    panel.handleInput(input);
    panel.handleInput(input);
    assert.equal(closed, 1, JSON.stringify(input));
  }
});

test("S2 panel: render is cached per width and equals the pure renderer", () => {
  const panel = new UsageBoxPanel(model(), identityTheme, () => {});
  assert.deepEqual(panel.render(60), renderUsageBox(model(), 60, identityTheme));
  assert.equal(panel.render(60), panel.render(60));
});

test("S2 panel: clicking the esc hint closes it; hovering lights it; other clicks do nothing", () => {
  const hint = usageSpans(model(), 70).find((s) => s.action === "escape")!;
  assert.ok(hint);
  let closed = 0;
  const panel = new UsageBoxPanel(model(), identityTheme, () => void closed++, { requestRender: () => {} });
  assert.deepEqual(panel.handleMouse({ type: "move", button: "none", x: hint.from, y: hint.line, width: 70 }), { handled: true, render: true });
  assert.deepEqual(panel.handleMouse({ type: "move", button: "none", x: 2, y: 1, width: 70 }), { handled: true, render: true });
  assert.equal(panel.handleMouse({ type: "click", button: "left", x: 2, y: 1, width: 70 })?.handled, true);
  assert.equal(closed, 0);
  assert.equal(panel.handleMouse({ type: "click", button: "right", x: hint.from, y: hint.line, width: 70 }), undefined);
  assert.equal(panel.handleMouse({ type: "press", button: "left", x: hint.from, y: hint.line, width: 70 })?.handled, true);
  assert.equal(closed, 0);
  panel.handleMouse({ type: "click", button: "left", x: hint.from, y: hint.line, width: 70 });
  assert.equal(closed, 1);
  assert.equal(panel.handleMouse({ type: "click", button: "left", x: hint.from, y: hint.line, width: 70 }), undefined);
});
