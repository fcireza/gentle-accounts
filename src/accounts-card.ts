import { PROVIDER_LABELS } from "./account.ts";
import type { ProfileStore } from "./store.ts";
import { readUsage, type UsageSnapshot } from "./usage.ts";
import { fit, truncateToWidth, visibleWidth } from "./menu/width.ts";
import { identityTheme, type MenuTheme } from "./menu/model.ts";

/** What the "Gentle Accounts" card shows: the default profile, this session's profile and the last seen usage per profile. */
export interface AccountsCardModel {
  /** The default (star) profile: the one new sessions start on; null when none is set. */
  defaultProfile: string | null;
  /** The profile this session uses (the current one); null when there is none. */
  session: string | null;
  profiles: { name: string; active: boolean; snapshots: UsageSnapshot[] }[];
}

export const MAX_CARD_PROFILES = 5;

const safe = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

/** Reads files only (never auth.json, never a token); never throws: anything unreadable reads as empty. */
export function buildAccountsCardModel(store: ProfileStore): AccountsCardModel {
  const session = safe(() => store.current(), null);
  return {
    defaultProfile: safe(() => store.startup(), null),
    session,
    profiles: safe(() => store.list(), [] as string[]).map((name) => ({ name, active: name === session, snapshots: safe(() => readUsage(store, name), []) })),
  };
}

const clean = (text: string): string => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** `Claude 5h 62% · 7d 20%`, one group per provider; undefined when there are no snapshots. */
function summary(snapshots: UsageSnapshot[], theme: MenuTheme): string | undefined {
  const groups = snapshots.filter((s) => s.windows.length).map((s) => {
    const label = PROVIDER_LABELS[s.provider] ?? clean(s.provider);
    const windows = s.windows.map((w) => `${clean(w.label)} ${Math.round(Math.min(100, Math.max(0, w.usedPercent)))}%`).join(` ${theme.fg("muted", "·")} `);
    return `${theme.fg("text", label)} ${theme.fg("accent", windows)}`;
  });
  return groups.length ? groups.join("  ") : undefined;
}

function body(model: AccountsCardModel, theme: MenuTheme): string[] {
  const row = (label: string, value: string | null) => `${theme.fg("muted", label.padEnd(8))}${value ? theme.fg("text", clean(value)) : theme.fg("dim", "none")}`;
  const lines = [row("Default", model.defaultProfile), row("Session", model.session), theme.fg("accent", "Usage")];
  const shown = model.profiles.slice(0, MAX_CARD_PROFILES);
  for (const p of shown) {
    const dot = p.active ? theme.fg("success", "●") : theme.fg("dim", "○");
    const used = summary(p.snapshots, theme) ?? theme.fg("dim", "no usage yet");
    lines.push(`${dot} ${theme.fg(p.active ? "text" : "muted", clean(p.name))}  ${used}`);
  }
  if (model.profiles.length > shown.length) lines.push(theme.fg("dim", `+${model.profiles.length - shown.length} more`));
  return lines;
}

/** Pure renderer: a rounded frame like the usage box's; no line wider than `width`, every row one line (cut, never wrapped). */
export function renderAccountsCard(model: AccountsCardModel, width: number, theme: MenuTheme = identityTheme): string[] {
  const w = Math.max(0, Math.floor(width));
  const lines = body(model, theme);
  if (w < 6) return lines.map((line) => truncateToWidth(line, w, ""));
  const inner = w - 4;
  const border = (text: string) => theme.fg("borderAccent", text);
  const title = ` ${truncateToWidth("Gentle Accounts", Math.max(0, inner - 2))} `;
  const room = inner + 2 - visibleWidth(title);
  const left = Math.floor(room / 2);
  const bold = (t: string) => (theme.bold ? theme.bold(t) : t);
  return [
    `${border(`╭${"─".repeat(left)}`)}${theme.fg("accent", bold(title))}${border(`${"─".repeat(room - left)}╮`)}`,
    ...lines.map((line) => `${border("│")} ${fit(line, inner)} ${border("│")}`),
    border(`╰${"─".repeat(inner + 2)}╯`),
  ];
}
