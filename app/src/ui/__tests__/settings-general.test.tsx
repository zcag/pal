import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Icon glyphs read `window` at import; no DOM is needed for markup checks.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsGeneral, generalIndex } from "../SettingsGeneral";
import type { ThemeFileStatus } from "../SettingsTheme";

const settingsThemeFile: ThemeFileStatus = { setting: "", diagnostics: [], dir: "~/.config/pal/themes", themes: [] };
import { permissionRows, sidebarDefaults, type GeneralConfig } from "../SettingsTypes";
import { allGranted, nothingGranted } from "./settings-fixtures";

const general: GeneralConfig = { hotkeys: ["cmd+space"], theme: "system", launchAtLogin: false, menuBarIcon: true, position: "top", backspaceBack: true };
const noop = () => {};
const page = (props: Partial<Parameters<typeof SettingsGeneral>[0]>) =>
  renderToStaticMarkup(<SettingsGeneral value={general} onChange={noop} file={{ path: "~/.config/pal/config.toml" }} {...props} />);

describe("SettingsGeneral shortcuts pointer", () => {
  it("shows the root hotkeys and the way to the Shortcuts page, where the recorders went", () => {
    const html = page({ onOpenShortcuts: noop });
    expect(html).toContain('aria-label="Shortcuts"');
    expect(html).toContain(">Open Shortcuts</button>");
    expect(html).not.toContain('aria-label="Presets"');
    expect(html).not.toContain("Record Shortcut");
    expect(generalIndex.find((e) => e.anchor === "general:shortcuts")?.label).toBe("Keyboard shortcuts");
    expect(generalIndex.some((e) => e.anchor === "general:hotkey")).toBe(false);
  });
  it("says when there is no hotkey", () => {
    expect(page({ value: { ...general, hotkeys: [] } })).toContain("No hotkey");
  });
});

describe("SettingsGeneral permissions", () => {
  it("is absent unless the platform reports permissions", () => {
    expect(page({})).not.toContain("Permissions");
  });
  it("lists every permission with its dot, a Grant button on the missing ones, and the first-launch switch", () => {
    const html = page({ permissions: nothingGranted, onRequestPermission: noop, onOpenOverview: noop });
    for (const t of ["Accessibility", "Calendars", "Full Disk Access", "Input Monitoring", "Location"]) expect(html).toContain(`<span class="pal-permission__title">${t}</span>`);
    expect(html).toContain('<span class="pal-permission__title">Location</span><span class="pal-permission__note">Wi-Fi network names</span>');
    expect(html).toContain("Accessibility, Calendars, Full Disk Access, Input Monitoring, Location are not granted");
    expect(html.match(/>Grant…<\/button>/g)?.length).toBe(4);
    expect(html).toContain(">Open…</button>");
    expect(html).toContain("Overview</button>");
    expect(html).toContain("nothing is asked at launch");
    expect(html).not.toContain("Ask on first launch");
  });
  it("has no buttons once everything is granted", () => {
    const html = page({ permissions: allGranted, onRequestPermission: noop, onOpenOverview: noop });
    expect(html.match(/data-granted="true"/g)?.length).toBe(5);
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
    const html = page({ onResetFrecency: noop, onRestartHost: noop, onRefreshListings: noop });
    for (const a of ["general:shortcuts", "general:theme", "general:position", "general:backspace", "general:login", "general:menubar", "general:file", "general:frecency", "general:host", "general:refresh"]) expect(html).toContain(`data-anchor="${a}"`);
    expect(html).toContain("Refresh All");
  });
  it("is found by any word of a row's description, not only its label, and every indexed anchor is on the page", () => {
    const find = (q: string) => generalIndex.filter((e) => `${e.label} ${e.hint ?? ""} ${e.keywords ?? ""}`.toLowerCase().includes(q)).map((e) => e.label);
    expect(find("dock")).toEqual(["Menu bar icon", "Sidebar", "Sidebar: edge"]);
    expect(find("crash")).toEqual(["Launch at login"]);
    expect(find("pop level")).toEqual(["Backspace goes back"]);
    expect(find("permissions grant")).toEqual(["Permissions"]);
    expect(find("comments")).toEqual(["Config file"]);
    expect(find("catppuccin")).toEqual(["Theme file"]);
    const html = page({ permissions: { accessibility: true, input_monitoring: true }, onResetFrecency: noop, onRestartHost: noop, onRefreshListings: noop, themeFile: { status: settingsThemeFile, onChange: noop, onEdit: noop, onOpenDir: noop }, sidebar: { value: sidebarDefaults, onChange: noop } });
    for (const e of generalIndex) expect(html, e.label).toContain(`data-anchor="${e.anchor}"`);
  });
  it("Reset Ranking asks once before it forgets everything", () => {
    const html = page({ onResetFrecency: noop });
    expect(html).toMatch(/data-destructive[^>]*aria-live="polite"[^>]*>Reset Ranking</);
  });
});
