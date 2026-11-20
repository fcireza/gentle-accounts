import { PROVIDER_LABELS, maskEmail } from "../account.ts";
import { fit, truncateToWidth, visibleWidth } from "./width.ts";
import { canOpenProject, identityTheme, type MenuModel, type MenuTheme } from "./model.ts";

// The menu's public surface stays in this module: the model and the width helpers are re-exported.
export * from "./model.ts";
export { fit, truncateToWidth, visibleWidth } from "./width.ts";

function clean(text: string): string {
  // Names are validated and emails come from local files; drop control characters anyway.
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

// -- renderer -----------------------------------------------------------------------------------------

export const COMPACT_WIDTH = 50;

function bold(theme: MenuTheme, text: string): string {
  return theme.bold ? theme.bold(text) : text;
}

/** Profiles listed at once; the list scrolls around the selected one beyond this. */
const MAX_LISTED = 8;

/** One profile row of the list: pointer, active dot, name, startup star and a summary of its logged-in providers. */
function profileLine(model: MenuModel, index: number, nameWidth: number, theme: MenuTheme): string {
  const p = model.profiles[index];
  const selected = index === model.selected;
  const pointer = selected ? theme.fg("accent", model.row === 0 ? "▸ " : "▾ ") : "  ";
  const dot = p.active ? theme.fg("success", "●") : theme.fg("dim", "○");
  const name = fit(truncateToWidth(p.name, nameWidth), nameWidth);
  const nameColor = selected ? "accent" : p.active ? "text" : "muted";
  const star = p.startup ? theme.fg("warning", "★") : " ";
  const logged = p.providers.filter((x) => x.loggedIn).map((x) => x.label);
  const summary = logged.length ? theme.fg("muted", logged.join(" · ")) : theme.fg("warning", "not logged in");
  const active = p.active ? `  ${theme.fg("success", "active")}` : "";
  return `${pointer}${dot} ${selected ? theme.fg(nameColor, bold(theme, name)) : theme.fg(nameColor, name)} ${star}  ${summary}${active}`;
}

/** The provider rows shown under the expanded profile: log in on Enter. */
function providerLines(model: MenuModel, compact: boolean, theme: MenuTheme): string[] {
  const profile = model.profiles[model.selected];
  const labelWidth = compact ? 0 : Math.max(...profile.providers.map((p) => visibleWidth(p.label))) + 2;
  return profile.providers.map((p, k) => {
    const row = k + 1;
    const pointer = row === model.row ? theme.fg("accent", "▸ ") : "  ";
    const dot = p.loggedIn ? theme.fg("success", "●") : theme.fg("dim", "○");
    const state = p.loggedIn ? `logged in${model.showEmail && p.email ? ` · ${maskEmail(clean(p.email))}` : ""}` : "not logged in";
    const label = compact ? p.label : p.label + " ".repeat(Math.max(0, labelWidth - visibleWidth(p.label)));
    return `    ${pointer}${dot} ${theme.fg(row === model.row ? "accent" : "text", label)}${compact ? " " : ""}${theme.fg(p.loggedIn ? "success" : "muted", state)}`;
  });
}

/** What a click on a rendered line selects: a profile (row 0) or one of its provider rows (1..n). */
export interface MenuHit {
  profile: number;
  row: number;
}

/**
 * The body of the panel as `lines` plus `hits`, one entry per line. Invariant: every entry of `lines` is rendered as
 * exactly one output line (`renderMenu` fits it to the width, it never wraps), so a click row maps to `hits[row - 1]`.
 * Add a line only through `add`, with its hit or null.
 */
function bodyLines(model: MenuModel, inner: number, theme: MenuTheme): { lines: string[]; hits: (MenuHit | null)[] } {
  const compact = inner + 4 < COMPACT_WIDTH;
  const lines: string[] = [];
  const hits: (MenuHit | null)[] = [];
  const add = (line: string, hit: MenuHit | null = null): void => {
    lines.push(line);
    hits.push(hit);
  };
  // The default account is the session profile: the one new sessions start on (`★` in the list).
  const defaultName = model.profiles.find((p) => p.startup)?.name ?? "none";
  // The labels use the theme's accent, the values the plain text color.
  const label = (text: string) => theme.fg("accent", text);
  // The session account is the profile set for this session; it is shown only when there is one.
  const sessionName = model.sessionName;
  const session = sessionName ? `${label("Account Session:")} ${theme.fg("text", sessionName)}` : "";
  const sep = ` ${theme.fg("muted", "·")} `;
  add(compact ? `${label("Default:")} ${theme.fg("text", defaultName)}` : `${label("Account Default:")} ${theme.fg("text", defaultName)}${session ? sep + session : ""}`);
  if (compact && sessionName) add(`${label("Session:")} ${theme.fg("text", sessionName)}`);
  add(theme.fg("borderAccent", "─".repeat(inner)));
  if (!model.profiles.length) {
    add(theme.fg("muted", "no profiles yet: press n to create one"));
  } else {
    const count = model.profiles.length;
    const start = Math.min(Math.max(0, model.selected - Math.floor(MAX_LISTED / 2)), Math.max(0, count - MAX_LISTED));
    const end = Math.min(count, start + MAX_LISTED);
    const nameWidth = Math.min(compact ? 12 : 18, Math.max(...model.profiles.map((p) => visibleWidth(p.name))));
    if (start > 0) add(theme.fg("dim", `  ↑ ${start} more`));
    for (let i = start; i < end; i++) {
      add(profileLine(model, i, nameWidth, theme), { profile: i, row: 0 });
      if (i === model.selected && model.row > 0) providerLines(model, compact, theme).forEach((line, k) => add(line, { profile: i, row: k + 1 }));
    }
    if (end < count) add(theme.fg("dim", `  ↓ ${count - end} more`));
  }
  for (const login of model.detected ?? []) {
    const what = login.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(" · ");
    const who = login.kind === "claude" && model.showEmail && login.email ? ` (${maskEmail(clean(login.email))})` : "";
    add(`${theme.fg("warning", "+")} ${theme.fg("muted", "Detected login:")} ${theme.fg("text", what + who)} ${theme.fg("dim", compact ? "" : "· press")} ${theme.fg("accent", "i")}${compact ? "" : ` ${theme.fg("dim", "to adopt it as a new profile")}`}`.trimEnd());
  }
  add("");
  if (model.feedback) {
    const tone = model.feedback.type === "error" ? "error" : model.feedback.type === "warning" ? "warning" : "success";
    for (const line of clean(model.feedback.message.replace(/\r/g, "")).split("\n")) add(theme.fg(tone, line));
  } else {
    add(theme.fg("dim", compact ? "enter: switch or log in" : "enter: switch on a profile, log in on a provider (→ opens its providers)"));
  }
  // `o` opens the project with the selected profile, so it is offered only on a logged-in provider row.
  const canOpen = canOpenProject(model);
  // Each hint is [key, what it does]: the key is drawn in the theme's accent, the text dim.
  type Hint = [string, string];
  const open: Hint[] = canOpen ? [["o", compact ? "open" : "open in tab"]] : [];
  const adopt: Hint[] = (model.detected ?? []).length ? [["i", "adopt"]] : [];
  const hints: Hint[][] = compact
    ? [[["↑↓", "profile"], ["→←", "providers"], ["⏎", "ok"]], [["n", "new"], ["r", "rename"], ["d", "del"]], [["s", "session"], ["e", "email"]], [...adopt, ...open, ["esc", "close"]]]
    : [[["↑↓", "profile"], ["→←", "providers"], ["enter", "select"]], [["n", "new"], ["r", "rename"], ["d", "delete"], ["s", "set session"]], [["e", "email"], ...adopt, ...open, ["esc", "close"]]];
  const short: Hint[] = [["↑↓", "profile"], ["→←", "providers"], ["⏎", "ok"], ["n", "new"], ["r", "rename"], ["d", "del"], ["s", "session"], ["e", "email"], ...adopt, ...open.map(([k]): Hint => [k, "open"]), ["esc", "close"]];
  add(theme.fg("borderAccent", "─".repeat(inner)));
  const render = (line: Hint[], gap: string) => line.map(([key, text]) => `${theme.fg("accent", key)} ${theme.fg("dim", text)}`).join(gap);
  const width = (line: Hint[], gap: string) => visibleWidth(line.map(([key, text]) => `${key} ${text}`).join(gap));
  // All the hints go on one line when they fit (full labels, then short ones); otherwise they wrap in their groups.
  const single = hints.flat();
  if (!compact && width(single, "  ") <= inner) add(render(single, "  "));
  else if (width(short, "  ") <= inner) add(render(short, "  "));
  else if (width(short, " ") <= inner) add(render(short, " "));
  else for (const line of hints) add(render(line, compact ? " " : "  "));
  return { lines, hits };
}

/**
 * Pure renderer: a rounded frame like Gentle Shell's native panel; no returned line is wider than `width`.
 * Under COMPACT_WIDTH columns it uses short labels and wraps the key hints.
 */
export function renderMenu(model: MenuModel, width: number, theme: MenuTheme = identityTheme): string[] {
  const w = Math.max(0, Math.floor(width));
  if (w < 6) return bodyLines(model, 20, identityTheme).lines.map((line) => truncateToWidth(line, w, ""));
  const inner = w - 4;
  const border = (text: string) => theme.fg("borderAccent", text);
  // The title sits centered in the top border.
  const title = ` ${truncateToWidth("Gentle Accounts", Math.max(0, inner - 2))} `;
  const room = inner + 2 - visibleWidth(title);
  const left = Math.floor(room / 2);
  return [
    `${border(`╭${"─".repeat(left)}`)}${theme.fg("accent", bold(theme, title))}${border(`${"─".repeat(room - left)}╮`)}`,
    ...bodyLines(model, inner, theme).lines.map((line) => `${border("│")} ${fit(line, inner)} ${border("│")}`),
    border(`╰${"─".repeat(inner + 2)}╯`),
  ];
}

/**
 * For each line `renderMenu` returns at `width`, what a click on it selects (null on the frame, the header,
 * the hints and every other line). Same indexes as the rendered lines: the top border is line 0.
 */
export function menuHits(model: MenuModel, width: number): (MenuHit | null)[] {
  const w = Math.max(0, Math.floor(width));
  if (w < 6) return [];
  return [null, ...bodyLines(model, w - 4, identityTheme).hits, null];
}
