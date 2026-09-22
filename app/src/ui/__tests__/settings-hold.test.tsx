// @vitest-environment happy-dom
// The switcher chord as edited: the Palettes pane's Switcher chord row
// shows the manifest's suggestion greyed while the file has no `hold`
// line, a recorded chord is written as `hold`, Clear writes `""` (off,
// distinct from unset) where a suggestion would otherwise apply and
// unsets where none does, Reset next to a file line goes back to the
// suggestion, and a bare key (no modifier) is a chord too. The Shortcuts
// page's Window switcher row is the same control on the Windows palette.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsShortcuts } from "../SettingsShortcuts";
import { SettingsPalettes, palettesIndex } from "../SettingsPalettes";
import { holdOf, type GeneralConfig, type PaletteConfig, type SettingsExtension } from "../SettingsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = (hold?: string): PaletteConfig => ({ enabled: true, alias: undefined, hotkey: undefined, hold, itemHotkeys: undefined, settings: {} });
/** The Windows extension with `hold` in the file and, unless `suggested` is `null`, the manifest's `alt+tab`. */
const windows = (hold?: string, suggested: string | null = "alt+tab"): SettingsExtension => ({
  name: "windows", key: "windows", title: "Windows", description: "Every window.", version: "1.0.0", repo: "bundled", bundled: true, settings: [], values: {}, loaded: true,
  palettes: [{ id: "windows", source: "windows/windows", title: "Windows", kind: "live", hold: suggested ?? undefined, settings: [], config: config(hold) }],
});
const general: GeneralConfig = { hotkeys: ["cmd+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", backspaceBack: true };

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (ext: SettingsExtension, onChange: (id: string, c: PaletteConfig) => void) => act(() => { root.render(<SettingsPalettes extensions={[ext]} selected="windows" onSelect={() => {}} onChange={onChange} />); });
const section = () => el.querySelector<HTMLElement>('[aria-label="Switcher chord"]')!;
const recorder = () => [...section().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Windows switcher chord"))!;
const byText = (text: string, within: ParentNode = section()) => [...within.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (b: HTMLButtonElement | undefined | null) => act(() => { b!.click(); });
const record = (b: HTMLButtonElement, key: string, mods: Partial<KeyboardEventInit> = {}) => {
  click(b);
  act(() => { b.dispatchEvent(new KeyboardEvent("keydown", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...mods })); });
};

describe("Switcher chord on the palette pane", () => {
  it("shows the suggestion greyed while the file has no hold line, and says who suggests it", async () => {
    await show(windows(), () => {});
    const r = recorder();
    expect(r.getAttribute("aria-label")).toBe("Windows switcher chord: alt+tab (suggested)");
    expect(r.hasAttribute("data-placeholder")).toBe(true);
    expect(section().querySelector(".pal-ppane__h-note")!.textContent).toBe("palettes.windows.hold");
    expect(section().textContent).toContain("Windows suggests this one.");
    expect(section().querySelector('[aria-label="Clear windows switcher chord"]')).toBeTruthy();
    expect(byText("Reset")).toBeUndefined();
  });
  it("Clear writes an empty hold (off), which is not the same as unset", async () => {
    const onChange = vi.fn();
    await show(windows(), onChange);
    click(section().querySelector<HTMLButtonElement>('[aria-label="Clear windows switcher chord"]'));
    expect(onChange).toHaveBeenLastCalledWith("windows", config(""));
    // Off: the recorder is empty, no placeholder, and Reset offers the suggestion back.
    await show(windows(""), onChange);
    expect(recorder().getAttribute("aria-label")).toBe("Windows switcher chord: not set");
    expect(section().textContent).toContain("Off");
    click(byText("Reset"));
    expect(onChange).toHaveBeenLastCalledWith("windows", config(undefined));
  });
  it("a recorded chord is written as hold; Backspace in the recorder is Clear", async () => {
    const onChange = vi.fn();
    await show(windows(), onChange);
    record(recorder(), "Tab", { altKey: true, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("windows", config("alt+shift+tab"));
    await show(windows("alt+shift+tab"), onChange);
    expect(byText("Reset")).toBeTruthy();
    record(recorder(), "Backspace");
    expect(onChange).toHaveBeenLastCalledWith("windows", config(""));
  });
  it("takes a bare key: a chord with no modifier steps on press and runs on Enter", async () => {
    const onChange = vi.fn();
    await show(windows(), onChange);
    record(recorder(), "F13");
    expect(onChange).toHaveBeenLastCalledWith("windows", config("f13"));
  });
  it("without a suggestion Clear unsets: off and unset mean the same, so no line is written", async () => {
    const onChange = vi.fn();
    await show(windows("ctrl+alt+tab", null), onChange);
    click(section().querySelector<HTMLButtonElement>('[aria-label="Clear windows switcher chord"]'));
    expect(onChange).toHaveBeenLastCalledWith("windows", config(undefined));
    expect(byText("Reset")).toBeUndefined();
  });
  it("is indexed for the palettes where it means something, and holdOf says what applies", () => {
    expect(palettesIndex([windows()]).filter((e) => e.label === "Switcher chord").map((e) => e.anchor)).toEqual(["palettes:windows:hold"]);
    expect(palettesIndex([windows(undefined, null)]).some((e) => e.label === "Switcher chord")).toBe(false);
    expect(palettesIndex([windows("", null)]).some((e) => e.label === "Switcher chord")).toBe(true);
    expect(holdOf(windows().palettes[0])).toBe("alt+tab");
    expect(holdOf(windows("").palettes[0])).toBeUndefined();
    expect(holdOf(windows("f13").palettes[0])).toBe("f13");
  });
});

describe("Window switcher row on Shortcuts", () => {
  const card = () => el.querySelector<HTMLElement>('[data-anchor="shortcuts:switcher"]')!;
  const page = (props: Partial<Parameters<typeof SettingsShortcuts>[0]>) => act(() => { root.render(<SettingsShortcuts general={general} onGeneral={() => {}} extensions={[]} onPalette={() => {}} {...props} />); });
  it("shows the chord that applies with Clear, and writes the Windows palette's hold", async () => {
    const onChange = vi.fn();
    await page({ extensions: [windows()], onPalette: onChange });
    expect(card().querySelector('[aria-label="Switch windows: alt+tab (suggested)"]')).toBeTruthy();
    expect(card().textContent).toContain("Tap it to go back to the previous window; hold it and press again to pick.");
    click(card().querySelector<HTMLButtonElement>('[aria-label="Clear switch windows"]'));
    expect(onChange).toHaveBeenLastCalledWith("windows", expect.objectContaining({ hold: "" }));
    expect(card().textContent).not.toContain("Input Monitoring is not granted");
  });
  it("offers the Input Monitoring grant only for cmd+tab while the grant is missing", async () => {
    const request = vi.fn();
    await page({ extensions: [windows("cmd+tab")], permissions: { accessibility: true, input_monitoring: false }, onRequestPermission: request });
    const grant = byText("Turn on Input Monitoring…", card());
    expect(grant).toBeTruthy();
    click(grant);
    expect(request).toHaveBeenCalledWith("input_monitoring");
    await page({ extensions: [windows("cmd+tab")], permissions: { accessibility: true, input_monitoring: true } });
    expect(byText("Turn on Input Monitoring…", card())).toBeUndefined();
    await page({ extensions: [windows("alt+tab", null)], permissions: { accessibility: true, input_monitoring: false } });
    expect(byText("Turn on Input Monitoring…", card())).toBeUndefined();
  });
  it("is absent without a Windows palette", async () => {
    await page({});
    expect(el.querySelector('[data-anchor="shortcuts:switcher"]')).toBeNull();
  });
});
