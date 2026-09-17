// @vitest-environment happy-dom
// Settings > General's hotkey rows as clicked: a preset writes its own
// row, Remove drops one, Add another opens an empty row that writes
// nothing until a combination lands in it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsGeneral, comboLabel } from "../SettingsGeneral";
import type { GeneralConfig } from "../SettingsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const general: GeneralConfig = { hotkeys: ["cmd+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", askPermissionsOnStart: true, backspaceBack: true };

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (hotkeys: string[], onChange: (v: GeneralConfig) => void) => act(() => { root.render(<SettingsGeneral value={{ ...general, hotkeys }} onChange={onChange} file={{ path: "x" }} />); });
const button = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const preset = (row: number, combo: string) => [...el.querySelectorAll<HTMLButtonElement>(`[aria-label="Presets for hotkey ${row}"] button`)].find((b) => b.textContent === comboLabel(combo));
const click = (b: HTMLButtonElement | undefined | null) => act(() => { b!.click(); });

describe("hotkey rows", () => {
  it("writes the list on a change: a preset on one row, Remove on another", async () => {
    const onChange = vi.fn();
    await show(["cmd+space", "ctrl+space"], onChange);
    click(preset(2, "alt+space"));
    expect(onChange).toHaveBeenLastCalledWith({ ...general, hotkeys: ["cmd+space", "alt+space"] });
    click(button("Remove hotkey 1"));
    expect(onChange).toHaveBeenLastCalledWith({ ...general, hotkeys: ["ctrl+space"] });
  });
  it("Add another opens an empty row that is written once a preset lands in it", async () => {
    const onChange = vi.fn();
    await show(["cmd+space"], onChange);
    const add = [...el.querySelectorAll("button")].find((b) => b.textContent === "Add another");
    click(add);
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Show pal (2): not set")).toBeTruthy();
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Add another")).toBe(false);
    click(preset(2, "ctrl+space"));
    expect(onChange).toHaveBeenLastCalledWith({ ...general, hotkeys: ["cmd+space", "ctrl+space"] });
    // Remove on the pending row only closes it.
    await show(["cmd+space"], onChange);
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Add another"));
    onChange.mockClear();
    click(button("Remove hotkey 2"));
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Show pal (2): not set")).toBeNull();
  });
});
