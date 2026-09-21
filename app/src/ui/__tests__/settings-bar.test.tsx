import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsBar, barIndex, effectiveTarget, kept, previewItem, previewState } from "../SettingsBar";
import { BarStrip, clipText, shapeItem, type BarLook, type BarStripItem } from "../BarStrip";
import { lookDefaults, resolveLook, type BarConfig, type BarItemConfig } from "../SettingsTypes";
import { barItems, quietItem } from "./settings-fixtures";

const noop = () => {};
const config: BarConfig = { target: "auto", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: true, sketchybarPosition: "right", menubar: { ...lookDefaults }, sketchybar: { ...lookDefaults, spacing: 6 } };
const page = (props: Partial<Parameters<typeof SettingsBar>[0]> = {}) => renderToStaticMarkup(<SettingsBar config={config} onChange={noop} items={barItems} onItem={noop} sketchybar={false} {...props} />);

describe("SettingsBar", () => {
  it("has a Defaults card: the target explained against what is running, the peeks, the position", () => {
    expect(page()).toContain("sketchybar is not running, so items go to the menu bar.");
    expect(page({ sketchybar: true })).toContain("sketchybar is running, so items go there.");
    expect(page({ config: { ...config, target: "off" } })).toContain("No item anywhere; the timers stop too.");
    expect(page({ config: { ...config, target: "sketchybar" }, sketchybar: false })).toContain("nothing shows until it does");
    const html = page();
    expect(html).toContain('data-anchor="bar:target"');
    expect(html).toContain('aria-label="Hover delay" value="250"');
    expect(html).toContain('aria-label="Hover grace" value="400"');
    expect(html).toContain('aria-label="Menu bar opens on hover" class="pal-switch"');
    expect(html).toContain('aria-label="sketchybar opens on hover" class="pal-switch"');
    expect(html).toContain('id="pal-bar-position"');
  });
  it("shows one target's appearance defaults in four groups, each field with its key and description", () => {
    const html = page();
    for (const g of ["Placement", "Text", "Colour", "Behaviour"]) expect(html).toContain(`>${g}</legend>`);
    // The menu bar's defaults are shown first (sketchybar is not running); every field carries its file key and an anchor.
    for (const k of ["spacing", "width", "font", "size", "icon_size", "text_size", "max_chars", "show_icon", "show_title", "color", "urgent_color", "badge_color", "opacity", "dim", "badge_style"]) {
      expect(html).toContain(`data-anchor="bar:menubar:${k}"`);
    }
    // A custom icon is an item's own: no target-wide default, so no field here.
    expect(html).not.toContain('data-anchor="bar:menubar:icon"');
    expect(barIndex(barItems).some((e) => e.anchor === "bar:menubar:icon")).toBe(false);
    expect(barIndex(barItems).some((e) => e.anchor === "bar:github/notifications:icon")).toBe(true);
    // Only a key you could not have guessed from the label earns a chip: "Spacing" does not print `spacing`.
    for (const k of ["max_chars", "show_icon", "show_title", "color", "urgent_color", "badge_color", "badge_style"]) expect(html).toContain(`<code class="pal-bar-field__key">${k}</code>`);
    for (const k of ["spacing", "width", "font", "size", "icon_size", "text_size", "opacity", "dim"]) expect(html).not.toContain(`<code class="pal-bar-field__key">${k}</code>`);
    expect(html).toContain('aria-label="Opacity (menu bar)" value="100"');
    expect(html).toContain('placeholder="the item&#x27;s"');
    expect(html).toContain("Points between the icon, the title and the segments.");
    expect(html).toContain("Apple sets the gap otherwise.");
    expect(html).toContain('aria-label="Dim (menu bar)" value="50"');
    expect(html).toContain('aria-label="Spacing (menu bar)" value="4"');
    // sketchybar's when it is the one running.
    const sb = page({ sketchybar: true });
    expect(sb).toContain('data-anchor="bar:sketchybar:spacing"');
    expect(sb).toContain('aria-label="Spacing (sketchybar)" value="6"');
    expect(sb).toContain("Mono is Menlo.");
  });
  it("lists the defaults row and then every item, each with only the state worth a tag", () => {
    const html = page();
    // The pinned Defaults and Sidebar rows and the three items, in the shared list; the rule sits under the sidebar's.
    expect(html.match(/data-item=/g)?.length).toBe(5);
    expect(html).toContain('data-item="__defaults__" data-anchor="bar:defaults" data-active="true"');
    expect(html).toContain('data-item="__sidebar__" data-anchor="bar:sidebar" data-dim="true" data-divider="true"');
    expect(html).toContain('data-anchor="bar:github/notifications"');
    expect(html).toContain('<span class="pal-settings-list__sub">GitHub</span>');
    // A healthy item wears nothing; only what is off, stale or missing gets a tag.
    expect(html).toContain(">stale</span>");
    expect(html).toContain(">no code</span>");
    expect(html).toContain('data-item="docker/containers" data-anchor="bar:docker/containers" data-dim="true"');
    // The switch and the target moved into the pane, so a row carries neither.
    expect(html).not.toContain('aria-label="Notifications enabled"');
    expect(html).not.toContain('aria-label="Running timers target"');
  });
  it("opens a selected item's pane: description, preview in both themes, placement, popover, Reset", () => {
    const html = page({ selected: "github/notifications" });
    expect(html).toContain('data-item="github/notifications" data-anchor="bar:github/notifications" data-active="true"');
    expect(html).toContain("badge 3, every 5 min, rendered 2m ago.");
    expect(html).toContain('aria-label="Notifications enabled"');
    expect(html).toContain("The unread count as a badge, hidden at zero.");
    expect(html).toContain("the last render, as the strip draws it");
    expect(html.match(/class="g-bar" data-theme="dark" data-target="menubar"/g)?.length).toBe(1);
    expect(html.match(/class="g-bar" data-theme="light" data-target="menubar"/g)?.length).toBe(1);
    expect(html).toContain("menu bar, dark");
    expect(html).toContain('class="g-mb__count" style="background:currentColor">3</span>');
    // The item's pane has the custom icon field, the extension's own icon as its placeholder.
    expect(html).toContain('data-inherited="true" data-anchor="bar:github/notifications:icon"');
    expect(html).toMatch(/id="bar:github\/notifications-icon"[^>]*placeholder="\u{f09b}"/u);
    expect(html).toContain('data-anchor="bar:github/notifications:show"');
    expect(html).toContain("The default: off the strip while the extension has nothing to say. This item offers no quiet shape yet, so it hides either way.");
    expect(html).toContain('data-anchor="bar:github/notifications:target"');
    expect(html).toContain('data-anchor="bar:github/notifications:order"');
    expect(html).toContain('data-anchor="bar:github/notifications:hotkey"');
    expect(html).toContain('data-anchor="bar:github/notifications:open_on_hover"');
    expect(html).toContain("The default: off on the menu bar.");
    expect(html).toContain(">Reset to defaults</button>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reset to defaults<\/button>/);
  });
  it("show = always keeps a hidden item's empty shape on the preview strip, muted, and the state line and the row say so", () => {
    const html = page({ items: [...barItems, quietItem], selected: "gmail/unread" });
    expect(html).toContain("nothing to say, kept on the strip muted, every 2 min, rendered 1m ago.");
    expect(html).toContain("Kept on the strip with nothing to say: the glyph alone, muted, the same popover.");
    expect(html).not.toContain("This item offers no quiet shape yet");
    expect(html).not.toContain(">hidden</span>");
    expect(html).toContain("the last render, as the strip draws it");
    expect(html).not.toContain(", hidden now");
    expect(html).toMatch(/<button[^>]*(?<!disabled="")>Reset to defaults<\/button>/);
    // The default hides it: the row wears the tag and the preview falls back to the first visible mock.
    const auto = page({ items: [...barItems, { ...quietItem, config: { enabled: true, look: {} } }], selected: "gmail/unread" });
    expect(auto).toContain(">hidden</span>");
    expect(auto).toContain("hidden by the extension, every 2 min");
    expect(auto).toContain("3 unread");
    expect(kept(quietItem.state!, "always")).toEqual({ hidden: false, urgent: false, icon: "\u{f01ee}", title: undefined, tooltip: "No unread mail", color: "muted" });
    expect(kept(quietItem.state!, undefined)).toBe(quietItem.state);
    expect(kept({ hidden: true, urgent: false }, "always").hidden).toBe(true);
    expect(kept(barItems[0].state!, "always")).toBe(barItems[0].state);
    expect(previewState(quietItem.state, "Unread", false, "always")).toMatchObject({ hidden: false, icon: "\u{f01ee}", color: "muted", tooltip: "No unread mail" });
    expect(previewState(quietItem.state, "Unread", false, "auto").hidden).toBe(true);
  });
  it("marks inherited appearance fields with the target they come from and offers Reset on an overridden one", () => {
    const html = page({ selected: "timer/running" });
    expect(html).toContain('data-item="timer/running" data-anchor="bar:timer/running" data-active="true"');
    // The overrides are folded away, and the fold says how many and over which default.
    expect(html).toContain(">Override defaults</span>");
    expect(html).toContain('<span class="pal-disclosure__count">2</span>');
    // Two keys are set, so the fold is open on arrival: a departure from the defaults is never hidden by it.
    expect(html).toMatch(/<details class="pal-disclosure" open=""/);
    // Nothing set, and it stays shut.
    expect(page({ selected: "github/notifications" })).toMatch(/<details class="pal-disclosure"(?! open)/);
    expect(page({ selected: "github/notifications" })).toContain("all from the menu bar default");
    expect(html).toContain("over the sketchybar default");
    expect(html).toMatch(/data-inherited="true" data-anchor="bar:timer\/running:spacing"/);
    expect(html).toContain('aria-label="Spacing (sketchybar)" value="6"');
    expect(html.match(/from the sketchybar default/g)?.length).toBe(14);
    expect(html).not.toMatch(/data-inherited="true" data-anchor="bar:timer\/running:font"/);
    expect(html).toMatch(/data-anchor="bar:timer\/running:font"[\s\S]*?title="Back to the sketchybar default">Reset<\/button>/);
    expect(html).toMatch(/id="bar:timer\/running-position"[^>]*value="left"/);
    expect(html).toContain('aria-label="Running timers hotkey: ctrl+alt+t"');
    expect(html).toContain("This item&#x27;s own say.");
    expect(html.match(/class="g-bar" data-theme="dark" data-target="sketchybar"/g)?.length).toBe(1);
    expect(html).toContain("Menlo, ui-monospace, monospace");
    expect(html).toContain("sketchybar, dark");
    expect(html).not.toContain("menu bar, dark");
    expect(html).toContain('aria-label="Preview state"');
    expect(html).toContain("Timer finished");
    expect(html).toContain("Settings only; this never changes the live bar.");
  });
  it("writes a changed item key through onItem and an appearance default through onChange", () => {
    // The page's handlers are exercised by shape: the pane's put merges a patch over the config, the Defaults card's setLook over the target's look.
    const item: BarItemConfig = { enabled: true, look: { font: "mono" } };
    expect(resolveLook(config.sketchybar, item.look)).toEqual({ ...lookDefaults, spacing: 6, font: "mono" });
    expect(resolveLook(config.menubar, {})).toEqual(lookDefaults);
    expect(shapeItem({ icon: "x", title: "t", badge: 4 }, { ...lookDefaults, badgeStyle: "dot" }).badge).toBe("dot");
    expect(shapeItem({ icon: "x", title: "t", badge: 4 }, { ...lookDefaults, badgeStyle: "none", showTitle: false }).hidden).toBeUndefined();
    expect(shapeItem({ title: "t" }, { ...lookDefaults, showTitle: false }).hidden).toBe(true);
    expect(shapeItem({ icon: "x", color: "muted" }, { ...lookDefaults, color: "blue" }).color).toBe("muted");
    expect(shapeItem({ icon: "x", title: "t" }, { ...lookDefaults, icon: "🔔" }).icon).toBe("🔔");
    expect(shapeItem({ icon: "x", title: "t" }, { ...lookDefaults, icon: "🔔", showIcon: false }).icon).toBeUndefined();
    expect(shapeItem({ icon: "x" }, { ...lookDefaults, icon: "  " }).icon).toBe("x");
    expect(clipText("With a coat that smells of rain and the radio playing", 32)).toBe("With a coat that smells of rain…");
    expect(previewItem(barItems[1])).toMatchObject({ icon: "\u{f0954}", title: "tea 12:00", progress: 0.4, color: "amber", stale: true });
    expect(previewState(barItems[1].mocks?.[0].item, barItems[1].title)).toMatchObject({ icon: "\u{f0954}", title: "tea done", urgent: true, color: "red" });
    expect(previewItem(barItems[2])).toMatchObject({ title: "Containers" });
    expect(effectiveTarget(barItems[0], config, false)).toBe("menubar");
    expect(effectiveTarget(barItems[0], config, true)).toBe("sketchybar");
    expect(effectiveTarget(barItems[1], config, false)).toBe("sketchybar");
    expect(effectiveTarget(barItems[0], { ...config, target: "both" }, false)).toBe("both");
  });
  it("draws the badge in the item's colour unless the look says, fades at opacity, and sizes the glyph and the text apart", () => {
    const strip = (item: BarStripItem, look: Partial<BarLook>, target: "menubar" | "sketchybar" = "menubar") => renderToStaticMarkup(<BarStrip items={[item]} target={target} theme="dark" look={{ ...lookDefaults, ...look }} bare />);
    // Menu bar: the dot and the count ride the ink; a badge colour is their own.
    expect(strip({ icon: "\u{f09b}", badge: "dot" }, {})).toContain('class="g-mb__dot" style="background:currentColor"');
    expect(strip({ icon: "\u{f09b}", badge: "dot", color: "green" }, {})).toContain('class="g-mb__dot" style="background:var(--pal-tag-green)"');
    expect(strip({ icon: "\u{f09b}", badge: 3 }, { badgeColor: "red" })).toContain('class="g-mb__count" style="background:var(--pal-tag-red)"');
    expect(strip({ icon: "\u{f09b}", badge: "dot", stale: true }, { badgeColor: "red" })).toContain('class="g-mb__dot" style="background:currentColor"');
    expect(strip({ icon: "\u{f09b}", title: "x" }, { opacity: 40 })).toMatch(/class="g-mb__item g-mb__pal"[^>]*style="opacity:0\.4"/);
    expect(strip({ icon: "\u{f09b}", title: "x" }, { size: 12, iconSize: 16, textSize: 9 })).toContain("font-size:18px");
    expect(strip({ icon: "\u{f09b}", title: "x" }, { size: 12, iconSize: 16, textSize: 9 })).toContain("font-size:9px");
    // sketchybar: the same rules on the map's colours.
    expect(strip({ icon: "\u{f09b}", badge: 3, color: "green" }, {}, "sketchybar")).toContain('<span style="color:#a6d189">3</span>');
    expect(strip({ icon: "\u{f09b}", badge: 3, color: "green" }, { badgeColor: "red" }, "sketchybar")).toContain('<span style="color:#e78284">3</span>');
    expect(strip({ icon: "\u{f09b}", badge: "dot" }, { badgeColor: "#ff8800" }, "sketchybar")).toContain("color:#ff8800");
    expect(strip({ icon: "\u{f09b}", title: "x" }, { opacity: 50 }, "sketchybar")).toMatch(/class="g-sb__group" style="opacity:0\.5"/);
    expect(strip({ icon: "\u{f09b}", title: "x" }, { textSize: 9 }, "sketchybar")).toContain("font-size:9px");
    expect(strip({ icon: "\u{f09b}", title: "x" }, { textSize: 9 }, "sketchybar")).not.toContain("font-size:10px");
  });
  it("has an empty state and an index with an anchor for every field", () => {
    expect(page({ items: [] })).toContain("No bar items");
    expect(page({ items: [] })).toContain("nothing inherits the defaults above");
    const idx = barIndex(barItems);
    expect(idx.find((e) => e.anchor === "bar:target")).toBeTruthy();
    expect(idx.find((e) => e.anchor === "bar:menubar:dim")?.label).toBe("Dim (menu bar)");
    expect(idx.find((e) => e.anchor === "bar:sketchybar:badge_style")).toBeTruthy();
    expect(idx.find((e) => e.label === "Timer › Running timers")?.anchor).toBe("bar:timer/running");
    expect(idx.find((e) => e.anchor === "bar:timer/running:width")?.label).toBe("Running timers: Width");
    expect(idx.find((e) => e.anchor === "bar:timer/running:hotkey")).toBeTruthy();
    expect(idx.find((e) => e.anchor === "bar:timer/running:show")?.label).toBe("Running timers: show");
  });
  it("says not on Linux yet where the platform draws nothing, with no list and no index", () => {
    const html = page({ supported: false });
    expect(html).toContain("Not on Linux yet");
    expect(html).toContain("3 declared by extensions, none rendered.");
    expect(html).not.toContain("data-bar-row=");
    expect(html).not.toContain('id="pal-bar-target"');
    expect(barIndex(barItems, false)).toEqual([]);
  });
});
