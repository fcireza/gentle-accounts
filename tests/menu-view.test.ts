import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.ts";
import { writeAuthFile } from "../src/auth-sync.ts";
import { buildSessionHome, resolveContext } from "../src/session-home.ts";
import { COMPACT_WIDTH, buildMenuModel, identityTheme, menuHits, renderMenu, truncateToWidth, visibleWidth, type MenuModel, type MenuTheme } from "../src/menu/view.ts";

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
  return buildMenuModel({ store, liveAuthPath, showEmail: false, sessionMode: true, homeDir: agentDir, ...extra });
}

test("S31 view: global model has one entry per profile with active, startup and provider states", () => {
  const m = model();
  assert.equal(m.title, "gentle-accounts");
  assert.equal(m.showEmail, false);
  assert.deepEqual(m.profiles.map((p) => [p.name, p.active, p.startup]), [["personal", false, true], ["work", true, false]]);
  assert.equal(m.selected, 1, "opens on the active profile");
  assert.equal(m.row, 0);
  const [personal, work] = m.profiles;
  // Logged-in providers come first, each group in its usual order.
  assert.deepEqual(personal.providers, [
    { provider: "claude", label: "Claude Bridge", loggedIn: true },
    { provider: "anthropic", label: "Anthropic", loggedIn: true },
    { provider: "openai-codex", label: "Codex", loggedIn: false },
  ]);
  assert.deepEqual(work.providers, [
    { provider: "openai-codex", label: "Codex", loggedIn: true },
    { provider: "claude", label: "Claude Bridge", loggedIn: false },
    { provider: "anthropic", label: "Anthropic", loggedIn: false },
  ]);
});

test("S31 view: the active profile reuses the cached Claude answer (null = logged out wins over the file)", () => {
  const { agentDir, store, liveAuthPath } = globalSetup();
  writeAccount(store.claudeDir("work"), "file@x.io");
  const base = { store, liveAuthPath, showEmail: true, homeDir: agentDir };
  assert.equal(buildMenuModel({ ...base, activeClaude: { email: "cached@x.io" } }).profiles[1].providers.find((p) => p.provider === "claude")!.email, "cached@x.io");
  assert.equal(buildMenuModel({ ...base, activeClaude: null }).profiles[1].providers.find((p) => p.provider === "claude")!.loggedIn, false);
  assert.equal(buildMenuModel(base).profiles[1].providers.find((p) => p.provider === "claude")!.email, "file@x.io", "no cache: file read");
  // Another profile never uses the cache.
  assert.equal(buildMenuModel({ ...base, activeClaude: null }).profiles[0].providers.find((p) => p.provider === "claude")!.email, EMAIL);
});

