// @vitest-environment happy-dom
// The Sidebar feature's card body as used (its on/off switch is the card's,
// settings-features.test.tsx): the select writes `palette`, the edge,
// display, width, peek and hotkey each write their key, the display list
// is the OS's names after Cursor and Primary (a name no longer connected
// kept), and the Bar page no longer lists it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsBar, barIndex } from "../SettingsBar";
import { SettingsSidebar, sidebarIndex, sidebarSummary } from "../SettingsSidebar";
import { lookDefaults, sidebarDefaults, SIDEBAR_WINDOWS, type BarConfig, type SidebarConfig } from "../SettingsTypes";
import { barItems } from "./settings-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const palettes = [{ id: "windows/windows", title: "Windows" }, { id: "apps/apps", title: "Apps" }];
const on: SidebarConfig = { ...sidebarDefaults, palette: SIDEBAR_WINDOWS };

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (value: SidebarConfig, onChange: (v: SidebarConfig) => void, displays: string[] = ["Built-in Retina Display", "LG UltraFine"]) => act(() => { root.render(<SettingsSidebar value={value} onChange={onChange} palettes={palettes} displays={displays} />); });
const button = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (b: Element | null | undefined) => act(() => { (b as HTMLElement).click(); });
const set = (i: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
  const proto = i instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(i, value);
  i.dispatchEvent(new Event(i instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});

describe("Sidebar card", () => {
  it("the select writes sidebar.palette from the enabled palettes, keeping a name the list does not offer", async () => {
    const onChange = vi.fn();
    await show(on, onChange);
    const select = el.querySelector<HTMLSelectElement>("#pal-sidebar-palette")!;
    expect([...select.options].map((o) => o.value)).toEqual(["windows/windows", "apps/apps"]);
    set(select, "apps/apps");
    expect(onChange).toHaveBeenLastCalledWith({ ...on, palette: "apps/apps" });
    await show({ ...on, palette: "gone/gone" }, onChange);
    expect([...el.querySelector<HTMLSelectElement>("#pal-sidebar-palette")!.options].map((o) => o.value)).toEqual(["windows/windows", "apps/apps", "gone/gone"]);
  });
  it("edge, display, width, peek and hotkey each write their key; the displays are the OS's names after Cursor and Primary", async () => {
    const onChange = vi.fn();
    await show(on, onChange);
    click([...el.querySelectorAll('[aria-label="Sidebar edge"] [role="radio"]')].find((b) => b.textContent === "Left"));
    expect(onChange).toHaveBeenLastCalledWith({ ...on, edge: "left" });
    const display = el.querySelector<HTMLSelectElement>("#pal-sidebar-display")!;
    expect([...display.options].map((o) => [o.value, o.textContent])).toEqual([["cursor", "Cursor"], ["primary", "Primary"], ["Built-in Retina Display", "Built-in Retina Display"], ["LG UltraFine", "LG UltraFine"]]);
    set(display, "LG UltraFine");
    expect(onChange).toHaveBeenLastCalledWith({ ...on, display: "LG UltraFine" });
    set(el.querySelector<HTMLInputElement>("#pal-sidebar-width")!, "400");
    expect(onChange).toHaveBeenLastCalledWith({ ...on, width: 400 });
    click(button("Sidebar peek"));
    expect(onChange).toHaveBeenLastCalledWith({ ...on, peek: false });
    const hotkey = button("Sidebar hotkey: not set")!;
    click(hotkey);
    act(() => { hotkey.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", altKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    expect(onChange).toHaveBeenLastCalledWith({ ...on, hotkey: "alt+shift+tab" });
    // A display the file names that is not connected stays selectable, marked.
    await show({ ...on, display: "Studio Display" }, onChange, ["Built-in Retina Display"]);
    expect([...el.querySelector<HTMLSelectElement>("#pal-sidebar-display")!.options].map((o) => o.textContent)).toContain("Studio Display (not connected)");
  });
  it("no palette select while off", async () => {
    await show(sidebarDefaults, () => {});
    expect(el.querySelector("#pal-sidebar-palette")).toBeNull();
  });
  it("every row is indexed under Features with an anchor on the card, and the summary reads as a line", async () => {
    await show({ ...on, edge: "left", display: "primary" }, () => {});
    for (const e of sidebarIndex) expect(el.querySelector(`[data-anchor="${e.anchor}"]`), e.label).toBeTruthy();
    expect(sidebarIndex.every((e) => e.page === "features")).toBe(true);
    expect(sidebarIndex.map((e) => e.label)).toEqual(["Sidebar: palette", "Sidebar: edge", "Sidebar: display", "Sidebar: width", "Sidebar: peek after", "Sidebar: stays for", "Sidebar: peek", "Sidebar: hotkey"]);
    expect(sidebarSummary(sidebarDefaults, palettes)).toBe("off");
    expect(sidebarSummary(on, palettes)).toBe("Windows on the right edge");
    expect(sidebarSummary({ ...on, edge: "left", display: "primary" }, palettes)).toBe("Windows on the left edge, primary display");
    expect(sidebarSummary({ ...on, palette: "gone/gone", display: "LG UltraFine" }, palettes)).toBe("gone/gone on the right edge, LG UltraFine");
  });
});

describe("the Bar page", () => {
  const config: BarConfig = { target: "auto", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: false, sketchybarPosition: "right", menubar: { ...lookDefaults }, sketchybar: { ...lookDefaults } };
  it("lists no sidebar row: the sidebar is a feature", () => {
    const html = renderToStaticMarkup(<SettingsBar config={config} onChange={() => {}} items={barItems} onItem={() => {}} sketchybar={false} />);
    expect(html).not.toContain("__sidebar__");
    expect(barIndex(barItems).some((e) => e.anchor === "bar:sidebar")).toBe(false);
  });
});
