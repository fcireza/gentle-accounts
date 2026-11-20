import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountsMenuPanel, type MenuAction } from "../src/menu/panel.ts";
import { decodeKey, isKeyRelease } from "../src/menu/keys.ts";
import { canOpenProject, identityTheme, type MenuModel, type MenuProfile } from "../src/menu/view.ts";

const providers = (n = 3) =>
  [
    { provider: "claude", label: "Claude Bridge", loggedIn: false },
    { provider: "openai-codex", label: "Codex", loggedIn: false },
    { provider: "anthropic", label: "Anthropic", loggedIn: false },
  ].slice(0, n);

function model(names = ["personal", "work", "zeta"], selected = 1): MenuModel {
  const profiles: MenuProfile[] = names.map((name) => ({ name, active: name === "work", startup: false, providers: providers() }));
  return { title: "gentle-accounts", showEmail: false, profiles, selected, row: 0 };
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

test("S31 panel: up/down move between profiles and Enter switches to the selected one", () => {
  assert.deepEqual(run([KEYS.enter]).actions, [{ type: "switch", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.down, KEYS.enter]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
  assert.deepEqual(run(["j", "\n"]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
  assert.deepEqual(run([KEYS.up, KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
  assert.deepEqual(run(["k", KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
});

test("S31 panel: the profile list wraps around at both ends", () => {
  assert.deepEqual(run([KEYS.down, KEYS.down, KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
  assert.deepEqual(run([KEYS.up, KEYS.up, KEYS.enter]).actions, [{ type: "switch", profile: "zeta", row: 0 }]);
});

test("S31 panel: right expands the providers, Enter logs in, left collapses; rows clamp", () => {
  assert.deepEqual(run([KEYS.right, KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "claude", row: 1 }]);
  assert.deepEqual(run(["l", "j", KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "openai-codex", row: 2 }]);
  assert.deepEqual(run([KEYS.right, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter]).actions, [
    { type: "login", profile: "work", provider: "anthropic", row: 3 },
  ]);
  assert.deepEqual(run([KEYS.right, KEYS.up, KEYS.up, KEYS.enter]).actions, [{ type: "login", profile: "work", provider: "claude", row: 1 }], "up stops at the first provider");
  assert.deepEqual(run([KEYS.right, KEYS.down, KEYS.left, KEYS.enter]).actions, [{ type: "switch", profile: "work", row: 0 }]);
  assert.deepEqual(run(["l", "j", "h", KEYS.enter]).actions, [{ type: "switch", profile: "work", row: 0 }]);
});

test("S31 panel: while expanded up/down stay on the providers; collapsing allows changing profile", () => {
  assert.deepEqual(run([KEYS.right, KEYS.left, KEYS.down, KEYS.right, KEYS.enter]).actions, [{ type: "login", profile: "zeta", provider: "claude", row: 1 }]);
  assert.deepEqual(run([KEYS.right, KEYS.down, KEYS.down, KEYS.left, KEYS.up, KEYS.enter]).actions, [{ type: "switch", profile: "personal", row: 0 }]);
});

test("S31 panel: a profile without providers does not expand", () => {
  const m = model();
  m.profiles[1].providers = [];
  assert.deepEqual(run([KEYS.right, KEYS.enter], m).actions, [{ type: "switch", profile: "work", row: 0 }]);
});

test("S31 panel: shortcut keys produce tagged actions for the selected profile", () => {
  assert.deepEqual(run(["n"]).actions, [{ type: "create", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.down, "d"]).actions, [{ type: "delete", profile: "zeta", row: 0 }]);
  assert.deepEqual(run(["s"]).actions, [{ type: "startup", profile: "work", row: 0 }]);
  assert.deepEqual(run([KEYS.right, "e"]).actions, [{ type: "email", profile: "work", row: 1 }]);
  assert.deepEqual(run(["o"]).actions, [], "open needs a logged-in provider row");
  assert.deepEqual(run([KEYS.right, "o"]).actions, [], "a provider that is not logged in does not open");
  const m = model();
  m.profiles[1].providers[1].loggedIn = true;
  assert.deepEqual(run([KEYS.right, KEYS.down, "o"], m).actions, [{ type: "open", profile: "work", row: 2 }]);
  assert.deepEqual(run(["N"]).actions, [{ type: "create", profile: "work", row: 0 }], "shift does not matter");
});

test("S31 panel: Esc and Ctrl+C close (legacy and kitty sequences)", () => {
  for (const key of [KEYS.esc, KEYS.ctrlC, "\x1b[27u", "\x1b[99;5u"]) assert.deepEqual(run([key]).actions, [{ type: "close" }], JSON.stringify(key));
});

test("S31 panel: key releases, unknown keys and modified keys are ignored; done fires once", () => {
  const r = run(["x", "\x1b[B\x1b[B", "\x1b[99;5:3u", "\x1b[1;1:3B", "\x1b[110;3u", "\x1b[1;5B", "\t", "q", "\x1b[13;1:3u"]);
  assert.deepEqual(r.actions, []);
  assert.match(r.text(), /▸ ● work/, "selection unchanged");
  const twice = run([KEYS.enter, KEYS.enter, "n", KEYS.esc]);
  assert.deepEqual(twice.actions, [{ type: "switch", profile: "work", row: 0 }]);
});

test("S31 panel: kitty presses work like legacy keys", () => {
  assert.deepEqual(run(["\x1b[1;1B", "\x1b[1;1:1C", "\x1b[13u"]).actions, [{ type: "login", profile: "zeta", provider: "claude", row: 1 }]);
  assert.deepEqual(run(["\x1b[110u"]).actions, [{ type: "create", profile: "work", row: 0 }]);
});

test("S31 panel: navigation re-renders the selection and asks the TUI to repaint", () => {
  const r = run([KEYS.down, KEYS.right]);
  assert.equal(r.renders(), 2);
  assert.match(r.text(), /▾ ○ zeta/);
  assert.match(r.text(), /▸ ○ Claude/);
});

test("S31 panel: with no profiles only create, email and close act", () => {
  const empty = model([], 0);
  assert.deepEqual(run([KEYS.enter, "d", "s", "o", KEYS.right, KEYS.down, KEYS.left, KEYS.up], empty).actions, []);
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

// -- mouse (pi delivers it in fullscreen mode only; coordinates are local to the panel) --------------------

const W = 100;
type Mouse = Parameters<AccountsMenuPanel["handleMouse"]>[0];
const mouse = (y: number, extra: Partial<Mouse> = {}): Mouse => ({ type: "click", button: "left", x: 10, y, width: W, clickCount: 1, ...extra });
const lineOf = (panel: AccountsMenuPanel, re: RegExp): number => {
  const y = panel.render(W).findIndex((l) => re.test(l));
  assert.ok(y >= 0, `no line matches ${re}`);
  return y;
};

test("S35 mouse: a click selects the profile under the pointer and swallows the event", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  assert.deepEqual(panel.handleMouse(mouse(lineOf(panel, /zeta/))), { handled: true });
  assert.deepEqual(actions, [], "a single click never acts");
  assert.match(panel.render(W).join("\n"), /▸ ○ zeta/);
  panel.handleInput("\r");
  assert.deepEqual(actions, [{ type: "switch", profile: "zeta", row: 0 }], "the selection is the one Enter acts on");
});

test("S35 mouse: a double click acts like Enter, on a profile and on a provider", () => {
  const onProfile: MenuAction[] = [];
  const a = new AccountsMenuPanel(model(), identityTheme, (x) => onProfile.push(x));
  a.handleMouse(mouse(lineOf(a, /personal/), { clickCount: 1 }));
  assert.deepEqual(onProfile, [], "the first click only selects");
  a.handleMouse(mouse(lineOf(a, /personal/), { clickCount: 2 }));
  assert.deepEqual(onProfile, [{ type: "switch", profile: "personal", row: 0 }]);

  const onProvider: MenuAction[] = [];
  const b = new AccountsMenuPanel(model(), identityTheme, (x) => onProvider.push(x));
  b.handleInput(KEYS.right);
  b.handleMouse(mouse(lineOf(b, /Codex/), { clickCount: 1 }));
  assert.deepEqual(onProvider, []);
  b.handleMouse(mouse(lineOf(b, /Codex/), { clickCount: 2 }));
  assert.deepEqual(onProvider, [{ type: "login", profile: "work", provider: "openai-codex", row: 2 }]);
});

test("S35 mouse: clicking another profile closes the open providers", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  panel.handleInput(KEYS.right);
  assert.match(panel.render(W).join("\n"), /▸ ○ Claude Bridge|▸ ● Claude Bridge/, "providers open on the first row");
  panel.handleMouse(mouse(lineOf(panel, /personal/)));
  const text = panel.render(W).join("\n");
  assert.match(text, /▸ ○ personal/);
  assert.doesNotMatch(text, /Codex {2,}not logged in/, "the providers of the old profile are gone");
});

test("S35 mouse: the wheel moves like up and down, and is ignored without a delta", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  assert.deepEqual(panel.handleMouse({ type: "wheel", button: "none", x: 0, y: 3, width: W, wheelDelta: 1 }), { handled: true });
  panel.handleInput(KEYS.enter);
  assert.deepEqual(actions, [{ type: "switch", profile: "zeta", row: 0 }]);
  const idle = new AccountsMenuPanel(model(), identityTheme, () => undefined);
  assert.equal(idle.handleMouse({ type: "wheel", button: "none", x: 0, y: 3, width: W }), undefined);
});

test("S35 mouse: clicks outside the rows, other buttons and other events change nothing", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  const before = panel.render(W).join("\n");
  const lines = panel.render(W);
  assert.deepEqual(panel.handleMouse(mouse(0)), { handled: true }, "frame");
  assert.deepEqual(panel.handleMouse(mouse(1)), { handled: true }, "header");
  assert.deepEqual(panel.handleMouse(mouse(lines.length - 2)), { handled: true }, "hints");
  assert.deepEqual(panel.handleMouse(mouse(999)), { handled: true }, "below the panel");
  assert.equal(panel.handleMouse(mouse(lineOf(panel, /zeta/), { button: "right" })), undefined);
  for (const type of ["release", "move", "drag"]) assert.equal(panel.handleMouse(mouse(lineOf(panel, /zeta/), { type })), undefined, type);
  assert.equal(panel.handleMouse(mouse(lineOf(panel, /zeta/), { type: "press", button: "right" })), undefined, "a right press stays with pi");
  assert.equal(panel.render(W).join("\n"), before, "nothing moved");
  assert.deepEqual(actions, []);
});

test("S35 mouse: after the panel finished it ignores the mouse", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  panel.handleInput(KEYS.esc);
  assert.equal(panel.handleMouse(mouse(lineOf(panel, /work/), { clickCount: 2 })), undefined);
  assert.deepEqual(actions, [{ type: "close" }]);
});

test("S40 mouse: a left press is handled, because pi only delivers the click of a press the component handled", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  const before = panel.render(W).join("\n");
  // On a row, on the frame and below the panel: always handled (an unhandled press starts a text selection in the chat).
  for (const y of [lineOf(panel, /zeta/), 0, 1, 999]) {
    assert.deepEqual(panel.handleMouse(mouse(y, { type: "press" })), { handled: true, render: false }, `press at ${y}`);
  }
  assert.equal(panel.render(W).join("\n"), before, "a press alone selects nothing; the selection happens on the click");
  assert.deepEqual(actions, []);
  // pi's gesture: press then release on the same cell, then the click it synthesizes.
  const y = lineOf(panel, /zeta/);
  assert.ok(panel.handleMouse(mouse(y, { type: "press" }))?.handled);
  assert.equal(panel.handleMouse(mouse(y, { type: "release" })), undefined);
  assert.ok(panel.handleMouse(mouse(y, { clickCount: 1 }))?.handled);
  assert.match(panel.render(W).join("\n"), /▸ ○ zeta/);
});

test("S42 mouse: a click on the frame or its padding is swallowed without selecting", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  const y = lineOf(panel, /zeta/);
  const before = panel.render(W).join("\n");
  for (const x of [0, 1, W - 2, W - 1]) {
    assert.deepEqual(panel.handleMouse(mouse(y, { x, clickCount: 2 })), { handled: true }, `x ${x}`);
  }
  assert.equal(panel.render(W).join("\n"), before, "nothing moved");
  assert.deepEqual(actions, []);
  assert.deepEqual(panel.handleMouse(mouse(y, { x: 2 })), { handled: true }, "the first content cell selects");
  assert.match(panel.render(W).join("\n"), /▸ ○ zeta/);
});

test("S42 mouse: a double click acts only on what the first click selected, even if that click moved the layout", () => {
  const actions: MenuAction[] = [];
  const panel = new AccountsMenuPanel(model(), identityTheme, (a) => actions.push(a));
  panel.handleInput(KEYS.right); // work's providers are open
  const zeta = lineOf(panel, /zeta/);
  panel.handleMouse(mouse(zeta, { clickCount: 1 })); // selects zeta and closes work's providers: rows move up
  const moved = lineOf(panel, /zeta/);
  assert.notEqual(moved, zeta, "the list moved under the pointer");
  // pi counts the second click of the same cell as clickCount 2, but that cell is now another row: select, never act.
  panel.handleMouse(mouse(zeta, { clickCount: 2 }));
  assert.deepEqual(actions, [], "no action on a row the user never single-clicked");
});

test("S42 mouse: the open rule is one function for the hint and the key", () => {
  const m = model();
  m.profiles[1].providers[1].loggedIn = true;
  assert.equal(canOpenProject({ ...m, row: 0 }), false);
  assert.equal(canOpenProject({ ...m, row: 1 }), false, "Claude Bridge is not logged in");
  assert.equal(canOpenProject({ ...m, row: 2 }), true);
  assert.equal(canOpenProject({ ...m, profiles: [], row: 1 }), false);
});
