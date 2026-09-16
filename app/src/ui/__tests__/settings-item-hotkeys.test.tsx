// @vitest-environment happy-dom
// Settings > Palettes' Item hotkeys table as used: the saved rows with
// their names from the palette's listing, a recorded combination written
// under the id, Remove, "Add hotkey" opening a row that writes nothing
// until it has both an id and a combination, an id retyped moving the
// combination, and the whole map going when the last row does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPalettes } from "../SettingsPalettes";
import type { PaletteConfig, SettingsExtension } from "../SettingsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = (itemHotkeys?: Record<string, string>): PaletteConfig => ({ enabled: true, alias: undefined, hotkey: undefined, itemHotkeys, settings: {} });
const ext = (itemHotkeys?: Record<string, string>): SettingsExtension => ({
  name: "window-management", title: "Window Management", description: "Halves and thirds.", version: "1.0.0", repo: "bundled", bundled: true, settings: [], values: {}, loaded: true,
  palettes: [{ id: "window-management", title: "Window Management", settings: [], config: config(itemHotkeys) }],
});
const rows = [{ id: "left_half", name: "Left Half" }, { id: "maximize", name: "Maximize" }, { id: "center", name: "Center" }];

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

/** Renders, and lets the listing's promise land inside act. */
const show = (itemHotkeys: Record<string, string> | undefined, onChange: (id: string, c: PaletteConfig) => void, items = async () => rows) =>
  act(async () => {
    root.render(<SettingsPalettes extensions={[ext(itemHotkeys)]} selected="window-management" onSelect={() => {}} onChange={onChange} items={items} />);
    await Promise.resolve();
    await Promise.resolve();
  });
const table = () => el.querySelector<HTMLElement>('[aria-label="Item hotkeys"]')!;
const button = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const byText = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (b: HTMLButtonElement | undefined | null) => act(() => { b!.click(); });
/** Records `combo` in the recorder button labelled `label`: a click starts recording, the key event lands it. */
const record = (label: string, key: string, mods: Partial<KeyboardEventInit>) => {
  const b = button(`${label}: not set`) ?? [...el.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.getAttribute("aria-label")?.startsWith(label))!;
  click(b);
  act(() => { b.dispatchEvent(new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...mods })); });
};
const typeId = (input: HTMLInputElement, value: string) => act(() => { input.value = value; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });

describe("item hotkeys table", () => {
  it("lists the saved rows with the names the listing gives, and marks one the palette does not list now", async () => {
    await show({ left_half: "ctrl+alt+left", gone: "ctrl+alt+g" }, () => {});
    const t = table();
    expect(t.querySelector(".pal-ppane__h-note")!.textContent).toBe("palettes.window-management.item_hotkeys");
    const items = [...t.querySelectorAll<HTMLElement>(".pal-itemkeys__row")];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector<HTMLInputElement>("input")!.value).toBe("left_half");
    expect(items[0].querySelector(".pal-itemkeys__name")!.textContent).toBe("Left Half");
    expect(items[0].hasAttribute("data-unknown")).toBe(false);
    expect(items[1].querySelector(".pal-itemkeys__name")!.textContent).toBe("not listed now");
    expect(items[1].hasAttribute("data-unknown")).toBe(true);
    // The picker: every listed row as an option the id field completes from.
    const options = [...t.querySelectorAll("datalist option")].map((o) => [o.getAttribute("value"), o.textContent]);
    expect(options).toEqual([["left_half", "Left Half"], ["maximize", "Maximize"], ["center", "Center"]]);
    expect(items[0].querySelector("input")!.getAttribute("list")).toBe(t.querySelector("datalist")!.id);
  });

  it("Remove drops the row; removing the last one writes the map away", async () => {
    const onChange = vi.fn();
    await show({ left_half: "ctrl+alt+left", maximize: "ctrl+alt+enter" }, onChange);
    click(button("Remove hotkey for maximize"));
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ left_half: "ctrl+alt+left" }));
    await show({ left_half: "ctrl+alt+left" }, onChange);
    click(button("Remove hotkey for left_half"));
    expect(onChange).toHaveBeenLastCalledWith("window-management", config(undefined));
  });

  it("a recorded combination is written under the row's id; Backspace in the recorder drops the row", async () => {
    const onChange = vi.fn();
    await show({ left_half: "ctrl+alt+left" }, onChange);
    record("Hotkey for left_half", "l", { altKey: true, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ left_half: "alt+shift+l" }));
    record("Hotkey for left_half", "Backspace", {});
    expect(onChange).toHaveBeenLastCalledWith("window-management", config(undefined));
  });

  it("Add hotkey opens a row that writes once it has an id and a combination, in either order", async () => {
    const onChange = vi.fn();
    await show(undefined, onChange);
    expect(table().textContent).toContain("None.");
    click(byText("Add hotkey"));
    const draft = table().querySelector<HTMLElement>('[data-draft=""]')!;
    expect(draft).toBeTruthy();
    expect(byText("Add hotkey")).toBeUndefined();
    typeId(draft.querySelector("input")!, "maximize");
    expect(onChange).not.toHaveBeenCalled();
    record("Hotkey for the new item", "m", { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ maximize: "alt+m" }));
    // The other order: the combination first, then the id.
    await show({ maximize: "ctrl+alt+m" }, onChange);
    onChange.mockClear();
    click(byText("Add hotkey"));
    record("Hotkey for the new item", "c", { altKey: true });
    expect(onChange).not.toHaveBeenCalled();
    typeId(table().querySelector<HTMLInputElement>('[data-draft=""] input')!, " center ");
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ maximize: "ctrl+alt+m", center: "alt+c" }));
    // Cancel closes the draft and writes nothing.
    await show({ maximize: "ctrl+alt+m" }, onChange);
    onChange.mockClear();
    click(byText("Add hotkey"));
    click(button("Cancel the new item hotkey"));
    expect(table().querySelector('[data-draft=""]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an id retyped on a saved row moves its combination; an emptied id drops the row", async () => {
    const onChange = vi.fn();
    await show({ left_half: "ctrl+alt+left", maximize: "ctrl+alt+enter" }, onChange);
    typeId(table().querySelector<HTMLInputElement>('input[aria-label="Item id for ctrl+alt+left"]')!, "right_half");
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ right_half: "ctrl+alt+left", maximize: "ctrl+alt+enter" }));
    typeId(table().querySelector<HTMLInputElement>('input[aria-label="Item id for ctrl+alt+enter"]')!, "");
    expect(onChange).toHaveBeenLastCalledWith("window-management", config({ left_half: "ctrl+alt+left" }));
  });

  it("without a listing the ids are typed: no picker, no names, nothing marked", async () => {
    await act(() => { root.render(<SettingsPalettes extensions={[ext({ left_half: "ctrl+alt+left" })]} selected="window-management" onSelect={() => {}} onChange={() => {}} />); });
    const t = table();
    expect(t.querySelector("datalist")).toBeNull();
    expect(t.querySelector(".pal-itemkeys__name")!.textContent).toBe("");
    expect(t.querySelector("[data-unknown]")).toBeNull();
  });
});
