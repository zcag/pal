import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { SettingsOverview, overviewFacts, overviewItems, updatesLine } from "../SettingsOverview";
import { comboLabel } from "../SettingsGeneral";
import { needsSetup } from "../SettingsTypes";
import { settingsExtensions } from "../../gallery/data";
import { allGranted, barItems, homeAssistant, nothingGranted, otp } from "./settings-fixtures";

const noop = () => {};
/** The gallery's GitHub carries `latest`; without it nothing is pending. */
const quiet = settingsExtensions.map((e) => ({ ...e, latest: undefined }));
const one = { hotkeys: [{ wanted: "ctrl+space", registered: true }], registered: true };
const ok = { version: "0.1.0", hotkey: one, permissions: allGranted, extensions: quiet, bar: [], diagnostics: [] };

describe("overviewItems", () => {
  it("is empty when everything is set", () => {
    expect(overviewItems(ok)).toEqual([]);
  });
  it("names Spotlight's key and the switch that frees it", () => {
    const [item] = overviewItems({ ...ok, hotkey: { hotkeys: [{ wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" }], registered: false } });
    expect(item.title).toBe("Hotkey");
    expect(item.detail).toContain("Spotlight's");
    expect(item.detail).not.toContain("still opens");
    expect(item.action?.keyboardShortcuts).toBe(true);
  });
  it("points at another app for a key the OS refused", () => {
    const [item] = overviewItems({ ...ok, hotkey: { hotkeys: [{ wanted: "alt+space", registered: false, error: "HotKey already registered" }], registered: false } });
    expect(item.detail).toContain("Raycast");
    expect(item.action?.go).toEqual({ page: "general", anchor: "general:hotkey" });
  });
  it("says none set for an empty hotkey, which never registers", () => {
    const [item] = overviewItems({ ...ok, hotkey: { hotkeys: [], registered: true } });
    expect(item.level).toBe("ok");
    expect(item.detail).toContain("None set");
  });
  it("names the one root hotkey that failed, and the one that still works, one row per failure", () => {
    const items = overviewItems({ ...ok, hotkey: { hotkeys: [{ wanted: "cmd+space", registered: true }, { wanted: "ctrl+space", registered: false, error: "HotKey already registered" }], registered: true } });
    expect(items.map((i) => i.id)).toEqual(["hotkey:2"]);
    expect(items[0].detail).toBe(`${comboLabel("ctrl+space")} is held by another app (Raycast, if it is running: its hotkey is under Raycast Settings > General). Change one of them. ${comboLabel("cmd+space")} still opens pal.`);
    expect(items[0].action?.go).toEqual({ page: "general", anchor: "general:hotkey:2" });
    const both = overviewItems({ ...ok, hotkey: { hotkeys: [{ wanted: "cmd+space", registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" }, { wanted: "ctrl+space", registered: false, error: "HotKey already registered" }], registered: false } });
    expect(both.map((i) => i.id)).toEqual(["hotkey", "hotkey:2"]);
    expect(both.every((i) => !i.detail.includes("still opens"))).toBe(true);
  });
  it("lists a missing permission only when something installed needs it", () => {
    const none = overviewItems({ ...ok, permissions: nothingGranted });
    expect(none.map((i) => i.id)).toEqual(["permission:accessibility"]);
    const withOtp = overviewItems({ ...ok, permissions: nothingGranted, extensions: [...quiet, otp], bar: barItems });
    expect(withOtp.map((i) => i.id)).toEqual(expect.arrayContaining(["permission:accessibility", "permission:full_disk_access", "permission:input_monitoring"]));
    expect(withOtp.find((i) => i.id === "permission:full_disk_access")?.action).toEqual({ label: "Open the pane", permission: "full_disk_access" });
    expect(withOtp.find((i) => i.id === "permission:full_disk_access")?.detail).toContain("Switch it on under Privacy & Security > Full Disk Access");
    expect(withOtp.find((i) => i.id === "permission:input_monitoring")?.detail).toContain("Input Monitoring");
    // Location is the wifi extension's: listed with it, with the prompt as the first step.
    expect(withOtp.map((i) => i.id)).not.toContain("permission:location");
    const withWifi = overviewItems({ ...ok, permissions: nothingGranted, extensions: [...quiet, { ...otp, name: "wifi" }] });
    expect(withWifi.find((i) => i.id === "permission:location")).toMatchObject({ action: { label: "Grant…", permission: "location" } });
    expect(withWifi.find((i) => i.id === "permission:location")?.detail).toContain("Wi-Fi network names");
    expect(overviewItems({ ...ok, permissions: { ...nothingGranted, location: "denied" }, extensions: [...quiet, { ...otp, name: "wifi" }] }).find((i) => i.id === "permission:location")?.detail).toContain("Switch it on under Privacy & Security > Location Services");
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
  it("the app update row installs when the build can be installed over, else points at About with the reason", () => {
    const can = overviewItems({ ...ok, update: { available: true, version: "0.2.0", installable: true } });
    expect(can[0]).toMatchObject({ id: "update", title: "pal 0.2.0 is available", action: { label: "Install", installUpdate: true, disabled: false } });
    expect(can[0].detail).toContain("You have 0.1.0");
    const going = overviewItems({ ...ok, update: { available: true, version: "0.2.0", installable: true }, progress: { phase: "downloading", version: "0.2.0", downloaded: 3_000_000, total: 12_000_000 } });
    expect(going[0].detail).toBe("Downloading 0.2.0: 25% of 12.0 MB…");
    expect(going[0].action).toMatchObject({ label: "Installing…", disabled: true });
    const failed = overviewItems({ ...ok, update: { available: true, version: "0.2.0", installable: true }, progress: { phase: "failed", version: "0.2.0", error: "signature mismatch" } });
    expect(failed[0].detail).toBe("Installing 0.2.0 failed: signature mismatch");
    expect(failed[0].action).toMatchObject({ label: "Install", disabled: false });
    const deb = overviewItems({ ...ok, update: { available: true, version: "0.2.0", installable: false, install_note: "installed from the .deb: download the new package from the releases page and install it with dpkg" } });
    expect(deb[0].detail).toBe("You have 0.1.0. Installed from the .deb: download the new package from the releases page and install it with dpkg.");
    expect(deb[0].action).toEqual({ label: "About", go: { page: "about", anchor: "about:updates" } });
    // The button: primary, and disabled while installing.
    const onInstallUpdate = vi.fn();
    const html = renderToStaticMarkup(<SettingsOverview {...ok} update={{ available: true, version: "0.2.0", installable: true }} onGo={noop} onInstallUpdate={onInstallUpdate} />);
    expect(html).toContain('data-primary=""');
    expect(html).toContain(">Install</button>");
    const busy = renderToStaticMarkup(<SettingsOverview {...ok} update={{ available: true, version: "0.2.0", installable: true }} progress={{ phase: "installing", version: "0.2.0" }} onGo={noop} onInstallUpdate={onInstallUpdate} />);
    expect(busy).toMatch(/disabled=""[^>]*>Installing…<\/button>/);
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
    expect(renderToStaticMarkup(<>{facts[0].value}</>)).toContain(`aria-label="${comboLabel("ctrl+space")}"`);
    const two = overviewFacts({ ...ok, hotkey: { hotkeys: [{ wanted: "cmd+space", registered: true }, { wanted: "ctrl+space", registered: false }], registered: true } });
    const value = renderToStaticMarkup(<>{two[0].value}</>);
    expect(value).toContain(`aria-label="${comboLabel("cmd+space")}, ${comboLabel("ctrl+space")}"`);
    // Every entry as key caps, the failed one too.
    expect(value.match(/<kbd/g)?.length).toBe(4);
    expect(overviewFacts({ ...ok, hotkey: { hotkeys: [], registered: true } })[0].value).toBe("none");
    expect(facts[1].value).toBe("4 extensions loaded");
    expect(facts[2].value).toBe("6 of 7 on, 3 with a hotkey, 2 item hotkeys");
    const bare = quiet.map((e) => ({ ...e, palettes: e.palettes.map((p) => ({ ...p, config: { ...p.config, hotkey: undefined, itemHotkeys: undefined } })) }));
    expect(overviewFacts({ ...ok, extensions: bare })[2].value).toBe("6 of 7 on");
    const oneItem = bare.map((e, i) => (i ? e : { ...e, palettes: e.palettes.map((p, j) => (j ? p : { ...p, config: { ...p.config, itemHotkeys: { a: "ctrl+alt+a" } } })) }));
    expect(overviewFacts({ ...ok, extensions: oneItem })[2].value).toBe("6 of 7 on, 1 item hotkey");
    expect(facts[3].value).toBe("no items declared");
    expect(overviewFacts({ ...ok, barSupported: false }).map((f) => f.label)).toEqual(["Hotkey", "Extensions", "Palettes"]);
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

describe("the update checks on the Overview", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  const h = 3600_000;
  it("says when the checks last ran, as a fact", () => {
    expect(updatesLine({ enabled: true, checkedAt: now - 2 * h }, now)).toBe("Updates checked 2h ago.");
    expect(updatesLine({ enabled: true, checkedAt: now - 10_000 }, now)).toBe("Updates checked just now.");
    expect(updatesLine({ enabled: true }, now)).toBe("Updates are checked once a day.");
    expect(updatesLine({ enabled: true, busy: true, checkedAt: now }, now)).toBe("Checking for updates…");
    expect(updatesLine(undefined, now)).toBe("");
  });
  it("says the checks are off, and a manual one's result next to it", () => {
    expect(updatesLine({ enabled: false }, now)).toBe("Updates are not checked automatically.");
    expect(updatesLine({ enabled: false, checkedAt: now - h, error: "no network" }, now)).toBe("Updates checked 1h ago. The check failed: no network. Automatic checks are off.");
    expect(updatesLine({ enabled: true, checkedAt: now - h, status: "no release published yet" }, now)).toBe("Updates checked 1h ago. No release published yet.");
  });
  it("never lists a failed or skipped check as something to look at", () => {
    const off = { ...ok, checks: { enabled: false, checkedAt: now - h, error: "Could not fetch a valid release JSON from the remote" } };
    expect(overviewItems(off)).toEqual([]);
    expect(overviewItems({ ...ok, checks: { enabled: true, checkedAt: now, status: "no release published yet" }, update: { available: false, status: "no release published yet" } })).toEqual([]);
    const html = renderToStaticMarkup(<SettingsOverview {...off} onGo={noop} onCheckUpdates={noop} />);
    expect(html).toContain("Everything is set");
    expect(html).toContain("The check failed: Could not fetch a valid release JSON from the remote. Automatic checks are off.");
    expect(html).toContain(">Check now</button>");
    expect(html).not.toContain("pal-overview__list");
  });
  it("offers Check now with the checks off, and reports a found update as before", () => {
    const html = renderToStaticMarkup(<SettingsOverview {...ok} checks={{ enabled: false }} update={{ available: true, version: "0.2.0" }} onGo={noop} onCheckUpdates={noop} />);
    expect(html).toContain("pal 0.2.0 is available");
    expect(html).toContain("Updates are not checked automatically.");
    expect(html).toContain(">Check now</button>");
    const busy = renderToStaticMarkup(<SettingsOverview {...ok} checks={{ enabled: true, busy: true }} onGo={noop} onCheckUpdates={noop} />);
    expect(busy).toContain(">Checking…</button>");
    expect(busy).toContain("disabled");
    expect(renderToStaticMarkup(<SettingsOverview {...ok} onGo={noop} />)).not.toContain("pal-overview__checks");
  });
});
