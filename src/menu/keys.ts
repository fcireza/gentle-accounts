/**
 * Minimal key decoding for the accounts menu. pi-tui's `matchesKey` is only reachable through pi's
 * loader alias (it is not resolvable from this package under tests), so the few keys the panel needs are
 * decoded here: legacy xterm sequences and the kitty keyboard protocol (CSI-u and CSI 1;mod letter).
 */

export type MenuKey = "left" | "right" | "up" | "down" | "enter" | "escape" | "ctrl+c" | `char:${string}`;

const LEGACY: Record<string, MenuKey> = {
  "\x1b[D": "left",
  "\x1bOD": "left",
  "\x1b[C": "right",
  "\x1bOC": "right",
  "\x1b[A": "up",
  "\x1bOA": "up",
  "\x1b[B": "down",
  "\x1bOB": "down",
  "\r": "enter",
  "\n": "enter",
  "\x1bOM": "enter",
  "\x1b": "escape",
  "\x03": "ctrl+c",
};

const ARROWS: Record<string, MenuKey> = { A: "up", B: "down", C: "right", D: "left" };

/** Kitty protocol event type 3 is a key release (`CSI code;mods:3 u` or `CSI 1;mods:3 A`). */
export function isKeyRelease(data: string): boolean {
  return /^\x1b\[\d+(?::\d+)*;\d+:3[uABCD~]$/.test(data);
}

/** Decodes one key press; undefined for releases, modified keys the menu does not use, and unknown input. */
export function decodeKey(data: string): MenuKey | undefined {
  if (isKeyRelease(data)) return undefined;
  const legacy = LEGACY[data];
  if (legacy) return legacy;
  const arrow = /^\x1b\[1;(\d+)(?::[12])?([ABCD])$/.exec(data);
  if (arrow) return arrow[1] === "1" ? ARROWS[arrow[2]] : undefined;
  const csiU = /^\x1b\[(\d+)(?::\d+)*(?:;(\d+)(?::[12])?)?u$/.exec(data);
  if (csiU) {
    const code = Number(csiU[1]);
    const mods = csiU[2] ? Number(csiU[2]) - 1 : 0;
    const ctrl = (mods & 4) !== 0;
    // Shift (1) and lock bits (64, 128) do not change the meaning of the keys the menu uses.
    const other = mods & ~(1 | 4 | 64 | 128);
    if (other) return undefined;
    if (ctrl) return code === 99 ? "ctrl+c" : undefined;
    if (code === 13 || code === 57414) return "enter";
    if (code === 27) return "escape";
    if (code >= 32 && code < 127) return `char:${String.fromCharCode(code).toLowerCase()}`;
    return undefined;
  }
  if (data.length === 1 && data >= " " && data < "\x7f") return `char:${data.toLowerCase()}`;
  return undefined;
}