test("S31 view: email hidden by default, full only when shown; never a token anywhere", () => {
  const hidden = model();
  const shown = model({ showEmail: true });
  assert.equal(shown.showEmail, true);
  assert.equal(shown.profiles[0].providers.find((p) => p.provider === "claude")!.email, EMAIL);
  const hiddenText = JSON.stringify(hidden) + WIDTHS.flatMap((w) => renderMenu({ ...hidden, selected: 0, row: 1 }, w, identityTheme)).join("\n");
  assert.doesNotMatch(hiddenText, /maria\.lopez/);
  assert.doesNotMatch(hiddenText, new RegExp(TOKEN));
  const hiddenRender = renderMenu({ ...hidden, selected: 0, row: 1 }, 100).join("\n");
  assert.match(hiddenRender, /● Claude Bridge {2}logged in\s*│/, "email hidden: nothing after logged in");
  assert.doesNotMatch(hiddenRender, /mari\*\*\*\*|@company/, "no email at all");
  const shownText = JSON.stringify(shown) + renderMenu({ ...shown, selected: 0, row: 1 }, 100).join("\n");
  assert.match(shownText, /mar\*{4}@company\.com/);
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
  const m = buildMenuModel({ store: ctx.store, liveAuthPath: ctx.liveAuthPath, showEmail: false, homeDir: agentDir });
  assert.deepEqual(m.profiles.map((p) => [p.name, p.active]), [["personal", false], ["work", true]]);
  assert.deepEqual(m.profiles[1].providers.map((p) => p.loggedIn), [true, false, false]);
  assert.doesNotMatch(renderMenu(m, 100).join("\n"), /mode:/, "the header does not show the mode");
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
  const text = renderMenu(m, 200).join("\n");
  const plain = renderMenu(m, 200, identityTheme);
  assert.match(plain[0], /^╭─+ Gentle Accounts ─+╮$/, "title centered in the top border");
  assert.match(plain[1], /^│ Account Default: personal · Account Session: work +│$/, "the default account is the session profile");
  assert.match(plain[2], /^│ ─+ │$/);
  assert.match(plain.at(-3)!, /^│ ─+ │$/, "a rule separates the key hints from the rest");
  assert.match(text, /▸ ○ personal ★ {2}Claude Bridge · Anthropic/);
  assert.match(text, /\s{2}● work {4,}Codex {2}active/);
  assert.doesNotMatch(text, /logged in/, "providers stay collapsed on the profile row");
  assert.doesNotMatch(text, /mari\*\*\*\*/, "no email on the list");
  assert.match(text, /Delete cancelled\./);
  assert.match(text, /↑↓ profile {2}→← providers {2}enter select/);
  assert.match(text, /n new {2}r rename {2}d delete {2}s set session/);
  assert.match(text, /e email {2}esc close/);
  assert.doesNotMatch(text, /o open/, "open is offered only on a logged-in provider row");
  const open = renderMenu({ ...m, row: 3 }, 100).join("\n");
  assert.match(open, /▾ ○ personal/);
  assert.match(open, /● Claude Bridge {2}logged in\s*│/, "no email while the display is hidden");
  assert.doesNotMatch(open, /o open/, "row 3 (Codex) is not logged in");
  const onLogged = renderMenu({ ...m, row: 1 }, 200).join("\n");
  assert.match(onLogged, /e email {2}o open in tab {2}esc close/);
  const shownEmail = renderMenu({ ...model({ showEmail: true }), selected: 0, row: 1 }, 100).join("\n");
  assert.match(shownEmail, /logged in · mar\*{4}@company\.com/);
  assert.match(open, /▸ ○ Codex {10}not logged in/);
  assert.match(open, /● Anthropic {6}logged in/);
  const active = renderMenu({ ...m, selected: 1 }, 100).join("\n");
  assert.match(active, /▸ ● work/);
});

test("S31 render: compact layout under 50 columns", () => {
  const m = { ...model(), selected: 0, row: 1 };
  for (const width of [30, 40, COMPACT_WIDTH - 1]) {
    const text = check(m, width, identityTheme).join("\n");
    assert.match(text, /Default: personal/);
    assert.match(text, /● Claude B/, "label cut by the width, never wrapped");
    assert.match(text, /esc close/);
  }
  assert.match(renderMenu(m, COMPACT_WIDTH).join("\n"), /Claude Bridge/);
});

test("S31 render: many profiles scroll the list and always show the selected one", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-many-"));
  const store = new ProfileStore(agentDir);
  for (let i = 0; i < 20; i++) store.create(`profile-${String(i).padStart(2, "0")}`);
  store.setCurrent("profile-00");
  const base = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), showEmail: false, homeDir: agentDir });
  for (const width of WIDTHS) {
    for (const selected of [0, 10, 19]) {
      for (const row of [0, 2]) {
        const plain = check({ ...base, selected, row }, width, identityTheme);
        const name = `profile-${String(selected).padStart(2, "0")}`;
        assert.ok(plain.some((l) => l.includes(name) && /[▸▾]/.test(l)), `width ${width} selected ${selected}: selected profile is listed`);
        assert.ok(plain.filter((l) => /profile-\d\d/.test(l) && !/Session:/.test(l)).length <= 8, "at most 8 profiles at once");
        if (selected > 0) assert.ok(plain.some((l) => /↑ \d+ more/.test(l)), "hint for hidden profiles above");
        if (selected < 19) assert.ok(plain.some((l) => /↓ \d+ more/.test(l)), "hint for hidden profiles below");
      }
    }
  }
});

