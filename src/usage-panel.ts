import { decodeKey } from "./menu/keys.ts";
import type { PanelMouseEvent, PanelMouseResult, PanelOptions } from "./menu/panel.ts";
import type { MenuTheme } from "./menu/model.ts";
import { renderUsageBox, usageSpans, type UsageBoxModel } from "./usage-view.ts";

/** Overlay component of the "Account Usage" box. It only reads: esc, enter, ctrl+c or a click on the esc hint close it. */
export class UsageBoxPanel {
  private readonly model: UsageBoxModel;
  private readonly theme: MenuTheme;
  private readonly done: () => void;
  private readonly options: PanelOptions;
  private hover: string | undefined;
  private finished = false;
  private cache: { width: number; lines: string[] } | undefined;

  constructor(model: UsageBoxModel, theme: MenuTheme, done: () => void, options: PanelOptions = {}) {
    this.model = model;
    this.theme = theme;
    this.done = done;
    this.options = options;
  }

  render(width: number): string[] {
    if (this.cache && this.cache.width === width) return this.cache.lines;
    const lines = renderUsageBox({ ...this.model, hover: this.hover }, width, this.theme);
    this.cache = { width, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.done();
  }

  handleInput(data: string): void {
    if (this.finished) return;
    const key = decodeKey(data);
    if (key === "escape" || key === "enter" || key === "ctrl+c") this.finish();
  }

  /** Hovering the esc hint lights it, a left click on it closes; everything else on the box is swallowed. */
  handleMouse(event: PanelMouseEvent): PanelMouseResult | undefined {
    if (this.finished) return undefined;
    const over = usageSpans(this.model, event.width).find((s) => s.line === event.y && event.x >= s.from && event.x < s.to);
    if (event.type === "move") {
      const hover = over?.action;
      if (hover === this.hover) return { handled: true, render: false };
      this.hover = hover;
      this.invalidate();
      this.options.requestRender?.();
      return { handled: true, render: true };
    }
    if (event.type === "press" && event.button === "left") return { handled: true, render: false };
    if (event.type !== "click" || event.button !== "left") return undefined;
    if (over) this.finish();
    return { handled: true };
  }
}
