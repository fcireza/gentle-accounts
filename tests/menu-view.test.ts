import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { writeAuthFile } from "../src/auth-sync.ts";
import { buildSessionHome, resolveContext } from "../src/session-home.ts";
import { COMPACT_WIDTH, buildMenuModel, identityTheme, renderMenu, truncateToWidth, visibleWidth, type MenuModel, type MenuTheme } from "../src/menu/view.ts";

const EMAIL = "maria.lopez@company.com";

const TOKEN = "sk-secret-token-123";
const WIDTHS = [30, 40, 60, 100, 200];

/** Tags every colored span so tests can see the theme is applied; ANSI-free so widths stay exact. */
const taggedTheme: MenuTheme = { fg: (color, text) => `\x1b[3${color.length % 8}m${text}\x1b[39m`, bold: (t) => `\x1b[1m${t}\x1b[22m` };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function writeAccount(dir: string, email: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email, accessToken: TOKEN } }));
}

function globalSetup() {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-"));
  const store = new ProfileStore(agentDir);
  store.create("work");
  store.create("personal");
  store.setCurrent("work");
  store.setStartup("personal");
  writeAccount(store.claudeDir("personal"), EMAIL);
  writeAuthFile(store.authPath("personal"), { anthropic: { type: "api_key", key: TOKEN } });
  // The active profile reads the live file, not its (stale) snapshot.
  writeAuthFile(store.authPath("work"), { anthropic: { type: "api_key", key: TOKEN } });
  writeAuthFile(join(agentDir, "auth.json"), { "openai-codex": { type: "oauth", access: TOKEN, refresh: TOKEN, expires: 1 } });
  return { agentDir, store, liveAuthPath: join(agentDir, "auth.json") };
}

function model(extra: Partial<Parameters<typeof buildMenuModel>[0]> = {}) {
  const { agentDir, store, liveAuthPath } = globalSetup();
  return buildMenuModel({ store, liveAuthPath, session: false, showEmail: false, homeDir: agentDir, ...extra });
}

test("S31 view: global model has one entry per profile with active, startup and provider states", () => {
  const m = model();
  assert.equal(m.title, "gentle-accounts");
  assert.equal(m.mode, "global");
  assert.equal(m.showEmail, false);
  assert.deepEqual(m.profiles.map((p) => [p.name, p.active, p.startup]), [["personal", false, true], ["work", true, false]]);
  assert.equal(m.selected, 1, "opens on the active profile");
  assert.equal(m.row, 0);
  const [personal, work] = m.profiles;
  assert.deepEqual(personal.providers, [
    { provider: "claude", label: "Claude (claude-bridge)", loggedIn: true },
    { provider: "openai-codex", label: "Codex", loggedIn: false },
    { provider: "anthropic", label: "Anthropic", loggedIn: true },
  ]);
  assert.deepEqual(work.providers, [
    { provider: "claude", label: "Claude (claude-bridge)", loggedIn: false },
    { provider: "openai-codex", label: "Codex", loggedIn: true },
    { provider: "anthropic", label: "Anthropic", loggedIn: false },
  ]);
});

test("S31 view: the active profile reuses the cached Claude answer (null = logged out wins over the file)", () => {
  const { agentDir, store, liveAuthPath } = globalSetup();
  writeAccount(store.claudeDir("work"), "file@x.io");
  const base = { store, liveAuthPath, session: false, showEmail: true, homeDir: agentDir };
  assert.equal(buildMenuModel({ ...base, activeClaude: { email: "cached@x.io" } }).profiles[1].providers[0].email, "cached@x.io");
  assert.equal(buildMenuModel({ ...base, activeClaude: null }).profiles[1].providers[0].loggedIn, false);
  assert.equal(buildMenuModel(base).profiles[1].providers[0].email, "file@x.io", "no cache: file read");
  // Another profile never uses the cache.
  assert.equal(buildMenuModel({ ...base, activeClaude: null }).profiles[0].providers[0].email, EMAIL);
});