test("S31 render: long names, wide characters, an empty list and a single profile", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gentle-accounts-menu-view-edge-"));
  const store = new ProfileStore(agentDir);
  const empty = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), showEmail: true, homeDir: agentDir });
  assert.deepEqual(empty.profiles, []);
  for (const width of WIDTHS) assert.match(check(empty, width, identityTheme).join("\n"), /no profiles|n new/);
  store.create("a-very-long-profile-name-32-char");
  store.setCurrent("a-very-long-profile-name-32-char");
  writeAccount(store.claudeDir("a-very-long-profile-name-32-char"), "名前名前名前@例え.jp");
  const single = buildMenuModel({ store, liveAuthPath: join(agentDir, "auth.json"), showEmail: true, homeDir: agentDir });
  assert.equal(single.profiles.length, 1);
  for (const width of WIDTHS) {
    const text = check({ ...single, feedback: { message: "日本語のフィードバック🙂".repeat(10), type: "warning" } }, width, taggedTheme).join("\n");
    assert.match(text, /a-very-long/);
  }
  assert.match(renderMenu({ ...single, row: 1 }, 200).join("\n"), /名前名\*{4}@例え\.jp/);
});

test("S31 render: width helpers count wide characters and ANSI correctly", () => {
  assert.equal(visibleWidth("名前"), 4);
  assert.equal(visibleWidth("\x1b[31mab\x1b[0m"), 2);
  assert.equal(visibleWidth("🙂"), 2);
  assert.equal(visibleWidth("◉ ★ ● ○ ╭"), 9);
  assert.equal(truncateToWidth("名前名前", 5), "名前…");
  assert.equal(visibleWidth(truncateToWidth("\x1b[31mabcdef\x1b[0m", 4)), 4);
});

test("S35 hits: one entry per rendered line, profiles at row 0 and the open profile's providers at 1..n", () => {
  const m = { ...model(), selected: 0 };
  for (const width of WIDTHS) {
    for (const row of [0, 2]) {
      const lines = renderMenu({ ...m, row }, width, identityTheme);
      const hits = menuHits({ ...m, row }, width);
      assert.equal(hits.length, lines.length, `width ${width} row ${row}: same indexes as the rendered lines`);
      assert.equal(hits[0], null);
      assert.equal(hits.at(-1), null);
    }
  }
  const lines = renderMenu({ ...m, row: 2 }, 100, identityTheme);
  const hits = menuHits({ ...m, row: 2 }, 100);
  const at = (re: RegExp) => hits[lines.findIndex((l) => re.test(l))];
  assert.deepEqual(at(/[●○] personal/), { profile: 0, row: 0 });
  assert.deepEqual(at(/Claude Bridge {2}logged in/), { profile: 0, row: 1 });
  assert.deepEqual(at(/Anthropic {6}logged in/), { profile: 0, row: 2 });
  assert.deepEqual(at(/Codex/), { profile: 0, row: 3 });
  assert.deepEqual(hits.filter((h) => h).length, 1 + 3 + 1, "personal + its 3 providers + work");
  assert.deepEqual(menuHits(m, 3), []);
});

test("S37 render: in the key hints the keys use the theme's accent and the text the dim color", () => {
  const A = "\x1b[35m";
  const D = "\x1b[90m";
  const R = "\x1b[39m";
  const named: MenuTheme = { fg: (color, text) => (color === "accent" ? `${A}${text}${R}` : color === "dim" ? `${D}${text}${R}` : text) };
  const key = (k: string, t: string) => `${A}${k}${R} ${D}${t}${R}`;
  const m = { ...model(), selected: 0 };
  const wide = renderMenu(m, 200, named).join("\n");
  assert.ok(wide.includes(`${key("↑↓", "profile")}  ${key("→←", "providers")}  ${key("enter", "select")}`));
  assert.ok(wide.includes(`${key("n", "new")}  ${key("r", "rename")}  ${key("d", "delete")}  ${key("s", "set session")}`));
  assert.ok(wide.includes(`${key("e", "email")}  ${key("esc", "close")}`));
  assert.ok(!wide.includes(`${A}o${R}`), "no open hint off a logged-in provider");
  assert.ok(renderMenu({ ...m, row: 1 }, 200, named).join("\n").includes(key("o", "open in tab")));
  assert.ok(renderMenu(m, 40, named).join("\n").includes(key("⏎", "ok")), "compact layout too");
});

