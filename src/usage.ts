import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getUsageBox } from "./settings.ts";
import { writeFileAtomic, type ProfileStore } from "./store.ts";

/**
 * The usage an account's provider reported on responses this session already received. Only numbers and labels are
 * kept: no header text, token or account identifier is ever stored. The semantics (header names, units, labels) are
 * copied from Gentle Shell's `shell-usage`, not imported.
 */
export interface UsageWindow {
  label: string;
  usedPercent: number;
  /** Epoch milliseconds, or null when the provider sent no reset time. */
  resetAt: number | null;
}

export interface UsageSnapshot {
  provider: string;
  plan?: string;
  windows: UsageWindow[];
  /** Epoch milliseconds of the response the numbers came from. */
  fetchedAt: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;
const ANTHROPIC_PREFIX = "anthropic-ratelimit-unified-";
const CODEX_PREFIX = "x-codex-";
const ANTHROPIC_WINDOWS: ReadonlyArray<[key: string, seconds: number]> = [
  ["5h", 18_000],
  ["7d", 604_800],
];

export function windowLabel(seconds: number): string {
  if (seconds === WEEK) return "week";
  if (seconds >= DAY && seconds % DAY === 0) return `${seconds / DAY}d`;
  if (seconds >= HOUR && seconds % HOUR === 0) return `${seconds / HOUR}h`;
  return `${Math.round(seconds / MINUTE)}m`;
}

export function formatReset(resetAt: number | null, now: number): string {
  if (resetAt === null) return "";
  const seconds = Math.floor((resetAt - now) / 1000);
  if (seconds <= 0) return "resets now";
  if (seconds < HOUR) return `resets in ${Math.max(1, Math.round(seconds / MINUTE))}m`;
  if (seconds < DAY) return `resets in ${Math.floor(seconds / HOUR)}h ${Math.floor((seconds % HOUR) / MINUTE)}m`;
  return `resets in ${Math.floor(seconds / DAY)}d ${Math.floor((seconds % DAY) / HOUR)}h`;
}

const lower = (headers: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) if (typeof value === "string") out[name.toLowerCase()] = value;
  return out;
};

function codexWindow(h: Record<string, string>, kind: "primary" | "secondary"): UsageWindow | undefined {
  const used = Number.parseFloat(h[`${CODEX_PREFIX}${kind}-used-percent`] ?? "");
  if (!Number.isFinite(used)) return undefined;
  // A missing or invalid duration is not a zero-minute quota nor an assumed window.
  const seconds = Number(h[`${CODEX_PREFIX}${kind}-window-minutes`]) * MINUTE;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const reset = Number.parseInt(h[`${CODEX_PREFIX}${kind}-reset-at`] ?? "", 10);
  return { label: windowLabel(seconds), usedPercent: used, resetAt: Number.isFinite(reset) ? reset * 1000 : null };
}

/**
 * Reads the rate-limit headers of one provider response: Codex (percent, window in minutes, reset in epoch seconds) or
 * Anthropic (a 0..1 fraction and the reset in epoch seconds per window). undefined when they carry no usage.
 * The provider is the header format's own (`openai-codex`, `anthropic`); the caller may file it under the serving one.
 */
export function parseUsageHeaders(headers: Record<string, string>, now: number): UsageSnapshot | undefined {
  const h = lower(headers);
  const codex = [codexWindow(h, "primary"), codexWindow(h, "secondary")].filter((w): w is UsageWindow => w !== undefined);
  if (codex.length) return { provider: "openai-codex", windows: codex, fetchedAt: now };
  const windows: UsageWindow[] = [];
  for (const [key, seconds] of ANTHROPIC_WINDOWS) {
    const fraction = Number.parseFloat(h[`${ANTHROPIC_PREFIX}${key}-utilization`] ?? "");
    if (!Number.isFinite(fraction)) continue;
    const reset = Number.parseInt(h[`${ANTHROPIC_PREFIX}${key}-reset`] ?? "", 10);
    windows.push({ label: windowLabel(seconds), usedPercent: fraction * 100, resetAt: Number.isFinite(reset) ? reset * 1000 : null });
  }
  return windows.length ? { provider: "anthropic", windows, fetchedAt: now } : undefined;
}

/** `<profile folder>/usage.json`: it moves with a rename and goes with the folder on delete. */
export function usagePath(store: ProfileStore, name: string): string {
  return join(store.profileDir(name), "usage.json");
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validSnapshot(value: unknown): UsageSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.provider !== "string" || !isNumber(raw.fetchedAt) || !Array.isArray(raw.windows)) return undefined;
  if (raw.plan !== undefined && typeof raw.plan !== "string") return undefined;
  const windows: UsageWindow[] = [];
  for (const entry of raw.windows) {
    const w = entry as Record<string, unknown> | null;
    if (!w || typeof w.label !== "string" || !isNumber(w.usedPercent) || !(w.resetAt === null || isNumber(w.resetAt))) return undefined;
    windows.push({ label: w.label, usedPercent: w.usedPercent, resetAt: w.resetAt });
  }
  return { provider: raw.provider, ...(typeof raw.plan === "string" ? { plan: raw.plan } : {}), windows, fetchedAt: raw.fetchedAt };
}

/** The snapshots saved for a profile (one per provider). Missing, corrupt or malformed files read as none; never throws. */
export function readUsage(store: ProfileStore, name: string): UsageSnapshot[] {
  try {
    const data = JSON.parse(readFileSync(usagePath(store, name), "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    return Object.values(data).flatMap((entry) => validSnapshot(entry) ?? []);
  } catch {
    return [];
  }
}

/** Replaces the snapshot of the same provider, keeping the others. A profile that does not exist is not created. */
export function recordUsage(store: ProfileStore, name: string, snapshot: UsageSnapshot): void {
  if (!store.exists(name)) return;
  const next: Record<string, UsageSnapshot> = {};
  for (const known of readUsage(store, name)) next[known.provider] = known;
  const { provider, plan, windows, fetchedAt } = snapshot;
  next[provider] = { provider, ...(plan ? { plan } : {}), windows: windows.map(({ label, usedPercent, resetAt }) => ({ label, usedPercent, resetAt })), fetchedAt };
  writeFileAtomic(usagePath(store, name), `${JSON.stringify(next, null, 2)}\n`);
}

export interface CaptureOptions {
  store: ProfileStore;
  settingsFile: string;
  headers: Record<string, string>;
  /** The provider that served the response (the headers only name a format, e.g. Claude Code's bridge speaks Anthropic's). */
  servedProvider?: string;
  now: number;
}

/**
 * Files what a provider response reported under the current profile. Does nothing while the box is disabled, without a
 * current profile or without usage headers; never throws, so a response is never affected. Returns whether it saved.
 */
export function captureUsage({ store, settingsFile, headers, servedProvider, now }: CaptureOptions): boolean {
  try {
    if (!getUsageBox(settingsFile)) return false;
    const parsed = parseUsageHeaders(headers, now);
    if (!parsed) return false;
    const profile = store.current();
    if (!profile || !store.exists(profile)) return false;
    recordUsage(store, profile, servedProvider ? { ...parsed, provider: servedProvider } : parsed);
    return true;
  } catch {
    return false;
  }
}