test("S31 view: email hidden by default, full only when shown; never a token anywhere", () => {
  const hidden = model();
  const shown = model({ showEmail: true });
  assert.equal(shown.showEmail, true);
  assert.equal(shown.profiles[0].providers[0].email, EMAIL);
  const hiddenText = JSON.stringify(hidden) + WIDTHS.flatMap((w) => renderMenu({ ...hidden, selected: 0, row: 1 }, w, identityTheme)).join("\n");
  assert.doesNotMatch(hiddenText, /maria\.lopez/);
  assert.doesNotMatch(hiddenText, new RegExp(TOKEN));
  const hiddenRender = renderMenu({ ...hidden, selected: 0, row: 1 }, 100).join("\n");
  assert.match(hiddenRender, /● Claude \(claude-bridge\) {2}logged in\s*│/, "email hidden: nothing after logged in");
  assert.doesNotMatch(hiddenRender, /mari\*\*\*\*|@company/, "no email at all");
  const shownText = JSON.stringify(shown) + renderMenu({ ...shown, selected: 0, row: 1 }, 100).join("\n");
  assert.match(shownText, /maria\.lopez@company\.com/);
  assert.doesNotMatch(shownText, new RegExp(TOKEN));
});

test("S31 view: session mode reads the shared store, the session current and H/auth.json", () => {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-s-")));
  const shared = new ProfileStore(agentDir);
  shared.create("work");
  shared.create("personal");
  shared.setCurrent("personal");
  writeAuthFile(shared.authPath("work"), { anthropic: { type: "api_key", key: TOKEN } });
  const { home } = buildSessionHome({ sharedAgentDir: agentDir, profile: "work", baseDir: join(agentDir, "homes") });
  const ctx = resolveContext(home);
  writeAuthFile(ctx.liveAuthPath, { "openai-codex": { type: "oauth", access: TOKEN, expires: 1 } });
  writeFileSync(ctx.store.currentPath, "work\n");
  const m = buildMenuModel({ store: ctx.store, liveAuthPath: ctx.liveAuthPath, session: ctx.session !== null, showEmail: false, homeDir: agentDir });
  assert.equal(m.mode, "session home");
  assert.deepEqual(m.profiles.map((p) => [p.name, p.active]), [["personal", false], ["work", true]]);
  assert.deepEqual(m.profiles[1].providers.map((p) => p.loggedIn), [false, true, false]);
  assert.match(renderMenu(m, 100).join("\n"), /mode: session home/);
});

test("S31 view: selection restores by name and clamps the row; an unknown name falls back to the first tab", () => {
  assert.equal(model({ selectedName: "personal", row: 9 }).selected, 0);
  assert.equal(model({ selectedName: "personal", row: 9 }).row, 3);
  assert.equal(model({ selectedName: "ghost", row: -2 }).selected, 0);
  assert.equal(model({ selectedName: "ghost", row: -2 }).row, 0);
});

