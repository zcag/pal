// @vitest-environment happy-dom
// Settings > Shortcuts: every chord pal registers on one page. The
// bindings model (who wins a clash), the three tables built from the
// config with a recorder each writing the same key the other panes write,
// the clash lines on both rows of a doubled chord, the filter, and Add
// Shortcut: what to run, which one, then the chord, written once it lands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsShortcuts, bindings, clashOf, shortcutsIndex } from "../SettingsShortcuts";
import type { BarItem, GeneralConfig, PaletteConfig, SettingsExtension } from "../SettingsTypes";
import { isMac } from "../keys";

/** What the recorder writes for ctrl+<key> here: `comboOf` reads ctrl as cmd off macOS. */
const chord = (key: string) => `${isMac ? "ctrl" : "cmd"}+${key}`;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = (c: Partial<PaletteConfig> = {}): PaletteConfig => ({ enabled: true, settings: {}, ...c });
const general: GeneralConfig = { hotkeys: ["ctrl+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", askPermissionsOnStart: true, backspaceBack: true, appSwitcher: "alt+tab" };
const windows: SettingsExtension = {
  name: "windows", key: "windows", title: "Windows", description: "Every window.", version: "1.0.0", repo: "bundled", bundled: true, settings: [], values: {}, loaded: true,
  palettes: [
    { id: "windows", source: "windows/windows", title: "Windows", kind: "live", hold: "alt+tab", settings: [], config: config({ hold: "cmd+tab" }) },
    { id: "windows-spaces", source: "windows/spaces", title: "Spaces", kind: "live", settings: [], config: config({ itemHotkeys: { toggle: "ctrl+f", misc: "ctrl+3" } }) },
  ],
};
const wm: SettingsExtension = {
  name: "window-management", key: "window-management", title: "Window Management", description: "Halves.", version: "1.0.0", repo: "bundled", bundled: true, settings: [], values: {}, loaded: true,
  palettes: [{ id: "window-management", source: "window-management/window-management", title: "Window Management", kind: "list", settings: [], config: config({ hotkey: "ctrl+alt+w", itemHotkeys: { maximize: "ctrl+3" } }) }],
};
const timer: BarItem = { key: "timer/timer", extension: "timer", id: "timer", title: "Timer", extTitle: "Timer", source: true, stale: false, config: { enabled: true, hotkey: "ctrl+alt+t", look: {} } };
const otp: BarItem = { key: "otp/latest-code", extension: "otp", id: "latest-code", title: "Latest code", extTitle: "Verification codes", source: true, stale: false, config: { enabled: true, look: {} } };

describe("bindings", () => {
  it("lists every chord the config asks for, ranked as hotkey.rs registers them", () => {
    const all = bindings(general, [windows, wm], [timer, otp], { palette: "windows/windows", edge: "left", display: "cursor", width: 320, peek: true, delay: 250, grace: 400, hotkey: "ctrl+alt+s" });
    expect(all.map((b) => [b.id, b.combo, b.rank])).toEqual([
      ["root:0", "ctrl+space", 0], ["app-switcher", "alt+tab", 6], ["sidebar", "ctrl+alt+s", 5],
      ["hold:windows", "cmd+tab", 2], ["item:windows-spaces:toggle", "ctrl+f", 4], ["item:windows-spaces:misc", "ctrl+3", 4],
      ["palette:window-management", "ctrl+alt+w", 1], ["item:window-management:maximize", "ctrl+3", 4],
      ["bar:timer/timer", "ctrl+alt+t", 3],
    ]);
    expect(all.find((b) => b.id === "hold:windows")?.label).toBe("Windows switcher");
    expect(all.find((b) => b.id === "item:windows-spaces:toggle")?.label).toBe("Windows › Spaces › toggle");
  });
  it("a clash names the others and who wins: the lower rank; equals are a tie", () => {
    const all = bindings({ ...general, hotkeys: ["ctrl+3"] }, [windows, wm]);
    const root = all.find((b) => b.id === "root:0")!, misc = all.find((b) => b.id === "item:windows-spaces:misc")!, max = all.find((b) => b.id === "item:window-management:maximize")!;
    expect(clashOf(root, all)).toEqual({ others: [misc, max], outcome: "wins" });
    expect(clashOf(misc, all).outcome).toBe("loses");
    expect(clashOf(max, all).outcome).toBe("loses");
    expect(clashOf(misc, bindings(general, [windows, wm])).outcome).toBe("tie");
    expect(clashOf(all.find((b) => b.id === "hold:windows")!, all)).toEqual({ others: [], outcome: "wins" });
  });
  it("the search finds the cards and every palette, row and bar binding by label and chord", () => {
    const index = shortcutsIndex(general, [windows, wm], [timer]);
    expect(index.filter((e) => e.anchor?.startsWith("shortcuts:item:")).map((e) => e.label)).toEqual(["Windows › Spaces › toggle", "Windows › Spaces › misc", "Window Management › maximize"]);
    expect(index.find((e) => e.anchor === "shortcuts:bar:timer/timer")?.hint).toBeTruthy();
    expect(index.some((e) => e.anchor === "shortcuts:hotkey")).toBe(true);
    expect(index.every((e) => e.page === "shortcuts")).toBe(true);
  });
});

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (props: Partial<Parameters<typeof SettingsShortcuts>[0]> = {}) =>
  act(async () => {
    root.render(<SettingsShortcuts general={general} onGeneral={() => {}} extensions={[windows, wm]} onPalette={() => {}} bar={[timer, otp]} onBarItem={() => {}} {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
const table = (label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const rows = (label: string) => [...(table(label)?.querySelectorAll("li") ?? [])];
/** A button by its aria-label; a recorder's label carries its value after a colon, so the label alone matches too. */
const button = (label: string, within: ParentNode = el) => within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...within.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find((b) => b.getAttribute("aria-label")!.startsWith(`${label}: `)) ?? null;
const byText = (text: string, within: ParentNode = el) => [...within.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (b: HTMLButtonElement | undefined | null) => act(() => { b!.click(); });
const type = (input: HTMLInputElement, value: string) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const record = (b: HTMLButtonElement, key: string, mods: Partial<KeyboardEventInit> = {}) => {
  click(b);
  act(() => { b.dispatchEvent(new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, bubbles: true, ...mods })); });
};

describe("SettingsShortcuts", () => {
  it("draws the pal card and one table each of the palettes, rows and bar items with a hotkey", async () => {
    await show({ items: async (p) => (p.id === "windows-spaces" ? [{ id: "toggle", name: "Toggle web / term" }, { id: "misc", name: "misc" }] : []) });
    expect(el.querySelector('[data-anchor="shortcuts:hotkey"]')).toBeTruthy();
    expect(el.querySelector('[data-anchor="shortcuts:switcher"]')).toBeTruthy();
    expect(rows("Palette shortcuts").map((r) => r.getAttribute("data-anchor"))).toEqual(["shortcuts:palette:windows", "shortcuts:palette:window-management"]);
    expect(rows("Row shortcuts").map((r) => r.getAttribute("data-anchor"))).toEqual(["shortcuts:item:windows-spaces:toggle", "shortcuts:item:windows-spaces:misc", "shortcuts:item:window-management:maximize"]);
    // A row's name from the palette's listing, its id beside it; an unknown row keeps its id as the name.
    expect(rows("Row shortcuts")[0].textContent).toContain("Windows › Spaces › Toggle web / term");
    expect(rows("Row shortcuts")[0].querySelector("code")?.textContent).toBe("toggle");
    expect(rows("Row shortcuts")[2].textContent).toContain("Window Management › maximize");
    expect(rows("Bar item shortcuts").map((r) => r.getAttribute("data-anchor"))).toEqual(["shortcuts:bar:timer/timer"]);
  });
  it("says a doubled chord on both rows, with who wins", async () => {
    await show();
    const misc = rows("Row shortcuts")[1], max = rows("Row shortcuts")[2];
    expect(misc.querySelector('[role="status"]')?.textContent).toContain("Also Window Management › maximize: the same kind, so only one of them registers");
    expect(max.querySelector('[role="status"]')?.textContent).toContain("Also Windows › Spaces › misc: the same kind");
    expect(rows("Row shortcuts")[0].querySelector('[role="status"]')).toBeNull();
    // A root hotkey on a row's chord: the row says it never fires, the root row says it wins.
    await show({ general: { ...general, hotkeys: ["ctrl+f"] } });
    expect(rows("Row shortcuts")[0].querySelector('[role="status"]')?.textContent).toContain("Also Show pal, which wins: this one never fires");
    expect(el.querySelector('[data-anchor="shortcuts:hotkey"] [role="status"]')?.textContent).toContain("Also Windows › Spaces › toggle: this one wins, so that never fires");
  });
  it("a recorder writes the same key the other panes write; Remove drops a row", async () => {
    const onPalette = vi.fn(), onBarItem = vi.fn();
    await show({ onPalette, onBarItem });
    record(button("Windows › Spaces › toggle")!, "g");
    expect(onPalette).toHaveBeenLastCalledWith("windows-spaces", expect.objectContaining({ itemHotkeys: { toggle: chord("g"), misc: "ctrl+3" } }));
    click(button("Remove misc"));
    expect(onPalette).toHaveBeenLastCalledWith("windows-spaces", expect.objectContaining({ itemHotkeys: { toggle: "ctrl+f" } }));
    click(button("Remove maximize"));
    expect(onPalette).toHaveBeenLastCalledWith("window-management", expect.objectContaining({ itemHotkeys: undefined }));
    record(button("Open Window Management")!, "p");
    expect(onPalette).toHaveBeenLastCalledWith("window-management", expect.objectContaining({ hotkey: chord("p") }));
    click(button("Remove Timer hotkey"));
    expect(onBarItem).toHaveBeenLastCalledWith("timer/timer", expect.objectContaining({ hotkey: undefined }));
  });
  it("the filter narrows every table by name, id or chord", async () => {
    await show();
    const filter = el.querySelector<HTMLInputElement>('[aria-label="Filter shortcuts"]')!;
    type(filter, "ctrl+3");
    expect(rows("Row shortcuts").length).toBe(2);
    expect(table("Palette shortcuts")).toBeNull();
    expect(el.textContent).toContain("No palette shortcut matches.");
    type(filter, "timer");
    expect(rows("Bar item shortcuts").length).toBe(1);
    expect(table("Row shortcuts")).toBeNull();
    type(filter, "");
    expect(rows("Row shortcuts").length).toBe(3);
  });
  it("Add Shortcut: what to run, which one, then the chord; nothing is written before the chord lands", async () => {
    const onPalette = vi.fn(), onBarItem = vi.fn();
    await show({ onPalette, onBarItem, items: async () => [{ id: "left_half", name: "Left Half" }] });
    click(byText("Add Shortcut"));
    const form = el.querySelector<HTMLElement>('[aria-label="Add shortcut"]')!;
    expect(form.textContent).toContain("Pick what the chord should open.");
    // A recorder only once there is a target.
    expect(button("New shortcut", form)).toBeNull();
    const target = form.querySelector<HTMLSelectElement>("select")!;
    act(() => { target.value = "window-management"; target.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onPalette).not.toHaveBeenCalled();
    record(button("New shortcut", form)!, "m");
    expect(onPalette).toHaveBeenCalledWith("window-management", expect.objectContaining({ hotkey: chord("m") }));
    expect(el.querySelector('[aria-label="Add shortcut"]')).toBeNull();
    // A row: the palette, then its id (from the listing, or typed), then the chord.
    click(byText("Add Shortcut"));
    click(byText("Run a row"));
    const f2 = el.querySelector<HTMLElement>('[aria-label="Add shortcut"]')!;
    const t2 = f2.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { t2.value = "window-management"; t2.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
    expect(button("New shortcut", f2)).toBeNull();
    type(f2.querySelector<HTMLInputElement>('[aria-label="Row id"]')!, "left_half");
    expect(f2.querySelector("datalist option")?.textContent).toBe("Left Half");
    record(button("New shortcut", f2)!, "l");
    expect(onPalette).toHaveBeenLastCalledWith("window-management", expect.objectContaining({ itemHotkeys: { maximize: "ctrl+3", left_half: chord("l") } }));
    // A bar item.
    click(byText("Add Shortcut"));
    click(byText("Open a bar item"));
    const f3 = el.querySelector<HTMLElement>('[aria-label="Add shortcut"]')!;
    const t3 = f3.querySelector<HTMLSelectElement>("select")!;
    act(() => { t3.value = "otp/latest-code"; t3.dispatchEvent(new Event("change", { bubbles: true })); });
    record(button("New shortcut", f3)!, "o");
    expect(onBarItem).toHaveBeenCalledWith("otp/latest-code", expect.objectContaining({ hotkey: chord("o") }));
    // Cancel closes without writing.
    click(byText("Add Shortcut"));
    click(byText("Cancel"));
    expect(el.querySelector('[aria-label="Add shortcut"]')).toBeNull();
  });
  it("without a bar there is no bar table and no bar kind to add", async () => {
    await show({ bar: undefined, onBarItem: undefined });
    expect(table("Bar item shortcuts")).toBeNull();
    click(byText("Add Shortcut"));
    expect(byText("Open a bar item")).toBeUndefined();
  });
});
