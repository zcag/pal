import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsBar, barIndex } from "../SettingsBar";
import type { BarConfig } from "../SettingsTypes";
import { barItems } from "./settings-fixtures";

const noop = () => {};
const config: BarConfig = { target: "auto", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: true, sketchybarPosition: "right" };
const page = (props: Partial<Parameters<typeof SettingsBar>[0]> = {}) => renderToStaticMarkup(<SettingsBar config={config} onChange={noop} items={barItems} onItem={noop} sketchybar={false} {...props} />);

describe("SettingsBar", () => {
  it("explains the target against what is running", () => {
    expect(page()).toContain("sketchybar is not running, so items go to the menu bar.");
    expect(page({ sketchybar: true })).toContain("sketchybar is running, so items go there.");
    expect(page({ config: { ...config, target: "off" } })).toContain("No item anywhere; the timers stop too.");
    expect(page({ config: { ...config, target: "sketchybar" }, sketchybar: false })).toContain("nothing shows until it does");
  });
  it("has the timings, the per-target hover switches and the position", () => {
    const html = page();
    expect(html).toContain('aria-label="Hover delay" value="250"');
    expect(html).toContain('aria-label="Hover grace" value="400"');
    expect(html).toContain('aria-label="Menu bar opens on hover" class="pal-switch"');
    expect(html).toContain('aria-label="sketchybar opens on hover" class="pal-switch"');
    expect(html).toContain('id="pal-bar-position"');
  });
  it("lists every item as extension › item with its state under the name", () => {
    const html = page();
    expect(html.match(/data-bar-row=/g)?.length).toBe(3);
    for (const col of ["Item", "On", "Target", "Position", "Hotkey", "Hover", "Order"]) expect(html).toContain(`>${col}</span>`);
    expect(html).toContain('data-anchor="bar:github/notifications"');
    expect(html).toContain("GitHub › </span>Notifications");
    expect(html).toContain("badge 3, every 5 min, rendered 2m ago.");
    expect(html).toContain("Stale: the last render failed.");
    expect(html).toContain('data-stale="true"');
    expect(html).toContain("Declared, but the code has no render for it; never drawn.");
    expect(html).toContain('data-bar-row="docker/containers" data-anchor="bar:docker/containers" data-disabled="true"');
  });
  it("shows an item's own target, position, hotkey, hover and order", () => {
    const html = page();
    expect(html).toContain('aria-label="Running timers position" spellCheck="false" value="left"');
    expect(html).toContain('aria-label="Running timers order" placeholder="0" value="2"');
    expect(html).toContain('aria-label="Running timers hotkey: ctrl+alt+t"');
    expect(html).toMatch(/aria-label="Running timers target"[^>]*>(?:(?!<\/select>).)*<option value="sketchybar" selected="">/s);
    expect(html).toMatch(/aria-label="Running timers opens on hover"[^>]*>(?:(?!<\/select>).)*<option value="off" selected="">/s);
  });
  it("has an empty state and an index", () => {
    expect(page({ items: [] })).toContain("No bar items");
    const idx = barIndex(barItems);
    expect(idx.find((e) => e.anchor === "bar:target")).toBeTruthy();
    expect(idx.find((e) => e.label === "Timer › Running timers")?.anchor).toBe("bar:timer/running");
  });
});
