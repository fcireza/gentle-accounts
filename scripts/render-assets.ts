// Renders the README logo and usage illustrations as self-contained SVG files (S24).
// Terminal texts come from the real functions or from literal messages in src/index.ts.
// Deterministic output: no dates, no random ids. Run with `pnpm run assets`.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statusText } from "../src/account.ts";
import { claudeLoginCommand, loginHint } from "../src/login.ts";

const C = {
  base: "#1a1218", surface: "#241822", border: "#342230", accent: "#ff76c3", soft: "#ffb1dd",
  text: "#f6eff3", muted: "#a78e9b", green: "#b4e7c7", yellow: "#e0c27a", red: "#ff718f",
};
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace`;
const SANS = `system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif`;
const NS = "http://www.w3.org/2000/svg";
const CHAR = 0.6; // estimated monospace advance per font-size unit
const NOT_SCREENSHOT = "Illustration generated from the project's real messages, not a screenshot.";

/** Literal fragments of the messages shown in workflow-switch.svg; each must exist in src/index.ts. */
export const SWITCH_SOURCE_FRAGMENTS: readonly string[] = [
  `"* "`, `"  "`, `Switched to profile "`, `". Claude Code dir: `, "Active profile: ", " (CLAUDE_CONFIG_DIR=",
];

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function svg(w: number, h: number, title: string, desc: string, body: string[]): string {
  return [
    `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(desc)}</desc>`,
    `<rect width="${w}" height="${h}" rx="16" fill="${C.base}"/>`,
    ...body,
    `</svg>`,
    "",
  ].join("\n");
}

type Span = { text: string; color?: string; bold?: boolean };

/** One monospace text line made of colored spans; whitespace is preserved. */
function line(x: number, y: number, spans: Span[] | string, size: number, color: string = C.text): string {
  const parts = typeof spans === "string" ? [{ text: spans }] : spans;
  const inner = parts
    .map((p) => `<tspan fill="${p.color ?? color}"${p.bold ? ` font-weight="700"` : ""}>${esc(p.text)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" xml:space="preserve" font-family="${MONO}" font-size="${size}">${inner}</text>`;
}

/** Accent background band with a left bar behind a text line whose baseline is y. */
function highlight(x: number, y: number, w: number, size: number): string {
  const top = y - size * 1.05;
  const h = size * 1.5;
  return `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="4" fill="${C.accent}" fill-opacity="0.18"/>` +
    `<rect x="${x}" y="${top}" width="4" height="${h}" rx="2" fill="${C.accent}"/>`;
}

/** Terminal window frame: surface box, title bar with three dots and a centered title. */
function windowFrame(x: number, y: number, w: number, h: number, title: string): string {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.surface}" stroke="${C.border}" stroke-width="2"/>`,
    `<line x1="${x}" y1="${y + 40}" x2="${x + w}" y2="${y + 40}" stroke="${C.border}" stroke-width="2"/>`,
    `<circle cx="${x + 22}" cy="${y + 20}" r="6" fill="${C.red}"/>`,
    `<circle cx="${x + 42}" cy="${y + 20}" r="6" fill="${C.yellow}"/>`,
    `<circle cx="${x + 62}" cy="${y + 20}" r="6" fill="${C.green}"/>`,
    `<text x="${x + w / 2}" y="${y + 26}" text-anchor="middle" font-family="${MONO}" font-size="15" fill="${C.muted}">${esc(title)}</text>`,
  ].join("\n");
}

/** Status/footer bar at the bottom of a window with the real status text, profile part in accent. */
function statusBar(x: number, y: number, w: number, size: number): string {
  const status = statusText("work", { email: EXAMPLE_EMAIL });
  const [label, rest] = status.split(": ");
  const [profile, account] = rest.split(" · ");
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${size * 2.4}" fill="${C.base}" stroke="${C.border}" stroke-width="2"/>`,
    line(x + 16, y + size * 1.6, [
      { text: `${label}: `, color: C.muted },
      { text: profile, color: C.accent, bold: true },
      { text: ` · ${account}`, color: C.text },
    ], size),
  ].join("\n");
}

const EXAMPLE_EMAIL = "maria.lopez@company.com";

/** Bust glyph: head circle plus closed shoulders (flat bottom, rounded top corners). */
function bust(cx: number, top: number, attrs: string): string {
  const [r, hw, bodyTop, bottom, corner] = [26, 46, top + 64, top + 120, 22];
  return `<circle cx="${cx}" cy="${top + r}" r="${r}" ${attrs}/>\n` +
    `<path d="M ${cx - hw} ${bottom} V ${bodyTop + corner} A ${corner} ${corner} 0 0 1 ${cx - hw + corner} ${bodyTop} ` +
    `H ${cx + hw - corner} A ${corner} ${corner} 0 0 1 ${cx + hw} ${bodyTop + corner} V ${bottom} Z" ${attrs}/>`;
}

