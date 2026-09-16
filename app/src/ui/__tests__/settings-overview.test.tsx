import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsOverview, overviewFacts, overviewItems } from "../SettingsOverview";
import { needsSetup } from "../SettingsTypes";
import { settingsExtensions } from "../../gallery/data";
import { allGranted, barItems, homeAssistant, nothingGranted, otp } from "./settings-fixtures";

const noop = () => {};
/** The gallery's GitHub carries `latest`; without it nothing is pending. */
const quiet = settingsExtensions.map((e) => ({ ...e, latest: undefined }));
const ok = { version: "0.1.0", hotkey: { wanted: "ctrl+space", registered: true }, permissions: allGranted, extensions: quiet, bar: [], diagnostics: [] };

describe("overviewItems", () => {
  it("is empty when everything is set", () => {
    expect(overviewItems(ok)).toEqual([]);
  });
  it("names Spotlight's key and the switch that frees it", () => {
    const [item] = overviewItems({ ...ok, hotkey: { wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" } });
    expect(item.title).toBe("Hotkey");
    expect(item.detail).toContain("Spotlight's");
    expect(item.action?.keyboardShortcuts).toBe(true);
  });
  it("points at another app for a key the OS refused", () => {
    const [item] = overviewItems({ ...ok, hotkey: { wanted: "alt+space", registered: false, error: "HotKey already registered" } });
    expect(item.detail).toContain("Raycast");
    expect(item.action?.go).toEqual({ page: "general", anchor: "general:hotkey" });
  });
  it("lists a missing permission only when something installed needs it", () => {
    const none = overviewItems({ ...ok, permissions: nothingGranted });
    expect(none.map((i) => i.id)).toEqual(["permission:accessibility"]);
    const withOtp = overviewItems({ ...ok, permissions: nothingGranted, extensions: [...quiet, otp], bar: barItems });
    expect(withOtp.map((i) => i.id)).toEqual(expect.arrayContaining(["permission:accessibility", "permission:full_disk_access", "permission:input_monitoring"]));
    expect(withOtp.find((i) => i.id === "permission:full_disk_access")?.action).toEqual({ label: "Open the pane", permission: "full_disk_access" });
    expect(withOtp.find((i) => i.id === "permission:full_disk_access")?.detail).toContain("Switch it on under Privacy & Security > Full Disk Access");
    expect(withOtp.find((i) => i.id === "permission:input_monitoring")?.detail).toContain("Input Monitoring");
  });
  it("flags an extension with nothing to work with, and what to fill in", () => {
    expect(needsSetup(homeAssistant).map((s) => s.id)).toEqual(["url", "token"]);
    // GitHub's token says "Leave empty to use the gh CLI's login": not required.
    expect(needsSetup({ ...settingsExtensions[2], values: {}, settings: [{ kind: "secret", id: "token", label: "Token", description: "Leave empty to use the gh CLI's login." }] })).toEqual([]);
    const [item] = overviewItems({ ...ok, extensions: [homeAssistant] });
    expect(item.id).toBe("setup:home-assistant");
    expect(item.title).toBe("Home Assistant needs url and token");
    expect(item.action?.go).toEqual({ page: "extensions", anchor: "extensions:home-assistant:url" });
  });
  it("lists load errors, manifest warnings, config problems, stale bar items and updates, in that order after setup", () => {
    const items = overviewItems({
      ...ok,
      extensions: [{ ...homeAssistant, loaded: false, error: "boom" }, { ...quiet[2], warnings: ["kind mismatch"] }],
      diagnostics: [{ level: "warning", path: "palettes.x.enabld", line: 14, message: "unknown key" }],
      bar: barItems,
      update: { available: true, version: "0.2.0" },
    });
    expect(items.map((i) => i.id)).toEqual(["failed:home-assistant", "warning:github:kind mismatch", "config:palettes.x.enabld:14", "stale:timer/running", "update"]);
    expect(items[2].detail).toContain("line 14");
    expect(items[4].title).toBe("pal 0.2.0 is available");
  });
  it("offers an extension update inline", () => {
    const items = overviewItems({ ...ok, extensions: settingsExtensions });
    expect(items).toHaveLength(1);
    expect(items[0].action).toEqual({ label: "Update", updateExtension: "github" });
  });
});

describe("SettingsOverview", () => {
  it("says everything is set, with the version and the facts", () => {
    const html = renderToStaticMarkup(<SettingsOverview {...ok} onGo={noop} />);
    expect(html).toContain("Everything is set");
    expect(html).toContain("pal 0.1.0 is reachable");
    expect(html).not.toContain("pal-overview__list");
    const facts = overviewFacts(ok);
    expect(facts.map((f) => f.label)).toEqual(["Hotkey", "Extensions", "Palettes", "Bar"]);
    expect(facts[1].value).toBe("4 extensions loaded");
    expect(facts[2].value).toBe("6 of 7 on, 3 with a hotkey");
    expect(facts[3].value).toBe("no items declared");
  });
  it("lists what needs attention with the action inline", () => {
    const html = renderToStaticMarkup(<SettingsOverview {...ok} permissions={nothingGranted} extensions={[homeAssistant]} onGo={noop} onRequestPermission={noop} />);
    expect(html).toContain("2 things to look at");
    expect(html).toContain('data-anchor="overview:permission:accessibility"');
    expect(html).toContain(">Grant…</button>");
    expect(html).toContain(">Set up</button>");
    expect(html).toContain("Home Assistant needs url and token");
  });
});
