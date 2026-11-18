import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountsMenuPanel, type MenuAction } from "../src/menu/panel.ts";
import { decodeKey, isKeyRelease } from "../src/menu/keys.ts";
import { identityTheme, type MenuModel, type MenuProfile } from "../src/menu/view.ts";

const providers = (n = 3) =>
  [
    { provider: "claude", label: "Claude (claude-bridge)", loggedIn: false },
    { provider: "openai-codex", label: "Codex", loggedIn: false },
    { provider: "anthropic", label: "Anthropic", loggedIn: false },
  ].slice(0, n);

function model(names = ["personal", "work", "zeta"], selected = 1): MenuModel {
  const profiles: MenuProfile[] = names.map((name) => ({ name, active: name === "work", startup: false, providers: providers() }));
  return { title: "gentle-accounts", mode: "global", showEmail: false, profiles, selected, row: 0 };
}

const KEYS = {
  left: "\x1b[D",
  right: "\x1b[C",
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  esc: "\x1b",
  ctrlC: "\x03",
};

function run(keys: string[], m = model()) {
  const actions: MenuAction[] = [];
  let renders = 0;
  const panel = new AccountsMenuPanel(m, identityTheme, (a) => actions.push(a), { requestRender: () => void renders++ });
  for (const k of keys) panel.handleInput(k);
  return { actions, panel, renders: () => renders, text: () => panel.render(100).join("\n") };
}

test("S31 panel: Enter on the profile row switches to the selected tab", () => {
  assert.deepEqual(run([KEYS.enter]).actions, [{ type: "switch", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.right, KEYS.enter]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
  assert.deepEqual(run(["l", "\n"]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
  assert.deepEqual(run([KEYS.left, KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
  assert.deepEqual(run(["h", KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
});

test("S31 panel: tabs wrap around at both ends", () => {
  assert.deepEqual(run([KEYS.right, KEYS.right, KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
  assert.deepEqual(run([KEYS.left, KEYS.left, KEYS.enter]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
});

test("S31 panel: Enter on a provider row starts that provider's login; rows clamp", () => {
  assert.deepEqual(run([KEYS.down, KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "claude", row: 1 }]);
  assert.deepEqual(run(["j", "j", KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "openai-codex", row: 2 }]);
  assert.deepEqual(run([KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter]).actions, [
    { type: "login", profile: "work", provider: "anthropic", row: 3 },
  ]);
  assert.deepEqual(run([KEYS.down, KEYS.up, KEYS.up, KEYS.enter]).actions, [{ type: "switch", profile: "work", row: 0 }]);
  assert.deepEqual(run(["j", "j", "k", KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "claude", row: 1 }]);
});

test("S31 panel: changing tab keeps the row, clamped to the new profile's rows", () => {
  const m = model();
  m.profiles[2].providers = providers(1);
  assert.deepEqual(run([KEYS.down, KEYS.down, KEYS.down, KEYS.right, KEYS.enter], m).actions, [{ type: "login", profile: "zeta", provider: "claude", row: 1 }]);
});

test("S31 panel: shortcut keys produce tagged actions for the selected profile", () => {
  assert.deepEqual(run(["n"]).actions, [{ type: "create", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.right, "d"]).actions, [{ type: "delete", profile: "zeta", row: 0 }]);
  assert.deepEqual(run(["s"]).actions, [{ type: "startup", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.down, "e"]).actions, [{ type: "email", profile: "work", row: 1 }]);
  assert.deepEqual(run(["o"]).actions, [{ type: "open", profile: "work", row: 0 }]);
  assert.deepEqual(run(["N"]).actions, [{ type: "create", profile: "work", row: 0 }], "shift does not matter");
});

test("S31 panel: Esc and Ctrl+C close (legacy and kitty sequences)", () => {
  for (const key of [KEYS.esc, KEYS.ctrlC, "\x1b[27u", "\x1b[99;5u"]) assert.deepEqual(run([key]).actions, [{ type: "close" }], JSON.stringify(key));
});

test("S31 panel: key releases, unknown keys and modified keys are ignored; done fires once", () => {
  const r = run(["x", "\x1b[C\x1b[C", "\x1b[99;5:3u", "\x1b[1;1:3C", "\x1b[110;3u", "\x1b[1;5C", "\t", "q", "\x1b[13;1:3u"]);
  assert.deepEqual(r.actions, []);
  assert.match(r.text(), /\[◉ work\]/, "selection unchanged");
  const twice = run([KEYS.enter, KEYS.enter, "n", KEYS.esc]);
  assert.deepEqual(twice.actions, [{ type: "switch", profile: "work", row: 0 }]);
});

test("S31 panel: kitty presses work like legacy keys", () => {
  assert.deepEqual(run(["\x1b[1;1C", "\x1b[1;1:1B", "\x1b[13u"]).actions, [{ type: "login", profile: "zeta", provider: "claude", row: 1 }]);
  assert.deepEqual(run(["\x1b[110u"]).actions, [{ type: "create", profile: "work", row: 0 }]);
});

test("S31 panel: navigation re-renders the selection and asks the TUI to repaint", () => {
  const r = run([KEYS.right, KEYS.down]);
  assert.equal(r.renders(), 2);
  assert.match(r.text(), /\[zeta\]/);
  assert.match(r.text(), /▸ ○ Claude/);
});

test("S31 panel: with no profiles only create, email and close act", () => {
  const empty = model([], 0);
  assert.deepEqual(run([KEYS.enter, "d", "s", "o", KEYS.right, KEYS.down], empty).actions, []);
  assert.deepEqual(run(["n"], empty).actions, [{ type: "create", row: 0 }]);
  assert.deepEqual(run(["e"], empty).actions, [{ type: "email", row: 0 }]);
  assert.deepEqual(run([KEYS.esc], empty).actions, [{ type: "close" }]);
});

test("S31 keys: decoder table", () => {
  assert.equal(decodeKey("\x1bOD"), "left");
  assert.equal(decodeKey("\x1bOA"), "up");
  assert.equal(decodeKey("\x1b[57414u"), "enter");
  assert.equal(isKeyRelease("\x1b[97;1:3u"), true);
  assert.equal(isKeyRelease("\x1b[97;1:1u"), false);
  assert.equal(decodeKey("\x1b[97;1:3u"), undefined);
  assert.equal(decodeKey("é"), undefined);
});
