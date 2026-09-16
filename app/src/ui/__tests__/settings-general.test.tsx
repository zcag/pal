import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsGeneral, comboLabel, hotkeyPresets } from "../SettingsGeneral";
import { permissionRows, type GeneralConfig, type HotkeyStatus } from "../SettingsTypes";
import { allGranted, nothingGranted } from "./settings-fixtures";

const general: GeneralConfig = { hotkeys: ["cmd+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", askPermissionsOnStart: true };
const noop = () => {};
const page = (props: Partial<Parameters<typeof SettingsGeneral>[0]>) =>
  renderToStaticMarkup(<SettingsGeneral value={general} onChange={noop} file={{ path: "~/.config/pal/config.toml" }} {...props} />);
const status = (...hotkeys: HotkeyStatus["hotkeys"]): HotkeyStatus => ({ hotkeys, registered: !hotkeys.length || hotkeys.some((h) => h.registered) });

describe("SettingsGeneral hotkey row", () => {
  it("offers the presets as buttons, the current one pressed", () => {
    const html = page({});
    expect(hotkeyPresets.length).toBeGreaterThan(2);
    expect(html).toContain('aria-label="Presets"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
  it("says registered under the field", () => {
    expect(page({ value: { ...general, hotkeys: ["ctrl+space"] }, hotkey: status({ wanted: "ctrl+space", registered: true }) })).toContain("Registered as");
  });
  it("names the failure and, for Spotlight's key, the switch that frees it", () => {
    const html = page({ hotkey: status({ wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" }), onOpenKeyboardShortcuts: noop });
    expect(html).toContain("Not registered: Spotlight takes this key first");
    expect(html).toContain(`Spotlight uses ${comboLabel("cmd+space")}. Turn it off in System Settings &gt; Keyboard &gt; Keyboard Shortcuts &gt; Spotlight (untick Show Spotlight search), then pal registers it.`);
    expect(html).toContain("Open Keyboard Shortcuts");
  });
  it("shows no guidance for a plain failure on another key", () => {
    const html = page({ value: { ...general, hotkeys: ["ctrl+space"] }, hotkey: status({ wanted: "ctrl+space", registered: false, error: "HotKey already registered" }) });
    expect(html).toContain("Not registered: HotKey already registered");
    expect(html).not.toContain("Spotlight uses");
  });
  it("explains an empty hotkey, with one empty recorder to fill", () => {
    const html = page({ value: { ...general, hotkeys: [] }, hotkey: status() });
    expect(html).toContain("pal toggle");
    expect(html).toContain("Record Shortcut");
    expect(html).not.toContain(">Add another</button>");
    expect(html).not.toContain("Remove hotkey");
  });
  it("gives every root hotkey its own recorder, presets, status line and Remove, with the failure on its row only", () => {
    const html = page({
      value: { ...general, hotkeys: ["cmd+space", "ctrl+space"] },
      hotkey: status({ wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" }, { wanted: "ctrl+space", registered: true }),
      onOpenKeyboardShortcuts: noop,
    });
    expect(html).toContain('aria-label="Show pal (1): cmd+space"');
    expect(html).toContain('aria-label="Show pal (2): ctrl+space"');
    expect(html).toContain('aria-label="Presets for hotkey 1"');
    expect(html).toContain('aria-label="Presets for hotkey 2"');
    // Each row's own preset is pressed.
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html.match(/aria-label="Remove hotkey \d"/g)?.length).toBe(2);
    expect(html).toContain('data-anchor="general:hotkey:2"');
    const rows = html.split('class="pal-hotkey-entry"');
    expect(rows.length).toBe(3);
    expect(rows[1]).toContain("Not registered: Spotlight takes this key first");
    expect(rows[1]).toContain("Open Keyboard Shortcuts");
    expect(rows[2]).toContain("Registered as");
    expect(rows[2]).not.toContain("Not registered");
    expect(html).toContain(">Add another</button>");
  });
  it("stops offering Add another at three", () => {
    const html = page({ value: { ...general, hotkeys: ["cmd+space", "ctrl+space", "alt+space"] }, hotkey: status({ wanted: "cmd+space", registered: true }, { wanted: "ctrl+space", registered: true }, { wanted: "alt+space", registered: true }) });
    expect(html.match(/aria-label="Remove hotkey \d"/g)?.length).toBe(3);
    expect(html).not.toContain(">Add another</button>");
  });
  it("describes the field in one paragraph that reads on its own", () => {
    const html = page({ value: { ...general, hotkeys: [] }, hotkey: status() });
    const desc = html.match(/<p class="pal-setting__desc">([^<]*)<\/p>/)?.[1] ?? "";
    expect(desc.startsWith("Opens pal from any app. Press the new combination")).toBe(true);
    expect(desc).toContain("Add another");
    expect(desc).not.toContain("From anywhere");
  });
});

describe("SettingsGeneral permissions", () => {
  it("is absent unless the platform reports permissions", () => {
    expect(page({})).not.toContain("Permissions");
  });
  it("lists every permission with its dot, a Grant button on the missing ones, and the first-launch switch", () => {
    const html = page({ permissions: nothingGranted, onRequestPermission: noop, onOpenOverview: noop });
    for (const t of ["Accessibility", "Calendars", "Full Disk Access", "Input Monitoring"]) expect(html).toContain(`<span class="pal-permission__title">${t}</span>`);
    expect(html).toContain("Accessibility, Calendars, Full Disk Access, Input Monitoring are not granted");
    expect(html.match(/>Grant…<\/button>/g)?.length).toBe(3);
    expect(html).toContain(">Open…</button>");
    expect(html).toContain("Overview</button>");
    expect(html).toContain("Ask on first launch");
  });
  it("has no buttons once everything is granted", () => {
    const html = page({ permissions: allGranted, onRequestPermission: noop, onOpenOverview: noop });
    expect(html.match(/data-granted="true"/g)?.length).toBe(4);
    expect(html).toContain("Every permission pal can use is granted.");
    expect(html).not.toContain("Grant…");
    expect(html).not.toContain("Overview</button>");
  });
  it("says when Full Disk Access has nothing to probe", () => {
    const html = page({ permissions: { accessibility: true, calendar: "unavailable", input_monitoring: true } });
    expect(html).not.toContain("Calendars");
    expect(html).not.toContain("Full Disk Access");
    const html2 = page({ permissions: { accessibility: true, full_disk_access: undefined, input_monitoring: true }, onRequestPermission: noop });
    expect(html2).not.toContain("nothing to probe");
    expect(permissionRows({ accessibility: true, input_monitoring: true }, { otp: true }).find((r) => r.id === "full_disk_access")?.state).toBe("unknown");
  });
  it("gives every row an anchor for the search", () => {
    const html = page({ hotkey: status({ wanted: "cmd+space", registered: true }), onResetFrecency: noop, onRestartHost: noop, onRefreshListings: noop });
    for (const a of ["general:hotkey", "general:theme", "general:position", "general:login", "general:menubar", "general:file", "general:frecency", "general:host", "general:refresh"]) expect(html).toContain(`data-anchor="${a}"`);
    expect(html).toContain("Refresh All");
  });
});
