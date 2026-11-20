/** Terminal-cell width helpers for the menu renderer (pi-tui's are not resolvable from this package under tests). */

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