test("S38 render: the header names the default account, or none when no session profile is set", () => {
  const m = model();
  const named = renderMenu({ ...m, selected: 0 }, 100, identityTheme).join("\n");
  assert.match(named, /Account Default: personal · Account Session: work/);
  const none = { ...m, profiles: m.profiles.map((p) => ({ ...p, startup: false })) };
  assert.match(renderMenu(none, 100, identityTheme).join("\n"), /Account Default: none · Account Session: work/);
  assert.match(renderMenu(none, 40, identityTheme).join("\n"), /Default: none/);
  assert.doesNotMatch(named, /mode:/);
});

test("S41 render: the header labels use the theme's accent and the values the text color", () => {
  const A = "\x1b[35m";
  const T = "\x1b[37m";
  const R = "\x1b[39m";
  const named: MenuTheme = { fg: (color, text) => (color === "accent" ? `${A}${text}${R}` : color === "text" ? `${T}${text}${R}` : text) };
  const wide = renderMenu({ ...model(), selected: 0 }, 100, named).join("\n");
  assert.ok(wide.includes(`${A}Account Default:${R} ${T}personal${R}`));
  assert.ok(wide.includes(`${A}Account Session:${R} ${T}work${R}`));
  const compact = renderMenu({ ...model(), selected: 0 }, 40, named).join("\n");
  assert.ok(compact.includes(`${A}Default:${R} ${T}personal${R}`));
  assert.ok(compact.includes(`${A}Session:${R} ${T}work${R}`));
});

test("S42 hits: one entry per rendered line with multi-line feedback, in the compact layout and with scrolling", () => {
  const long = { message: "first line\nsecond line\nthird line", type: "info" as const };
  for (const width of WIDTHS) {
    const m = { ...model(), selected: 0, row: 2, feedback: long };
    assert.equal(menuHits(m, width).length, renderMenu(m, width, identityTheme).length, `width ${width}`);
  }
});