function check(m: MenuModel, width: number, theme: MenuTheme) {
  const lines = renderMenu(m, width, theme);
  for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(strip(line))} is ${visibleWidth(line)}`);
  const plain = lines.map(strip);
  assert.match(plain[0], /^╭.*╮$/);
  assert.match(plain.at(-1)!, /^╰─+╯$/);
  for (const line of plain.slice(1, -1)) assert.match(line, /^│ .* │$/);
  for (const line of plain) assert.equal(visibleWidth(line), width, "frame fills the width");
  return plain;
}

test("S31 render: every width keeps lines inside the frame with identity and tagged themes", () => {
  const m = { ...model(), feedback: { message: 'Switched to profile "work". Claude Code dir: /very/long/path/that/never/fits/in/a/narrow/terminal/claude', type: "info" as const } };
  for (const width of WIDTHS) {
    const plain = check(m, width, identityTheme);
    const tagged = renderMenu(m, width, taggedTheme);
    assert.deepEqual(tagged.map(strip), plain, `width ${width}: the theme only adds styles`);
    assert.ok(tagged.some((l) => l.includes("\x1b[")), "theme applied");
  }
});

test("S31 render: wide layout lists the profiles, expands the selected one and shows feedback and key hints", () => {
  const m = { ...model({ showEmail: false }), selected: 0, feedback: { message: "Delete cancelled.", type: "info" as const } };
  const text = renderMenu(m, 100).join("\n");
  assert.match(text, /╭─ gentle-accounts ─/);
  assert.match(text, /gentle-accounts · accounts {3}mode: global · email: hidden/);
  assert.match(text, /▸ ○ personal ★ {2}Claude · Anthropic/);
  assert.match(text, /\s{2}● work {4,}Codex {2}active/);
  assert.doesNotMatch(text, /logged in/, "providers stay collapsed on the profile row");
  assert.doesNotMatch(text, /mari\*\*\*\*/, "no email on the list");
  assert.match(text, /Delete cancelled\./);
  assert.match(text, /↑↓ profile {2}→← providers {2}enter select {2}n new {2}d delete/);
  assert.match(text, /s set session {2}e email {2}esc close/);
  assert.doesNotMatch(text, /o open/, "open is offered only on a logged-in provider row");
  const open = renderMenu({ ...m, row: 2 }, 100).join("\n");
  assert.match(open, /▾ ○ personal/);
  assert.match(open, /● Claude \(claude-bridge\) {2}logged in\s*│/, "no email while the display is hidden");
  assert.doesNotMatch(open, /o open/, "row 2 (Codex) is not logged in");
  const onLogged = renderMenu({ ...m, row: 1 }, 100).join("\n");
  assert.match(onLogged, /s set session {2}e email {2}o open in tab {2}esc close/);
  const shownEmail = renderMenu({ ...model({ showEmail: true }), selected: 0, row: 1 }, 100).join("\n");
  assert.match(shownEmail, /logged in · maria\.lopez@company\.com/);
  assert.match(open, /▸ ○ Codex {19}not logged in/);
  assert.match(open, /● Anthropic {15}logged in/);
  const active = renderMenu({ ...m, selected: 1 }, 100).join("\n");
  assert.match(active, /▸ ● work/);
});

test("S31 render: compact layout under 50 columns", () => {
  const m = { ...model(), selected: 0, row: 1 };
  for (const width of [30, 40, COMPACT_WIDTH - 1]) {
    const text = check(m, width, identityTheme).join("\n");
    assert.match(text, /gentle-accounts · global/);
    assert.match(text, /● Claude logged in/);
    assert.doesNotMatch(text, /claude-bridge/);
    assert.match(text, /esc close/);
  }
  assert.match(renderMenu(m, COMPACT_WIDTH).join("\n"), /Claude \(claude-bridge\)/);
});

test("S31 render: many profiles scroll the list and always show the selected one", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-many-"));
  const store = new ProfileStore(agentDir);
  for (let i = 0; i < 20; i++) store.create(`profile-${String(i).padStart(2, "0")}`);
  store.setCurrent("profile-00");
  const base = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), session: false, showEmail: false, homeDir: agentDir });
  for (const width of WIDTHS) {
    for (const selected of [0, 10, 19]) {
      for (const row of [0, 2]) {
        const plain = check({ ...base, selected, row }, width, identityTheme);
        const name = `profile-${String(selected).padStart(2, "0")}`;
        assert.ok(plain.some((l) => l.includes(name) && /[▸▾]/.test(l)), `width ${width} selected ${selected}: selected profile is listed`);
        assert.ok(plain.filter((l) => /profile-\d\d/.test(l)).length <= 8, "at most 8 profiles at once");
        if (selected > 0) assert.ok(plain.some((l) => /↑ \d+ more/.test(l)), "hint for hidden profiles above");
        if (selected < 19) assert.ok(plain.some((l) => /↓ \d+ more/.test(l)), "hint for hidden profiles below");
      }
    }
  }
});

test("S31 render: long names, wide characters, an empty list and a single profile", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-edge-"));
  const store = new ProfileStore(agentDir);
  const empty = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), session: false, showEmail: true, homeDir: agentDir });
  assert.deepEqual(empty.profiles, []);
  for (const width of WIDTHS) assert.match(check(empty, width, identityTheme).join("\n"), /no profiles|n new/);
  store.create("a-very-long-profile-name-32-char");
  store.setCurrent("a-very-long-profile-name-32-char");
  writeAccount(store.claudeDir("a-very-long-profile-name-32-char"), "名前名前名前@例え.jp");
  const single = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), session: false, showEmail: true, homeDir: agentDir });
  assert.equal(single.profiles.length, 1);
  for (const width of WIDTHS) {
    const text = check({ ...single, feedback: { message: "日本語のフィードバック🙂".repeat(10), type: "warning" } }, width, taggedTheme).join("\n");
    assert.match(text, /a-very-long/);
  }
  assert.match(renderMenu({ ...single, row: 1 }, 200).join("\n"), /名前名前名前@例え\.jp/);
});

test("S31 render: width helpers count wide characters and ANSI correctly", () => {
  assert.equal(visibleWidth("名前"), 4);
  assert.equal(visibleWidth("\x1b[31mab\x1b[0m"), 2);
  assert.equal(visibleWidth("🙂"), 2);
  assert.equal(visibleWidth("◉ ★ ● ○ ╭"), 9);
  assert.equal(truncateToWidth("名前名前", 5), "名前…");
  assert.equal(visibleWidth(truncateToWidth("\x1b[31mabcdef\x1b[0m", 4)), 4);
});
