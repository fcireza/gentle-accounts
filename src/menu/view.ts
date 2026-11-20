import { join } from "node:path";
import { PLUGIN_LABEL, providerStates, readClaudeAccount, type ClaudeAccount, type ProviderState } from "../account.ts";
import { readAuthFile, type AuthData } from "../auth-sync.ts";
import type { ProfileStore } from "../store.ts";

/** The subset of pi's theme the menu uses; pi's `Theme` satisfies it. */
export interface MenuTheme {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

export const identityTheme: MenuTheme = { fg: (_color, text) => text };

export type FeedbackType = "info" | "warning" | "error";

export interface Feedback {
  message: string;
  type: FeedbackType;
}

export interface MenuProfile {
  name: string;
  /** Active in this session (session mode) or globally (global mode). */
  active: boolean;
  startup: boolean;
  providers: ProviderState[];
}

export interface MenuModel {
  title: string;
  mode: "session home" | "global";
  showEmail: boolean;
  profiles: MenuProfile[];
  /** Index of the selected profile in the list (0 when there are no profiles). */
  selected: number;
  /** 0 is the profile row ("switch", providers collapsed); 1..n are the provider rows of the expanded profile. */
  row: number;
  feedback?: Feedback;
}

export interface BuildMenuOptions {
  store: ProfileStore;
  liveAuthPath: string;
  session: boolean;
  showEmail: boolean;
  homeDir: string;
  /** Cached `claude auth status` result of the status bar for the active profile; undefined when none is cached. */
  activeClaude?: ClaudeAccount | null;
  selectedName?: string | null;
  row?: number;
  feedback?: Feedback;
}

function safeAuth(path: string): AuthData {
  try {
    return readAuthFile(path);
  } catch {
    return {};
  }
}

/** Builds the view model from the store; reads files only (never spawns) and never keeps tokens. */
export function buildMenuModel(options: BuildMenuOptions): MenuModel {
  const { store, homeDir } = options;
  const current = store.current();
  const startup = store.startup();
  const profiles = store.list().map((name): MenuProfile => {
    const active = name === current;
    const claude =
      active && options.activeClaude !== undefined
        ? options.activeClaude
        : readClaudeAccount(store.claudeConfigEnv(name) ?? join(homeDir, ".claude"), homeDir);
    const auth = safeAuth(active ? options.liveAuthPath : store.authPath(name));
    return { name, active, startup: name === startup, providers: providerStates(claude, auth, { showEmail: options.showEmail }) };
  });
  const wanted = options.selectedName ?? current;
  const selected = Math.max(0, profiles.findIndex((p) => p.name === wanted));
  const rows = profiles.length ? profiles[selected].providers.length + 1 : 1;
  const row = Math.min(Math.max(0, options.row ?? 0), rows - 1);
  return {
    title: PLUGIN_LABEL,
    mode: options.session ? "session home" : "global",
    showEmail: options.showEmail,
    profiles,
    selected,
    row,
    feedback: options.feedback,
  };
}

// -- width helpers (pi-tui's are not resolvable from this package under tests) --------------------------

const ANSI = /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/y;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function graphemeWidth(g: string): number {
  const cp = g.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (/^\p{M}+$/u.test(g) || cp === 0x200b || cp === 0x200d) return 0;
  if (isWideCodePoint(cp) || /\p{Extended_Pictographic}/u.test(g) && /\uFE0F|[\u{1F000}-\u{1FFFF}]/u.test(g)) return 2;
  return 1;
}

/** Splits text into ANSI escape tokens and visible graphemes. */
function tokens(text: string): { text: string; width: number }[] {
  const out: { text: string; width: number }[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    for (const { segment } of segmenter.segment(plain)) out.push({ text: segment, width: graphemeWidth(segment) });
    plain = "";
  };
  while (i < text.length) {
    ANSI.lastIndex = i;
    const m = text[i] === "\x1b" ? ANSI.exec(text) : null;
    if (m) {
      flush();
      out.push({ text: m[0], width: -1 });
      i += m[0].length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  flush();
  return out;
}

/** Terminal cells used by `text` (ANSI sequences count 0, wide characters 2). */
export function visibleWidth(text: string): number {
  return tokens(text).reduce((sum, t) => sum + Math.max(0, t.width), 0);
}

/** Cuts `text` to at most `max` cells, ending with `ellipsis` when cut; keeps escape sequences and resets styles. */
export function truncateToWidth(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (visibleWidth(text) <= max) return text;
  const room = Math.max(0, max - visibleWidth(ellipsis));
  let used = 0;
  let out = "";
  let styled = false;
  for (const t of tokens(text)) {
    if (t.width < 0) {
      out += t.text;
      styled = true;
      continue;
    }
    if (used + t.width > room) break;
    out += t.text;
    used += t.width;
  }
  const tail = visibleWidth(ellipsis) <= max ? ellipsis : "";
  return `${out}${styled ? "\x1b[0m" : ""}${tail}`;
}

/** Truncates then pads with spaces to exactly `width` cells. */
export function fit(text: string, width: number): string {
  const cut = truncateToWidth(text, width);
  return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
}

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