/** Arrowhead whose tip is at (x, y), pointing along the unit direction (dx, dy). */
function arrowHead(x: number, y: number, dx: number, dy: number, color: string): string {
  const [len, half] = [14, 8];
  const bx = x - dx * len;
  const by = y - dy * len;
  const f = (n: number) => n.toFixed(1);
  return `<polygon points="${f(x)},${f(y)} ${f(bx - dy * half)},${f(by + dx * half)} ${f(bx + dy * half)},${f(by - dx * half)}" fill="${color}"/>`;
}

function markBody(): string[] {
  // Curved double arrow: a quadratic arc whose ends stop short of symmetric arrowheads.
  const [x1, x2, y, cy] = [72, 184, 214, 238];
  const t = Math.hypot(x2 - 128, y - cy);
  const [dx, dy] = [(x2 - 128) / t, (y - cy) / t]; // end tangent of the arc (right end)
  return [
    bust(96, 28, `fill="none" stroke="${C.soft}" stroke-width="8" stroke-linejoin="round"`),
    // Front avatar: a base-colored outline first gives a clean gap, then the accent fill on top.
    bust(160, 70, `fill="${C.base}" stroke="${C.base}" stroke-width="12" stroke-linejoin="round"`),
    bust(160, 70, `fill="${C.accent}"`),
    `<path d="M ${x1} ${y} Q 128 ${cy} ${x2} ${y}" fill="none" stroke="${C.soft}" stroke-width="6" stroke-linecap="round"/>`,
    arrowHead(x2 + dx * 12, y + dy * 12, dx, dy, C.soft),
    arrowHead(x1 - dx * 12, y + dy * 12, -dx, dy, C.soft),
  ];
}

function logoMark(): string {
  return svg(256, 256, "gentle-accounts mark", `Two overlapping account avatars with a switch arrow. ${NOT_SCREENSHOT}`, markBody());
}

function logo(): string {
  return svg(720, 200, "gentle-accounts", `gentle-accounts logo: mark and wordmark, tagline "one shell, many accounts". ${NOT_SCREENSHOT}`, [
    `<g transform="translate(20 22) scale(0.61)">`, ...markBody(), `</g>`,
    `<text x="200" y="106" font-family="${SANS}" font-size="56" font-weight="700"><tspan fill="${C.muted}">gentle-</tspan><tspan fill="${C.accent}">accounts</tspan></text>`,
    `<text x="202" y="146" font-family="${SANS}" font-size="22" fill="${C.muted}">one shell, many accounts</text>`,
  ]);
}

function hero(): string {
  const [w, h] = [1200, 620];
  const [x, y, ww, wh] = [40, 32, 1120, 520];
  const body = [windowFrame(x, y, ww, wh, "gentle-shell")];
  const placeholders: Array<[string, number]> = [["▸", 520], ["", 760], ["", 640], ["▸", 420], ["", 700]];
  let ly = y + 90;
  for (const [mark, len] of placeholders) {
    if (mark) body.push(line(x + 24, ly + 4, mark, 18, C.accent));
    body.push(`<rect x="${x + 52}" y="${ly - 10}" width="${len}" height="12" rx="6" fill="${C.muted}" fill-opacity="0.35"/>`);
    ly += mark ? 52 : 34;
  }
  body.push(statusBar(x, y + wh - 52, ww, 20));
  body.push(`<text x="${w / 2}" y="${h - 28}" text-anchor="middle" font-family="${SANS}" font-size="16" fill="${C.muted}">Illustration based on real messages, not a screenshot.</text>`);
  return svg(w, h, "gentle-accounts status bar in Gentle Shell", `A Gentle Shell style terminal whose footer shows the active profile and the masked account. ${NOT_SCREENSHOT}`, body);
}

function workflowSwitch(): string {
  const [w, h] = [1200, 640];
  const [x, y, ww, wh] = [40, 32, 1120, 576];
  const dir = "~/.gentle-shell/agent/profiles/work/claude";
  const size = 18;
  const blocks: Array<[string, string[]]> = [
    ["/gentle:accounts list", ["  default", "* work"]],
    ["/gentle:accounts work", [`Switched to profile "work". Claude Code dir: ${dir}`]],
    ["/gentle:accounts current", [`Active profile: work (CLAUDE_CONFIG_DIR=${dir})`]],
  ];
  const body = [windowFrame(x, y, ww, wh, "gentle-shell")];
  let ly = y + 86;
  for (const [cmd, out] of blocks) {
    body.push(line(x + 24, ly, [{ text: "> ", color: C.muted }, { text: cmd, color: C.accent, bold: true }], size));
    ly += 30;
    for (const o of out) {
      body.push(line(x + 44, ly, o, size, C.text));
      ly += 28;
    }
    ly += 34;
  }
  body.push(statusBar(x, y + wh - 52, ww, 20));
  return svg(w, h, "Switching profiles with /gentle:accounts", `Listing profiles, switching to "work" and checking the active profile. ${NOT_SCREENSHOT}`, body);
}

