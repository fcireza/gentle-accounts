import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAccountsCardModel, renderAccountsCard, type AccountsCardModel } from "../src/accounts-card.ts";
import { ProfileStore } from "../src/store.ts";
import { usagePath } from "../src/usage.ts";
import { identityTheme } from "../src/menu/model.ts";
import { visibleWidth } from "../src/menu/width.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const snap = { provider: "claude", fetchedAt: 1, windows: [{ label: "5h", usedPercent: 62, resetAt: null }, { label: "7d", usedPercent: 20, resetAt: null }] };

const model = (n = 2): AccountsCardModel => ({
  defaultProfile: "work",
  session: "home",
  profiles: Array.from({ length: n }, (_, i) => ({ name: i === 0 ? "work" : `p${i}`, active: i === 1, snapshots: i === 0 ? [snap] : [] })),
});

test("S1 card: frame, title, Default, Session and usage rows", () => {
  const lines = renderAccountsCard(model(), 60, identityTheme).map(strip);
  const text = lines.join("\n");
  assert.match(lines[0], /^╭.*Gentle Accounts.*╮$/);
  assert.match(lines[lines.length - 1], /^╰─+╯$/);
  assert.match(text, /Default\s+work/);
  assert.match(text, /Session\s+home/);
  assert.match(text, /Usage/);
  assert.match(text, /○ work\s+Claude Bridge 5h 62% · 7d 20%/);
  assert.match(text, /● p1\s+no usage yet/);
});

test("S1 card: no default shows none; at most 5 profiles then +N more", () => {
  const m = { ...model(8), defaultProfile: null };
  const text = renderAccountsCard(m, 60, identityTheme).map(strip).join("\n");
  assert.match(text, /Default\s+none/);
  assert.equal((text.match(/[●○] /g) ?? []).length, 5);
  assert.match(text, /\+3 more/);
});

test("S1 card: never wider than the width, never wraps", () => {
  for (const width of [0, 1, 5, 6, 10, 20, 30, 80]) {
    const lines = renderAccountsCard(model(7), width, identityTheme);
    for (const l of lines) assert.ok(visibleWidth(l) <= width, `width ${width}: ${l}`);
    if (width >= 10) assert.equal(lines.length, renderAccountsCard(model(7), 200, identityTheme).length);
  }
  assert.match(renderAccountsCard(model(), 24, identityTheme).map(strip).join("\n"), /…/);
});

test("S2 builder: reads current, startup, list and usage; corrupt files read as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "gentle-accounts-card-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new ProfileStore(dir);
  store.create("work");
  store.create("home");
  store.setCurrent("home");
  store.setStartup("work");
  writeFileSync(usagePath(store, "work"), JSON.stringify({ claude: snap }));
  writeFileSync(usagePath(store, "home"), "{not json");
  const m = buildAccountsCardModel(store);
  assert.equal(m.defaultProfile, "work");
  assert.equal(m.session, "home");
  assert.deepEqual(m.profiles.map((p) => [p.name, p.active, p.snapshots.length]), [["home", true, 0], ["work", false, 1]]);
  const broken = { current: () => { throw new Error("x"); }, startup: () => null, list: () => [] } as unknown as ProfileStore;
  assert.doesNotThrow(() => buildAccountsCardModel(broken));
});
