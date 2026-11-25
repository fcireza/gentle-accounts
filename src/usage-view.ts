import { PROVIDER_LABELS } from "./account.ts";
import type { ProfileStore } from "./store.ts";
import { formatReset, readUsage, type UsageSnapshot } from "./usage.ts";
import { fit, truncateToWidth, visibleWidth } from "./menu/width.ts";
import { identityTheme, type MenuTheme } from "./menu/model.ts";

/** What the "Account Usage" overlay shows: one block per profile with the snapshots it has already seen. */
export interface UsageBoxModel {
  /** Epoch milliseconds the relative times and resets are measured from. */
  now: number;
  profiles: { name: string; /** In use by this session (the menu's rule: the current profile). */ active: boolean; snapshots: UsageSnapshot[] }[];
  /** The hint under the pointer (`escape`); drawn lit. Never changes the layout. */
  hover?: string;
}

/** Reads files only (never the network, never a token): the saved `usage.json` of every profile. */
export function buildUsageModel(store: ProfileStore, now: number): UsageBoxModel {
  const current = store.current();
  return { now, profiles: store.list().map((name) => ({ name, active: name === current, snapshots: readUsage(store, name) })) };
}

/** A clickable stretch of the rendered box (columns and line index of `renderUsageBox`, frame included). */
export interface UsageSpan {
  line: number;
  from: number;
  to: number;
  action: "escape";
}

const METER_CELLS = 10;

function clean(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

const bold = (theme: MenuTheme, text: string): string => (theme.bold ? theme.bold(text) : text);

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(then: number, now: number): string {
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function body(model: UsageBoxModel, inner: number, theme: MenuTheme): { lines: string[]; spans: UsageSpan[] } {
  const lines: string[] = [];
  const spans: UsageSpan[] = [];
  if (!model.profiles.length) lines.push(theme.fg("muted", "no profiles yet"));
  model.profiles.forEach((profile, index) => {
    if (index > 0) lines.push("");
    const dot = profile.active ? theme.fg("success", "●") : theme.fg("dim", "○");
    lines.push(`${dot} ${theme.fg(profile.active ? "text" : "muted", truncateToWidth(clean(profile.name), Math.max(1, inner - 2)))}`);
    if (!profile.snapshots.length) {
      lines.push(`  ${theme.fg("dim", "no usage seen yet")}`);
      return;
    }
    for (const snapshot of profile.snapshots) {
      const provider = PROVIDER_LABELS[snapshot.provider] ?? clean(snapshot.provider);
      const parts = [theme.fg("text", provider), ...(snapshot.plan ? [theme.fg("muted", clean(snapshot.plan))] : []), theme.fg("dim", `updated ${relativeTime(snapshot.fetchedAt, model.now)}`)];
      lines.push(`  ${parts.join(` ${theme.fg("muted", "·")} `)}`);
      const labelWidth = Math.max(4, ...snapshot.windows.map((w) => visibleWidth(clean(w.label))));
      for (const window of snapshot.windows) {
        const percent = Math.min(100, Math.max(0, window.usedPercent));
        const filled = Math.round((percent / 100) * METER_CELLS);
        const tone = percent >= 90 ? "error" : percent >= 70 ? "warning" : "success";
        const meter = theme.fg(tone, "█".repeat(filled)) + theme.fg("dim", "░".repeat(METER_CELLS - filled));
        const label = clean(window.label);
        const reset = formatReset(window.resetAt, model.now);
        lines.push(`    ${theme.fg("accent", label + " ".repeat(labelWidth - visibleWidth(label)))}  ${meter}  ${theme.fg("text", `${Math.round(percent)}%`.padStart(4))}${reset ? `  ${theme.fg("muted", reset)}` : ""}`);
      }
    }
  });
  lines.push("", theme.fg("borderAccent", "─".repeat(inner)));
  const lit = model.hover === "escape";
  const hint = lit ? `${theme.fg("accent", bold(theme, "esc"))} ${theme.fg("text", bold(theme, "close"))}` : `${theme.fg("accent", "esc")} ${theme.fg("dim", "close")}`;
  lines.push(hint);
  spans.push({ line: lines.length - 1, from: 0, to: visibleWidth("esc close"), action: "escape" });
  return { lines, spans };
}

/**
 * Pure renderer: a rounded frame like the accounts menu's; no returned line is wider than `width`. Every body line is
 * one output line (cut to the width, never wrapped).
 */
export function renderUsageBox(model: UsageBoxModel, width: number, theme: MenuTheme = identityTheme): string[] {
  const w = Math.max(0, Math.floor(width));
  if (w < 6) return body(model, 20, identityTheme).lines.map((line) => truncateToWidth(line, w, ""));
  const inner = w - 4;
  const border = (text: string) => theme.fg("borderAccent", text);
  const title = ` ${truncateToWidth("Account Usage", Math.max(0, inner - 2))} `;
  const room = inner + 2 - visibleWidth(title);
  const left = Math.floor(room / 2);
  return [
    `${border(`╭${"─".repeat(left)}`)}${theme.fg("accent", bold(theme, title))}${border(`${"─".repeat(room - left)}╮`)}`,
    ...body(model, inner, theme).lines.map((line) => `${border("│")} ${fit(line, inner)} ${border("│")}`),
    border(`╰${"─".repeat(inner + 2)}╯`),
  ];
}

/** The clickable hints of the rendered box. Empty when it is too narrow to draw a frame. */
export function usageSpans(model: UsageBoxModel, width: number): UsageSpan[] {
  const w = Math.max(0, Math.floor(width));
  if (w < 6) return [];
  return body(model, w - 4, identityTheme).spans.map((s) => ({ ...s, line: s.line + 1, from: s.from + 2, to: s.to + 2 }));
}
