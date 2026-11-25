import { decodeKey, type MenuKey } from "./keys.ts";
import { canOpenProject, menuHits, menuSpans, renderMenu, type MenuModel, type MenuTheme } from "./view.ts";

/** Tagged result of one panel opening; `profile`/`row` let the caller reopen on the same selection. */
export type MenuAction =
  | { type: "switch"; profile: string; row: number }
  | { type: "login"; profile: string; provider: string; row: number }
  | { type: "create"; profile?: string; row: number }
  | { type: "delete"; profile: string; row: number }
  | { type: "rename"; profile: string; row: number }
  | { type: "startup"; profile: string; row: number }
  | { type: "use"; profile: string; row: number }
  | { type: "email"; profile?: string; row: number }
  | { type: "usage"; profile?: string; row: number }
  | { type: "open"; profile: string; row: number }
  | { type: "adopt"; row: number }
  | { type: "logout"; profile: string; provider: string; row: number }
  | { type: "close" };

/**
 * The part of pi-tui's `TuiMouseEvent` the panel reads (declared here because pi-tui is not resolvable from this
 * package under tests). pi only delivers mouse events in fullscreen mode; coordinates are local to the panel.
 */
export interface PanelMouseEvent {
  type: string;
  button: string;
  x: number;
  y: number;
  width: number;
  wheelDelta?: number;
  clickCount?: number;
}

export interface PanelMouseResult {
  handled?: boolean;
  render?: boolean;
}

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
  /** The key hint under the pointer, drawn lit. */
  private hover: string | undefined;
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
    const lines = renderMenu({ ...this.model, selected: this.selected, row: this.row, hover: this.hover }, width, this.theme);
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

  /** Up or down: profiles on the profile row, providers while they are open. */
  private step(delta: number): void {
    if (this.row === 0) this.moveProfile(delta);
    else this.moveRow(delta);
  }

  /** Enter: switch on a profile, log in on a provider. */
  private activate(): void {
    const profile = this.model.profiles[this.selected];
    if (!profile) return;
    if (this.row === 0) return this.finish({ type: "switch", profile: profile.name, row: this.row });
    return this.finish({ type: "login", profile: profile.name, provider: profile.providers[this.row - 1].provider, row: this.row });
  }

  /**
   * Fullscreen mouse: moving the pointer over a row highlights it, a left click selects the profile or provider under the pointer, a double click acts like
   * Enter, the wheel moves like up and down. Anything else on the panel is swallowed; the keyboard keeps working.
   */
  handleMouse(event: PanelMouseEvent): PanelMouseResult | undefined {
    if (this.finished) return undefined;
    if (event.type === "wheel") {
      if (!event.wheelDelta) return undefined;
      this.step(event.wheelDelta < 0 ? -1 : 1);
      this.invalidate();
      return { handled: true };
    }
    // Hover: resting the pointer on a row highlights it (the selection), so a click lands on what is lit.
    if (event.type === "move") {
      // A key hint under the pointer lights up (it is what a click would press); leaving it puts the dim style back.
      const over = menuSpans(this.model, event.width).find((s) => s.line === event.y && event.x >= s.from && event.x < s.to && "key" in s.target);
      const hover = over && "key" in over.target ? over.target.key : undefined;
      if (hover !== this.hover) {
        this.hover = hover;
        this.invalidate();
        return { handled: true, render: true };
      }
      if (event.x < 2 || event.x > event.width - 3) return { handled: true, render: false };
      const hit = menuHits({ ...this.model, selected: this.selected, row: this.row }, event.width)[event.y];
      // While the providers are open, other profiles are not hovered: selecting one would close them and shift
      // the rows under the pointer. The mouse selects them with a click, as before.
      if (!hit || (hit.profile === this.selected && hit.row === this.row) || (this.row > 0 && hit.profile !== this.selected)) return { handled: true, render: false };
      this.selected = hit.profile;
      this.row = hit.row;
      this.invalidate();
      // pi redraws only when the handler asks for it (like gentle-pi's own hover): without `render` the lit row never shows.
      return { handled: true, render: true };
    }
    // pi only synthesizes the click on release when the press was handled by the same component: an unhandled
    // press starts a text selection in the chat instead, and no click ever arrives.
    if (event.type === "press" && event.button === "left") return { handled: true, render: false };
    if (event.type !== "click" || event.button !== "left") return undefined;
    // The frame and its padding (two cells on each side) are not rows: swallow the click without selecting.
    if (event.x < 2 || event.x > event.width - 3) return { handled: true };
    const current = { ...this.model, selected: this.selected, row: this.row };
    const span = menuSpans(current, event.width).find((s) => s.line === event.y && event.x >= s.from && event.x < s.to);
    if (span) {
      if ("key" in span.target) this.press(span.target.key as MenuKey);
      else {
        this.selected = span.target.profile;
        this.row = 0;
        this.invalidate();
      }
      return { handled: true, render: true };
    }
    const hit = menuHits(current, event.width)[event.y];
    if (!hit) return { handled: true };
    // A double click acts only on what the first click already selected. The first click can move the layout (it
    // closes the providers of the previously selected profile), so the same cell may now be another row: select it.
    const sameRow = hit.profile === this.selected && hit.row === this.row;
    this.selected = hit.profile;
    this.row = hit.row;
    this.invalidate();
    if ((event.clickCount ?? 1) >= 2 && sameRow) this.activate();
    return { handled: true };
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
    if (key) this.press(key);
  }

  /** One key press (typed, or the one a clicked hint stands for). */
  private press(key: MenuKey): void {
    if (this.finished) return;
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
        this.step(-1);
        break;
      case "down":
      case "char:j":
        this.step(1);
        break;
      case "enter":
        return this.activate();
      case "char:n":
        return this.finish(name ? { type: "create", profile: name, row } : { type: "create", row });
      case "char:e":
        return this.finish(name ? { type: "email", profile: name, row } : { type: "email", row });
      case "char:g":
        // Only while the usage box is enabled, as the hint says.
        if (this.model.usageBox === true) return this.finish(name ? { type: "usage", profile: name, row } : { type: "usage", row });
        return;
      case "char:d":
        if (name) return this.finish({ type: "delete", profile: name, row });
        return;
      case "char:u":
        if (name) return this.finish({ type: "use", profile: name, row });
        return;
      case "char:f":
        if (name) return this.finish({ type: "startup", profile: name, row });
        return;
      case "char:r":
        if (name) return this.finish({ type: "rename", profile: name, row });
        return;
      case "char:i":
        // Only while a login is detected, as the hint says.
        if ((this.model.detected ?? []).length) return this.finish({ type: "adopt", row });
        return;
      case "char:x": {
        // Only on a logged-in provider row, as the key hint says.
        const provider = this.model.profiles[this.selected]?.providers[row - 1];
        if (name && provider && canOpenProject({ profiles: this.model.profiles, selected: this.selected, row })) return this.finish({ type: "logout", profile: name, provider: provider.provider, row });
        return;
      }
      case "char:o":
        // Only on a logged-in provider row, as the key hint says.
        if (name && canOpenProject({ profiles: this.model.profiles, selected: this.selected, row })) return this.finish({ type: "open", profile: name, row });
        return;
      default:
        return;
    }
    this.invalidate();
    this.options.requestRender?.();
  }
}
