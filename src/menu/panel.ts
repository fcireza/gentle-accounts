import { decodeKey } from "./keys.ts";
import { renderMenu, type MenuModel, type MenuTheme } from "./view.ts";

/** Tagged result of one panel opening; `profile`/`row` let the caller reopen on the same selection. */
export type MenuAction =
  | { type: "switch"; profile: string; row: number }
  | { type: "login"; profile: string; provider: string; row: number }
  | { type: "create"; profile?: string; row: number }
  | { type: "delete"; profile: string; row: number }
  | { type: "startup"; profile: string; row: number }
  | { type: "email"; profile?: string; row: number }
  | { type: "open"; profile: string; row: number }
  | { type: "close" };

export interface PanelOptions {
  requestRender?: () => void;
}

/**
 * Overlay component of the accounts menu. The profile list wraps around with up/down; right expands the
 * selected profile's providers (rows 1..n, clamped), left collapses back to the profile row (0). Every action ends the panel
 * through `done` exactly once; the caller loop executes it and reopens the panel.
 */
export class AccountsMenuPanel {
  private readonly model: MenuModel;
  private readonly theme: MenuTheme;
  private readonly done: (action: MenuAction) => void;
  private readonly options: PanelOptions;
  private selected: number;
  private row: number;
  private finished = false;
  private cache: { width: number; lines: string[] } | undefined;

  constructor(model: MenuModel, theme: MenuTheme, done: (action: MenuAction) => void, options: PanelOptions = {}) {
    this.model = model;
    this.theme = theme;
    this.done = done;
    this.options = options;
    this.selected = model.selected;
    this.row = model.row;
  }

  render(width: number): string[] {
    if (this.cache && this.cache.width === width) return this.cache.lines;
    const lines = renderMenu({ ...this.model, selected: this.selected, row: this.row }, width, this.theme);
    this.cache = { width, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private rowCount(): number {
    const profile = this.model.profiles[this.selected];
    return profile ? profile.providers.length + 1 : 1;
  }

  private finish(action: MenuAction): void {
    if (this.finished) return;
    this.finished = true;
    this.done(action);
  }

  private moveProfile(delta: number): void {
    const count = this.model.profiles.length;
    if (count < 2) return;
    this.selected = (this.selected + delta + count) % count;
  }

  private moveRow(delta: number): void {
    this.row = Math.min(Math.max(1, this.row + delta), this.rowCount() - 1);
  }

  handleInput(data: string): void {
    if (this.finished) return;
    const key = decodeKey(data);
    if (!key) return;
    const profile = this.model.profiles[this.selected];
    const name = profile?.name;
    const row = this.row;
    switch (key) {
      case "escape":
      case "ctrl+c":
        return this.finish({ type: "close" });
      case "left":
      case "char:h":
        if (this.row === 0) return;
        this.row = 0;
        break;
      case "right":
      case "char:l":
        if (this.row > 0 || !profile?.providers.length) return;
        this.row = 1;
        break;
      case "up":
      case "char:k":
        if (this.row === 0) this.moveProfile(-1);
        else this.moveRow(-1);
        break;
      case "down":
      case "char:j":
        if (this.row === 0) this.moveProfile(1);
        else this.moveRow(1);
        break;
      case "enter":
        if (!profile || !name) return;
        if (row === 0) return this.finish({ type: "switch", profile: name, row });
        return this.finish({ type: "login", profile: name, provider: profile.providers[row - 1].provider, row });
      case "char:n":
        return this.finish(name ? { type: "create", profile: name, row } : { type: "create", row });
      case "char:e":
        return this.finish(name ? { type: "email", profile: name, row } : { type: "email", row });
      case "char:d":
        if (name) return this.finish({ type: "delete", profile: name, row });
        return;
      case "char:s":
        if (name) return this.finish({ type: "startup", profile: name, row });
        return;
      case "char:o":
        // Only on a logged-in provider row, as the key hint says.
        if (name && row > 0 && profile?.providers[row - 1]?.loggedIn) return this.finish({ type: "open", profile: name, row });
        return;
      default:
        return;
    }
    this.invalidate();
    this.options.requestRender?.();
  }
}
