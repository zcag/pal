// @vitest-environment happy-dom
// Settings › Features as used: a card per feature with what it is doing
// on its face (on, off, the permission it waits on), its headline control
// (a switch writing the spec's `toggle`, keycast's Start/Stop, the
// sidebar's switch writing its palette), and its settings and command
// hotkeys unfolding in place; the search finds a feature and its settings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsFeatures, featuresIndex, type SettingsFeature, type SettingsFeaturesProps } from "../SettingsFeatures";
import { sidebarDefaults } from "../SettingsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { available: true, on: false, values: {}, commands: [], hotkeys: {}, settings: [] };
const expansion: SettingsFeature = {
  ...base, id: "expansion", title: "Text expansion", description: "A keyword typed in any app becomes its snippet.", toggle: "enabled",
  settings: [{ kind: "boolean", id: "enabled", label: "Expand as you type", default: false }, { kind: "boolean", id: "hud", label: "Flash the HUD", default: true }],
  commands: [{ id: "enabled", title: "Toggle Text expansion" }, { id: "hud", title: "Toggle: Flash the HUD" }],
};
const keycast: SettingsFeature = { ...base, id: "keycast", title: "Keycast", description: "Keys on the screen.", on: true, needs: "input_monitoring", commands: [{ id: "toggle", title: "Toggle keycast" }] };
const linuxOnly: SettingsFeature = { ...base, id: "mouse", title: "Mouse & Trackpad", description: "Middle click.", available: false };
const sidebar: SettingsFeature = { ...base, id: "sidebar", title: "Sidebar", description: "A palette at the edge." };

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const show = (p: Partial<SettingsFeaturesProps> = {}) => act(() => { root.render(<SettingsFeatures features={[expansion, keycast, linuxOnly, sidebar]} onSetting={() => {}} onHotkey={() => {}} {...p} />); });
const card = (id: string) => el.querySelector<HTMLElement>(`[data-anchor="features:${id}"]`)!;
const click = (b: Element | null | undefined) => act(() => { (b as HTMLElement).click(); });

describe("SettingsFeatures", () => {
  it("says on each card what the feature is doing, and why not", async () => {
    await show();
    expect(card("expansion").dataset.tone).toBe("off");
    expect(card("expansion").querySelector(".pal-feature__status")!.textContent).toBe("Off");
    expect(card("keycast").dataset.tone).toBe("warn");
    expect(card("keycast").querySelector(".pal-feature__status")!.textContent).toBe("Needs Input Monitoring");
    expect(card("mouse").dataset.tone).toBe("na");
    expect(card("mouse").querySelector(".pal-feature__more"), "nothing to unfold where it does not run").toBeNull();
  });
  it("the headline switch writes the spec's toggle; keycast's button runs its command; the sidebar's writes its palette", async () => {
    const onSetting = vi.fn(), onRun = vi.fn(), onChange = vi.fn();
    await show({ onSetting, onRun, sidebar: { value: sidebarDefaults, onChange } });
    click(card("expansion").querySelector('[aria-label="Text expansion"]'));
    expect(onSetting).toHaveBeenLastCalledWith("expansion", "enabled", true);
    click([...card("keycast").querySelectorAll("button")].find((b) => b.textContent === "Stop"));
    expect(onRun).toHaveBeenLastCalledWith("keycast", "stop");
    click(card("sidebar").querySelector('[aria-label="Sidebar"]'));
    expect(onChange).toHaveBeenLastCalledWith({ ...sidebarDefaults, palette: "windows/windows" });
  });
  it("unfolds the settings (the headline one left out) and a hotkey per command", async () => {
    const onSetting = vi.fn();
    await show({ onSetting });
    expect(card("expansion").querySelector(".pal-feature__body")).toBeNull();
    click(card("expansion").querySelector(".pal-feature__more"));
    const body = card("expansion").querySelector(".pal-feature__body")!;
    expect(card("expansion").dataset.open).toBe("true");
    expect([...body.querySelectorAll(".pal-setting__label")].map((l) => l.textContent)).toEqual(["Flash the HUD", "Toggle Text expansion", "Toggle: Flash the HUD"]);
    expect(body.textContent).toContain("pal command expansion.hud");
  });
  it("opens the card a link names, and the search finds features and their settings", async () => {
    await show({ open: "keycast" });
    expect(card("keycast").dataset.open).toBe("true");
    const index = featuresIndex([expansion, keycast]);
    expect(index.map((e) => e.label)).toEqual(["Text expansion", "Text expansion: expand as you type", "Text expansion: flash the hud", "Keycast"]);
    expect(index.every((e) => e.page === "features" && e.anchor?.startsWith("features:"))).toBe(true);
  });
});