test("S10 hints: r rename is listed and the wide hints take three lines that fit the narrowest panel", () => {
  const m = { ...model(), selected: 0 };
  const plain = renderMenu(m, 60, identityTheme).map(strip);
  const text = plain.join("\n");
  assert.match(text, /│ ↑↓ profile {2}→← providers {2}enter select +│/);
  assert.match(text, /│ n new {2}r rename {2}d delete {2}s set session +│/);
  assert.match(text, /│ e email {2}esc close +│/);
  const hintLines = plain.filter((l) => /↑↓ profile|n new  r rename|e email/.test(l));
  assert.equal(hintLines.length, 3, "three hint lines");
  assert.doesNotMatch(hintLines.join("\n"), /…/, "no hint is cut at the 60 columns of the panel's minimum width");
  const open = renderMenu({ ...m, row: 1 }, 60, identityTheme).map(strip).join("\n");
  assert.match(open, /│ e email {2}o open in tab {2}esc close +│/);
  for (const width of WIDTHS) for (const line of renderMenu({ ...m, row: 1 }, width, identityTheme)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
});

test("S10 hints: compact layout lists r rename too", () => {
  const text = renderMenu({ ...model(), selected: 0 }, 40, identityTheme).map(strip).join("\n");
  assert.match(text, /n new r rename d del/);
  assert.match(text, /s session e email/);
  assert.match(text, /esc close/);
});

test("hints go on one line when they fit and the frame and separators use the theme's border accent", () => {
  const m = { ...model(), selected: 0 };
  const lines = renderMenu(m, 200, taggedTheme).map(strip);
  assert.ok(lines.some((l) => /↑↓ profile  →← providers  enter select  n new  r rename  d delete  s set session  e email  esc close/.test(l)));
  const colors: string[] = [];
  renderMenu(m, 100, { fg: (c, t) => (colors.push(c), t) });
  assert.ok(colors.includes("borderAccent") && !colors.includes("border"));
});

test("the header shows no session account when none is active", () => {
  const m = model();
  assert.doesNotMatch(renderMenu({ ...m, sessionName: null }, 100, identityTheme).join("\n"), /Session:/);
  assert.doesNotMatch(renderMenu({ ...model({ sessionMode: false }) }, 100, identityTheme).join("\n"), /Session:/, "global mode");
});

test("hints use short labels on one line when the full ones do not fit", () => {
  const plain = renderMenu({ ...model(), selected: 0 }, 100, identityTheme).map(strip);
  assert.ok(plain.some((l) => /↑↓ profile  →← providers  ⏎ ok  n new  r rename  d del  s session  e email  esc close/.test(l)));
});

test("a detected Claude login shows its email only when email display is on, masked", () => {
  const detected = [{ kind: "claude" as const, providers: ["claude"], email: "maria.lopez@company.com" }];
  const hidden = renderMenu({ ...model(), detected }, 100, identityTheme).join("\n");
  assert.match(hidden, /Detected login: Claude Bridge · press i to adopt it as a new profile/);
  assert.doesNotMatch(hidden, /mar\*|maria/);
  const shown = renderMenu({ ...model({ showEmail: true }), detected }, 100, identityTheme).join("\n");
  assert.match(shown, /Claude Bridge \(mar\*{4}@company\.com\)/);
});

test("every profile lists the providers logged in anywhere, logged out where it has no entry", () => {
  const { agentDir, store, liveAuthPath } = globalSetup();
  writeAuthFile(liveAuthPath, { "google-antigravity": { type: "oauth", access: "a", refresh: "r", expires: 1 } });
  const m = buildMenuModel({ store, liveAuthPath, showEmail: false, homeDir: agentDir });
  for (const p of m.profiles) {
    const row = p.providers.find((x) => x.provider === "google-antigravity");
    assert.ok(row, `${p.name} lists it`);
    assert.equal(row.loggedIn, p.active, `${p.name}: logged in only where the entry exists`);
  }
  assert.deepEqual(m.profiles[0].providers.map((x) => x.provider).sort(), m.profiles[1].providers.map((x) => x.provider).sort(), "same rows in every profile");
});

test("the providers /login offers are listed for every profile, logged in or not, with pi's names", () => {
  const { agentDir, store, liveAuthPath } = globalSetup();
  const loginProviders = [{ id: "github-copilot", name: "GitHub Copilot" }, { id: "openai-codex", name: "ChatGPT Plus/Pro" }];
  const m = buildMenuModel({ store, liveAuthPath, showEmail: false, homeDir: agentDir, loginProviders });
  for (const p of m.profiles) {
    const copilot = p.providers.find((x) => x.provider === "github-copilot");
    assert.deepEqual(copilot && [copilot.label, copilot.loggedIn], ["GitHub Copilot", false], `${p.name}: offered, not logged in`);
    assert.equal(p.providers.find((x) => x.provider === "openai-codex")?.label, "Codex", "known labels are kept");
  }
});

test("the providers with a login come first in every profile, then the ones without", () => {
  const { agentDir, store, liveAuthPath } = globalSetup();
  const loginProviders = [{ id: "github-copilot", name: "GitHub Copilot" }];
  const m = buildMenuModel({ store, liveAuthPath, showEmail: false, homeDir: agentDir, loginProviders });
  for (const p of m.profiles) {
    const flags = p.providers.map((x) => x.loggedIn);
    assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), `${p.name}: logged in first`);
  }
});
