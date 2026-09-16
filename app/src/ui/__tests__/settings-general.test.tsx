import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsGeneral, comboLabel, hotkeyPresets } from "../SettingsGeneral";
import { permissionRows, type GeneralConfig } from "../SettingsTypes";
import { allGranted, nothingGranted } from "./settings-fixtures";

const general: GeneralConfig = { hotkey: "cmd+space", theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", askPermissionsOnStart: true };
const noop = () => {};
const page = (props: Partial<Parameters<typeof SettingsGeneral>[0]>) =>
  renderToStaticMarkup(<SettingsGeneral value={general} onChange={noop} file={{ path: "~/.config/pal/config.toml" }} {...props} />);

describe("SettingsGeneral hotkey row", () => {
  it("offers the presets as buttons, the current one pressed", () => {
    const html = page({});
    expect(hotkeyPresets.length).toBeGreaterThan(2);
    expect(html).toContain('aria-label="Presets"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
  it("says registered under the field", () => {
    expect(page({ hotkey: { wanted: "ctrl+space", registered: true } })).toContain("Registered as");
  });
  it("names the failure and, for Spotlight's key, the switch that frees it", () => {
    const html = page({ hotkey: { wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" }, onOpenKeyboardShortcuts: noop });
    expect(html).toContain("Not registered: Spotlight takes this key first");
    expect(html).toContain(`Spotlight uses ${comboLabel("cmd+space")}. Turn it off in System Settings &gt; Keyboard &gt; Keyboard Shortcuts &gt; Spotlight (untick Show Spotlight search), then pal registers it.`);
    expect(html).toContain("Open Keyboard Shortcuts");
  });
  it("shows no guidance for a plain failure on another key", () => {
    const html = page({ hotkey: { wanted: "ctrl+space", registered: false, error: "HotKey already registered" } });
    expect(html).toContain("Not registered: HotKey already registered");
    expect(html).not.toContain("Spotlight uses");
  });
  it("explains an empty hotkey", () => {
    expect(page({ hotkey: { wanted: "", registered: true } })).toContain("pal toggle");
  });
  it("describes the field in one paragraph that reads on its own", () => {
    const html = page({ hotkey: { wanted: "", registered: true } });
    const desc = html.match(/<p class="pal-setting__desc">([^<]*)<\/p>/)?.[1] ?? "";
    expect(desc.startsWith("Opens pal from any app. Press the new combination")).toBe(true);
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
    const html = page({ hotkey: { wanted: "ctrl+space", registered: true }, onResetFrecency: noop, onRestartHost: noop, onRefreshListings: noop });
    for (const a of ["general:hotkey", "general:theme", "general:position", "general:login", "general:menubar", "general:file", "general:frecency", "general:host", "general:refresh"]) expect(html).toContain(`data-anchor="${a}"`);
    expect(html).toContain("Refresh All");
  });
});