function workflowLogin(): string {
  const panels: Array<[string, string, NodeJS.Platform]> = [
    ["macOS / Linux", "/Users/you/.gentle-shell/agent/profiles/work/claude", "darwin"],
    ["Windows (PowerShell)", "C:\\Users\\you\\.gentle-shell\\agent\\profiles\\work\\claude", "win32"],
  ];
  const hints = panels.map(([, dir, p]) => loginHint("work", claudeLoginCommand(dir, p), p).split("\n"));
  const longest = Math.max(...hints.flat().map((l) => l.length));
  const w = 1280;
  const pw = w - 64;
  // Font size chosen so the longest line fits with 16 px padding on each side.
  const size = Math.min(16, Math.floor(((pw - 32) / (longest * CHAR)) * 10) / 10);
  const lh = size * 1.6;
  const ph = 40 + 20 + hints[0].length * lh + 10;
  const h = Math.ceil(32 + 2 * ph + 24 + 32);
  const body: string[] = [];
  panels.forEach(([title, , p], i) => {
    const x = 32;
    const y = 32 + i * (ph + 24);
    body.push(windowFrame(x, y, pw, ph, title));
    let ly = y + 40 + 20 + size;
    for (const l of hints[i]) {
      const isCmd = l.startsWith(p === "win32" ? "  PS> " : "  $ ");
      if (isCmd) body.push(highlight(x + 10, ly, pw - 20, size));
      if (l) body.push(line(x + 16, ly, l, size, isCmd ? C.text : C.muted));
      ly += lh;
    }
  });
  return svg(w, h, "Logging a profile into Claude Code", `The login hint for macOS/Linux and Windows with the command line highlighted. ${NOT_SCREENSHOT}`, body);
}

function box(x: number, y: number, w: number, h: number, title: string, items: Array<[string, string?]>, stroke = C.border): string {
  const out = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.surface}" stroke="${stroke}" stroke-width="2"/>`,
    line(x + 16, y + 30, [{ text: title, color: C.accent, bold: true }], 17),
  ];
  items.forEach(([t, color], i) => out.push(line(x + 24, y + 62 + i * 26, t, 15, color ?? C.text)));
  return out.join("\n");
}

/** Label rotated along the arrow, centered on its midpoint and lifted clear of the line. */
function arrowLabel(x1: number, y1: number, x2: number, y2: number, label: string, color: string): string {
  let deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  const rad = (deg * Math.PI) / 180;
  const off = 12; // gap between the line and the text baseline
  const x = (x1 + x2) / 2 + Math.sin(rad) * off;
  const y = (y1 + y2) / 2 - Math.cos(rad) * off;
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle" font-family="${MONO}" font-size="14" fill="${color}">${esc(label)}</text>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, label: string, color: string): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const p = (d: number, a: number) => `${(x2 - d * Math.cos(ang + a)).toFixed(1)},${(y2 - d * Math.sin(ang + a)).toFixed(1)}`;
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3"/>`,
    `<polygon points="${x2},${y2} ${p(14, 0.4)} ${p(14, -0.4)}" fill="${color}"/>`,
    arrowLabel(x1, y1, x2, y2, label, color),
  ].join("\n");
}

function howItWorks(): string {
  const body = [
    box(40, 150, 300, 160, "pi auth.json (live)", [["openai-codex"], ["anthropic"], ["other providers (untouched)", C.muted]]),
    box(470, 50, 300, 210, "profiles/default/", [["auth.json"], ["claude-default", C.yellow], ["CLAUDE_CONFIG_DIR unset", C.muted]]),
    box(470, 330, 300, 140, "profiles/work/", [["auth.json"], ["claude/"]], C.accent),
    box(880, 340, 280, 120, "claude-bridge", [["CLAUDE_CONFIG_DIR=", C.muted], ["profiles/work/claude", C.green]]),
    arrow(340, 200, 470, 150, "save outgoing", C.soft),
    arrow(470, 400, 340, 270, "load incoming", C.green),
    arrow(770, 400, 880, 400, "sets env", C.accent),
    `<text x="600" y="560" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.muted}">Switching default → work: credentials are saved to the outgoing profile and loaded from the incoming one.</text>`,
  ];
  return svg(1200, 640, "How gentle-accounts swaps credentials", `pi auth.json entries are saved to the outgoing profile and loaded from the incoming one; claude-bridge gets CLAUDE_CONFIG_DIR. ${NOT_SCREENSHOT}`, body);
}

/** 1280x640 card for GitHub's social preview (Settings > Social preview): only the README mark, centered. */
function socialPreview(): string {
  const [w, h] = [1280, 640];
  const scale = 2.2; // the mark is 256x256
  const size = 256 * scale;
  return svg(w, h, "gentle-accounts", `Social preview: the gentle-accounts mark (two overlapping account avatars with a switch arrow) on the Gentle Shell palette. ${NOT_SCREENSHOT}`, [
    `<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${scale})">`, ...markBody(), `</g>`,
  ]);
}

export function renderAssets(): Record<string, string> {
  return {
    "logo.svg": logo(),
    "logo-mark.svg": logoMark(),
    "social-preview.svg": socialPreview(),
    "hero-status-bar.svg": hero(),
    "workflow-switch.svg": workflowSwitch(),
    "workflow-login.svg": workflowLogin(),
    "how-it-works.svg": howItWorks(),
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(self)) {
  const outDir = join(dirname(self), "..", "assets");
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(renderAssets())) writeFileSync(join(outDir, name), text);
}
