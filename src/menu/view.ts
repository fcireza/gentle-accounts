import { fit, truncateToWidth, visibleWidth } from "./width.ts";
import { identityTheme, type MenuModel, type MenuTheme } from "./model.ts";

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
    const state = p.loggedIn ? `logged in${model.showEmail && p.email ? ` · ${clean(p.email)}` : ""}` : "not logged in";
    const label = compact ? p.label : p.label + " ".repeat(Math.max(0, labelWidth - visibleWidth(p.label)));
    return `    ${pointer}${dot} ${theme.fg(row === model.row ? "accent" : "text", label)}${compact ? " " : ""}${theme.fg(p.loggedIn ? "success" : "muted", state)}`;
  });
}

function bodyLines(model: MenuModel, inner: number, theme: MenuTheme): string[] {
  const compact = inner + 4 < COMPACT_WIDTH;
  const lines: string[] = [];
  const header = compact
    ? `${model.title} · ${model.mode === "session home" ? "session" : "global"}`
    : `${model.title} · accounts   mode: ${model.mode} · email: ${model.showEmail ? "shown" : "hidden"}`;
  lines.push(theme.fg("accent", bold(theme, header)));
  if (compact) lines.push(theme.fg("muted", `email: ${model.showEmail ? "shown" : "hidden"}`));
  lines.push(theme.fg("border", "─".repeat(inner)));
  if (!model.profiles.length) {
    lines.push(theme.fg("muted", "no profiles yet: press n to create one"));
  } else {
    const count = model.profiles.length;
    const start = Math.min(Math.max(0, model.selected - Math.floor(MAX_LISTED / 2)), Math.max(0, count - MAX_LISTED));
    const end = Math.min(count, start + MAX_LISTED);
    const nameWidth = Math.min(compact ? 12 : 18, Math.max(...model.profiles.map((p) => visibleWidth(p.name))));
    if (start > 0) lines.push(theme.fg("dim", `  ↑ ${start} more`));
    for (let i = start; i < end; i++) {
      lines.push(profileLine(model, i, nameWidth, theme));
      if (i === model.selected && model.row > 0) lines.push(...providerLines(model, compact, theme));
    }
    if (end < count) lines.push(theme.fg("dim", `  ↓ ${count - end} more`));
  }
  lines.push("");
  if (model.feedback) {
    const tone = model.feedback.type === "error" ? "error" : model.feedback.type === "warning" ? "warning" : "success";
    for (const line of clean(model.feedback.message.replace(/\r/g, "")).split("\n")) lines.push(theme.fg(tone, line));
  } else {
    lines.push(theme.fg("dim", compact ? "enter: switch or log in" : "enter: switch on a profile, log in on a provider (→ opens its providers)"));
  }
  // `o` opens the project with the selected profile, so it is offered only on a logged-in provider row.
  const canOpen = model.row > 0 && model.profiles[model.selected]?.providers[model.row - 1]?.loggedIn === true;
  const hints = compact
    ? ["↑↓ profile →← providers ⏎ ok", "n new d del s session", `e email ${canOpen ? "o open " : ""}esc close`]
    : ["↑↓ profile  →← providers  enter select  n new  d delete", `s set session  e email${canOpen ? "  o open in tab" : ""}  esc close`];
  for (const hint of hints) lines.push(theme.fg("dim", hint));
  return lines;
}

/**
 * Pure renderer: a rounded frame like Gentle Shell's native panel; no returned line is wider than `width`.
 * Under COMPACT_WIDTH columns it uses short labels and wraps the key hints.
 */
export function renderMenu(model: MenuModel, width: number, theme: MenuTheme = identityTheme): string[] {
  const w = Math.max(0, Math.floor(width));
  if (w < 6) return bodyLines(model, 20, identityTheme).map((line) => truncateToWidth(line, w, ""));
  const inner = w - 4;
  const border = (text: string) => theme.fg("border", text);
  const title = ` ${model.title} `;
  const top = visibleWidth(title) + 2 <= inner + 2 ? `╭─${title}${"─".repeat(inner + 2 - 1 - visibleWidth(title))}╮` : `╭${"─".repeat(inner + 2)}╮`;
  return [
    border(top),
    ...bodyLines(model, inner, theme).map((line) => `${border("│")} ${fit(line, inner)} ${border("│")}`),
    border(`╰${"─".repeat(inner + 2)}╯`),
  ];
}
