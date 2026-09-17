// @vitest-environment happy-dom
// Settings > Bar as used: an appearance default edited on the Defaults
// card reaches onChange under its target; a field edited in an item's
// pane reaches onItem as that item's override, Reset on it drops the key
// (back to the target's), the target select and the on switch on a row
// write the item, "Reset to defaults" leaves only on/off; and lookWrites
// turns a moved look into the file's keys, unsetting what is back at the
// base.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsBar } from "../SettingsBar";
import { lookDefaults, lookOf, lookWrites, type BarConfig, type BarItemConfig } from "../SettingsTypes";
import { barItems } from "./settings-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: BarConfig = { target: "auto", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: true, sketchybarPosition: "right", menubar: { ...lookDefaults }, sketchybar: { ...lookDefaults, spacing: 6 } };

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (props: Partial<Parameters<typeof SettingsBar>[0]>) => act(() => {
  root.render(<SettingsBar config={config} onChange={() => {}} items={barItems} onItem={() => {}} sketchybar={false} {...props} />);
});
const input = (label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const byId = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[id="${id}"]`)!;
const set = (i: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
  const proto = i instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(i, value);
  i.dispatchEvent(new Event(i instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
const click = (b: Element | null | undefined) => act(() => { (b as HTMLElement).click(); });

describe("SettingsBar writes", () => {
  it("edits an appearance default under its target", async () => {
    const changes: BarConfig[] = [];
    await show({ onChange: (c) => changes.push(c) });
    set(input("Dim (menu bar)"), "30");
    expect(changes.at(-1)?.menubar.dim).toBe(30);
    expect(changes.at(-1)?.sketchybar.dim, "the other target is untouched").toBe(50);
    set(byId<HTMLSelectElement>("bar:menubar-badge_style"), "dot");
    expect(changes.at(-1)?.menubar.badgeStyle).toBe("dot");
    click(el.querySelector('button[aria-label="Title (menu bar)"]'));
    expect(changes.at(-1)?.menubar.showTitle).toBe(false);
    set(byId<HTMLInputElement>("bar:menubar-color"), "#ff8800");
    expect(changes.at(-1)?.menubar.color).toBe("#ff8800");
    // The segmented switch shows sketchybar's defaults instead.
    click([...el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "sketchybar"));
    expect(input("Spacing (sketchybar)").value).toBe("6");
    set(input("Width (sketchybar)"), "90");
    expect(changes.at(-1)?.sketchybar.width).toBe(90);
  });
  it("edits an item's own keys in its pane and drops one with Reset", async () => {
    const writes: [string, BarItemConfig][] = [];
    await show({ onItem: (k, c) => writes.push([k, c]), selected: "timer/running" });
    // The timer's pane: spacing is inherited (6, sketchybar's), typing 10 makes it the item's own.
    const spacing = input("Spacing (sketchybar)");
    expect(spacing.closest("[data-inherited]")).not.toBeNull();
    set(spacing, "10");
    expect(writes.at(-1)).toEqual(["timer/running", { ...barItems[1].config, look: { font: "mono", width: 64, spacing: 10 } }]);
    // A value typed equal to the target's default is no override.
    set(input("Dim (sketchybar)"), "50");
    expect(writes.at(-1)?.[1].look.dim).toBeUndefined();
    set(input("Dim (sketchybar)"), "20");
    expect(writes.at(-1)?.[1].look.dim).toBe(20);
    // Reset on the overridden font: back to the target's.
    const font = el.querySelector('[data-anchor="bar:timer/running:font"]')!;
    click(font.querySelector("button.pal-setting__reset"));
    expect(writes.at(-1)?.[1].look).toEqual({ width: 64 });
    // The placement fields and the peek.
    set(byId<HTMLInputElement>("bar:timer/running-order"), "5");
    expect(writes.at(-1)?.[1].order).toBe(5);
    set(byId<HTMLSelectElement>("bar:timer/running-hover"), "");
    expect(writes.at(-1)?.[1].openOnHover).toBeUndefined();
    set(byId<HTMLSelectElement>("bar:timer/running-target"), "");
    expect(writes.at(-1)?.[1].target).toBeUndefined();
    // Reset to defaults keeps only on/off.
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Reset to defaults"));
    expect(writes.at(-1)).toEqual(["timer/running", { enabled: true, look: {} }]);
  });
  it("writes the on switch from the pane, and a list row selects what the pane shows", async () => {
    const writes: [string, BarItemConfig][] = [];
    const selected: string[] = [];
    await show({ selected: "github/notifications", onItem: (k, c) => writes.push([k, c]), onSelect: (k) => selected.push(k) });
    // The switch and the target are the pane's now, not a row's.
    click(el.querySelector('button[aria-label="Notifications enabled"]'));
    expect(writes.at(-1)).toEqual(["github/notifications", { enabled: false, look: {} }]);
    click(el.querySelector('[data-item="docker/containers"]'));
    expect(selected).toEqual(["docker/containers"]);
    await show({ selected: "docker/containers", onItem: (k, c) => writes.push([k, c]) });
    expect(el.querySelector('[data-item="docker/containers"]')?.getAttribute("data-active")).toBe("true");
    expect(el.querySelector(".pal-split__pane")?.textContent).toContain("the code has no render for it");
  });
  it("lands on the defaults, not on an item", async () => {
    await show({});
    expect(el.querySelector('[data-item="__defaults__"]')?.getAttribute("data-active")).toBe("true");
    expect(el.querySelector(".pal-split__pane")?.textContent).toContain("3 items inherit these");
  });
  it("turns a moved look into the file's keys, unsetting what is back at the base", () => {
    expect(lookWrites({}, { dim: 30, font: "mono" }, lookDefaults)).toEqual([["dim", 30], ["font", "mono"]]);
    expect(lookWrites({ dim: 30 }, { dim: 50 }, lookDefaults)).toEqual([["dim", undefined]]);
    expect(lookWrites({ dim: 30 }, {}, lookDefaults)).toEqual([["dim", undefined]]);
    expect(lookWrites({ color: "blue" }, { color: "" }, lookDefaults)).toEqual([["color", undefined]]);
    expect(lookWrites({ spacing: 6 }, { spacing: 6 }, lookDefaults)).toEqual([]);
    expect(lookWrites({}, { spacing: 6, showIcon: false, maxChars: 20 }, { ...lookDefaults, spacing: 6 })).toEqual([["show_icon", false], ["max_chars", 20]]);
    expect(lookOf({ dim: 30, show_icon: false, badge_style: "dot", max_chars: 20, other: 1 })).toEqual({ dim: 30, showIcon: false, badgeStyle: "dot", maxChars: 20 });
    expect(lookOf(undefined)).toEqual({});
  });
});
